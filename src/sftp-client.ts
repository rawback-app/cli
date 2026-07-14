import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Client, type SFTPWrapper } from "ssh2";

export interface KnownHostStore {
  getFingerprint(host: string, port: number): string | null;
  trustFingerprint(host: string, port: number, fingerprint: string): void;
}

export interface SftpClientOptions {
  endpoint: string;
  username: string;
  password: string;
  hostFingerprint?: string;
  knownHosts: KnownHostStore;
}

export interface UploadTransport {
  connect(): Promise<void>;
  upload(localPath: string, remotePath: string, onProgress: (bytes: number) => void): Promise<void>;
  close(): Promise<void>;
}

export type UploadTransportFactory = (options: SftpClientOptions) => UploadTransport;

export class SftpConnectionError extends Error {
  readonly connectionFailure = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SftpConnectionError";
  }
}

export class HostKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostKeyError";
  }
}

function parseEndpoint(endpoint: string): { host: string; port: number } {
  const url = new URL(endpoint);
  return { host: url.hostname, port: url.port ? Number(url.port) : 22 };
}

function fingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function normalizeFingerprint(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("SHA256:")
    ? trimmed.replace(/=+$/, "")
    : `SHA256:${trimmed.replace(/=+$/, "")}`;
}

export function isConnectionFailure(error: unknown): boolean {
  if (error instanceof SftpConnectionError) return true;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (
    ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH"].includes(
      code ?? "",
    )
  ) {
    return true;
  }
  return /connection|channel.*closed|no response|socket.*closed|timed? out/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export class SftpClient implements UploadTransport {
  private client: Client | null = null;
  private sftp: SFTPWrapper | null = null;

  constructor(private readonly options: SftpClientOptions) {}

  async connect(): Promise<void> {
    if (this.client) await this.close();
    const { host, port } = parseEndpoint(this.options.endpoint);
    const expected = this.options.hostFingerprint
      ? normalizeFingerprint(this.options.hostFingerprint)
      : this.options.knownHosts.getFingerprint(host, port);
    let observed: string | null = null;
    let verificationError: HostKeyError | null = null;
    const client = new Client();

    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        client.removeAllListeners();
        client.destroy();
        reject(
          verificationError ??
            new SftpConnectionError(`Unable to connect to ${host}:${port}`, {
              cause: error,
            }),
        );
      };
      client.once("error", fail);
      client.once("ready", () => {
        client.removeListener("error", fail);
        resolve();
      });
      client.connect({
        host,
        port,
        username: this.options.username,
        password: this.options.password,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        readyTimeout: 20_000,
        hostVerifier: (key: Buffer) => {
          observed = fingerprint(key);
          if (expected !== null && normalizeFingerprint(expected) !== observed) {
            verificationError = new HostKeyError(
              `SFTP host key mismatch for ${host}:${port}: expected ${expected}, received ${observed}`,
            );
            return false;
          }
          return true;
        },
      });
    });

    client.on("error", () => {});
    let sftp: SFTPWrapper;
    try {
      sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((error, wrapper) => {
          if (error) {
            reject(new SftpConnectionError("Unable to start the SFTP session", { cause: error }));
          } else {
            resolve(wrapper);
          }
        });
      });
    } catch (error) {
      client.end();
      throw error;
    }

    try {
      if (expected === null && observed !== null) {
        this.options.knownHosts.trustFingerprint(host, port, observed);
      }
    } catch (error) {
      client.end();
      throw error;
    }
    this.client = client;
    this.sftp = sftp;
  }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress: (bytes: number) => void,
  ): Promise<void> {
    if (!this.sftp) throw new SftpConnectionError("SFTP client is not connected");
    let transferred = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferred += chunk.length;
        onProgress(transferred);
        callback(null, chunk);
      },
    });
    const destination = this.sftp.createWriteStream(remotePath, {
      autoClose: true,
      flags: "w",
    });
    await pipeline(createReadStream(localPath), counter, destination);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.sftp = null;
    this.client = null;
    if (!client) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      client.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      client.end();
    });
  }
}

export const createSftpClient: UploadTransportFactory = (options) => new SftpClient(options);
