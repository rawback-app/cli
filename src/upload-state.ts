import { Database } from "bun:sqlite";
import { chmod, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type UploadFileStatus = "pending" | "in_progress" | "completed" | "failed";

export interface UploadStateFile {
  account: string;
  endpoint: string;
  path: string;
  size: number;
  mtimeMs: number;
}

interface ThroughputRow {
  bytes: number;
  durationMs: number;
}

export interface ThroughputEstimate {
  bytesPerSecond: number;
  source: "matching concurrency history" | "endpoint history";
}

export const DEFAULT_UPLOAD_STATE_PATH = join(homedir(), ".rawback", "upload-progress.sqlite");

export class UploadStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UploadStateError";
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class UploadState {
  private constructor(
    private readonly database: Database,
    readonly path: string,
    readonly readonly: boolean,
  ) {}

  static async open(path = DEFAULT_UPLOAD_STATE_PATH): Promise<UploadState> {
    await mkdir(dirname(path), { mode: 0o700, recursive: true });
    if (process.platform !== "win32") await chmod(dirname(path), 0o700);

    const database = new Database(path, { create: true, strict: true });
    database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    database.exec(`
      CREATE TABLE IF NOT EXISTS upload_files (
        account TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        canonical_path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
        transferred_bytes INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account, endpoint, canonical_path)
      );
      CREATE TABLE IF NOT EXISTS upload_runs (
        id INTEGER PRIMARY KEY,
        account TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        concurrency INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS upload_locks (
        account TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        pid INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        PRIMARY KEY (account, endpoint)
      );
      CREATE TABLE IF NOT EXISTS known_hosts (
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        PRIMARY KEY (host, port)
      );
    `);
    if (process.platform !== "win32") await chmod(path, 0o600);
    return new UploadState(database, path, false);
  }

  static async openReadonly(path = DEFAULT_UPLOAD_STATE_PATH): Promise<UploadState | null> {
    try {
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      return new UploadState(new Database(path, { readonly: true, strict: true }), path, true);
    } catch (error) {
      throw new UploadStateError(`Unable to read upload progress at ${path}`, { cause: error });
    }
  }

  close(): void {
    this.database.close();
  }

  private assertWritable(): void {
    if (this.readonly) throw new UploadStateError("Upload progress database is read-only");
  }

  isCompleted(file: UploadStateFile): boolean {
    try {
      return Boolean(
        this.database
          .query(
            `SELECT 1 FROM upload_files
             WHERE account = ? AND endpoint = ? AND canonical_path = ?
               AND size = ? AND mtime_ms = ? AND status = 'completed'`,
          )
          .get(file.account, file.endpoint, file.path, file.size, file.mtimeMs),
      );
    } catch (error) {
      if (this.readonly && String(error).includes("no such table")) return false;
      throw error;
    }
  }

  prepareFile(file: UploadStateFile): void {
    this.assertWritable();
    this.database
      .query(
        `INSERT INTO upload_files
           (account, endpoint, canonical_path, size, mtime_ms, status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(account, endpoint, canonical_path) DO UPDATE SET
           status = CASE
             WHEN size = excluded.size AND mtime_ms = excluded.mtime_ms
               AND status = 'completed' THEN 'completed'
             ELSE 'pending'
           END,
           size = excluded.size,
           mtime_ms = excluded.mtime_ms,
           transferred_bytes = CASE
             WHEN size = excluded.size AND mtime_ms = excluded.mtime_ms
               AND status = 'completed' THEN transferred_bytes
             ELSE 0
           END,
           error = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(file.account, file.endpoint, file.path, file.size, file.mtimeMs, Date.now());
  }

  setFileStatus(file: UploadStateFile, status: UploadFileStatus, error?: string): void {
    this.assertWritable();
    this.database
      .query(
        `UPDATE upload_files SET status = ?, transferred_bytes = ?, error = ?, updated_at = ?
         WHERE account = ? AND endpoint = ? AND canonical_path = ?`,
      )
      .run(
        status,
        status === "completed" ? file.size : 0,
        error ?? null,
        Date.now(),
        file.account,
        file.endpoint,
        file.path,
      );
  }

  resetInterrupted(account: string, endpoint: string): void {
    this.assertWritable();
    this.database
      .query(
        `UPDATE upload_files SET status = 'pending', transferred_bytes = 0, error = NULL,
           updated_at = ?
         WHERE account = ? AND endpoint = ? AND status IN ('in_progress', 'failed')`,
      )
      .run(Date.now(), account, endpoint);
  }

  acquireLock(account: string, endpoint: string): void {
    this.assertWritable();
    const transaction = this.database.transaction(() => {
      const lock = this.database
        .query("SELECT pid FROM upload_locks WHERE account = ? AND endpoint = ?")
        .get(account, endpoint) as { pid: number } | null;
      if (lock && lock.pid !== process.pid && processIsAlive(lock.pid)) {
        throw new UploadStateError(
          `Another upload is already running for ${account} on ${endpoint} (PID ${lock.pid})`,
        );
      }
      this.database
        .query("DELETE FROM upload_locks WHERE account = ? AND endpoint = ?")
        .run(account, endpoint);
      this.database
        .query("INSERT INTO upload_locks (account, endpoint, pid, started_at) VALUES (?, ?, ?, ?)")
        .run(account, endpoint, process.pid, Date.now());
    });
    transaction();
  }

  releaseLock(account: string, endpoint: string): void {
    if (this.readonly) return;
    this.database
      .query("DELETE FROM upload_locks WHERE account = ? AND endpoint = ? AND pid = ?")
      .run(account, endpoint, process.pid);
  }

  beginRun(account: string, endpoint: string, concurrency: number): number {
    this.assertWritable();
    const result = this.database
      .query(
        `INSERT INTO upload_runs (account, endpoint, concurrency, started_at, status)
         VALUES (?, ?, ?, ?, 'running')`,
      )
      .run(account, endpoint, concurrency, Date.now());
    return Number(result.lastInsertRowid);
  }

  finishRun(runId: number, bytes: number, status: "completed" | "partial" | "cancelled"): void {
    this.assertWritable();
    this.database
      .query("UPDATE upload_runs SET finished_at = ?, bytes = ?, status = ? WHERE id = ?")
      .run(Date.now(), bytes, status, runId);
  }

  throughput(account: string, endpoint: string, concurrency: number): ThroughputEstimate | null {
    const select = (matchConcurrency: boolean): ThroughputRow | null => {
      try {
        return this.database
          .query(
            `SELECT COALESCE(SUM(bytes), 0) AS bytes,
                    COALESCE(SUM(finished_at - started_at), 0) AS durationMs
             FROM upload_runs
             WHERE account = ? AND endpoint = ? AND status IN ('completed', 'partial')
               AND bytes > 0 AND finished_at > started_at
               ${matchConcurrency ? "AND concurrency = ?" : ""}`,
          )
          .get(
            ...(matchConcurrency ? [account, endpoint, concurrency] : [account, endpoint]),
          ) as ThroughputRow | null;
      } catch (error) {
        if (this.readonly && String(error).includes("no such table")) return null;
        throw error;
      }
    };

    const exact = select(true);
    if (exact && exact.bytes > 0 && exact.durationMs > 0) {
      return {
        bytesPerSecond: (exact.bytes * 1000) / exact.durationMs,
        source: "matching concurrency history",
      };
    }
    const endpointHistory = select(false);
    if (endpointHistory && endpointHistory.bytes > 0 && endpointHistory.durationMs > 0) {
      return {
        bytesPerSecond: (endpointHistory.bytes * 1000) / endpointHistory.durationMs,
        source: "endpoint history",
      };
    }
    return null;
  }

  getFingerprint(host: string, port: number): string | null {
    try {
      const row = this.database
        .query("SELECT fingerprint FROM known_hosts WHERE host = ? AND port = ?")
        .get(host, port) as { fingerprint: string } | null;
      return row?.fingerprint ?? null;
    } catch (error) {
      if (this.readonly && String(error).includes("no such table")) return null;
      throw error;
    }
  }

  trustFingerprint(host: string, port: number, fingerprint: string): void {
    this.assertWritable();
    const transaction = this.database.transaction(() => {
      const existing = this.database
        .query("SELECT fingerprint FROM known_hosts WHERE host = ? AND port = ?")
        .get(host, port) as { fingerprint: string } | null;
      if (existing && existing.fingerprint !== fingerprint) {
        throw new UploadStateError(
          `SFTP host key changed for ${host}:${port}: expected ${existing.fingerprint}, received ${fingerprint}`,
        );
      }
      if (!existing) {
        this.database
          .query(
            "INSERT INTO known_hosts (host, port, fingerprint, first_seen_at) VALUES (?, ?, ?, ?)",
          )
          .run(host, port, fingerprint, Date.now());
      }
    });
    transaction();
  }
}
