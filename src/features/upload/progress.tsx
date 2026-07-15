import { Box, Text, render, type Instance } from "ink";

import { formatBytes, formatDuration } from "../../ui/format.ts";
import { type CommandOutput } from "../../ui/output.tsx";

export interface ProgressFile {
  basename: string;
  canonicalPath: string;
  size: number;
}

interface ActiveFile {
  bytes: number;
  file: ProgressFile;
}

export interface UploadProgressSnapshot {
  active: ActiveFile[];
  completedBytes: number;
  completedFiles: number;
  elapsedSeconds: number;
  totalBytes: number;
  totalFiles: number;
}

function percent(value: number, total: number): number {
  if (total === 0) return 100;
  return Math.max(0, Math.min(100, Math.floor((value / total) * 100)));
}

function ProgressBar({ value, width }: { value: number; width: number }) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * width);
  return (
    <Text>
      <Text color="cyan">{"━".repeat(filled)}</Text>
      <Text dimColor>{"─".repeat(Math.max(0, width - filled))}</Text>
    </Text>
  );
}

export function UploadProgressView({
  snapshot,
  terminalWidth,
}: {
  snapshot: UploadProgressSnapshot;
  terminalWidth: number;
}) {
  const activeBytes = snapshot.active.reduce((total, item) => total + item.bytes, 0);
  const transferred = Math.min(snapshot.totalBytes, snapshot.completedBytes + activeBytes);
  const progress = percent(transferred, snapshot.totalBytes);
  const bytesPerSecond = snapshot.elapsedSeconds > 0 ? transferred / snapshot.elapsedSeconds : 0;
  const remainingSeconds =
    bytesPerSecond > 0 ? (snapshot.totalBytes - transferred) / bytesPerSecond : Number.NaN;
  const barWidth = Math.max(12, Math.min(42, terminalWidth - 14));

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>
          Uploading {snapshot.completedFiles}/{snapshot.totalFiles} files
        </Text>
        <Text color="cyan"> {progress}%</Text>
      </Box>
      <Box>
        <ProgressBar value={progress} width={barWidth} />
      </Box>
      <Text dimColor>
        {formatBytes(transferred)} / {formatBytes(snapshot.totalBytes)}
        {bytesPerSecond > 0 ? " · " + formatBytes(bytesPerSecond) + "/s" : ""}
        {Number.isFinite(remainingSeconds) ? " · ETA " + formatDuration(remainingSeconds) : ""}
      </Text>
      {snapshot.active.slice(0, 4).map(({ bytes, file }) => (
        <Box key={file.canonicalPath}>
          <Box width={Math.max(14, terminalWidth - 14)}>
            <Text wrap="truncate-end">{file.basename}</Text>
          </Box>
          <Text dimColor>{percent(bytes, file.size)}%</Text>
        </Box>
      ))}
      {snapshot.active.length > 4 ? (
        <Text dimColor>+{snapshot.active.length - 4} more active</Text>
      ) : null}
    </Box>
  );
}

export class UploadProgressController {
  readonly #active = new Map<string, ActiveFile>();
  readonly #startedAt = Date.now();

  #completedBytes = 0;
  #completedFiles = 0;
  #instance: Instance | undefined;
  #lastRender = 0;

  constructor(
    readonly totalBytes: number,
    readonly totalFiles: number,
    readonly output: CommandOutput,
  ) {}

  start(file: ProgressFile): void {
    this.#active.set(file.canonicalPath, { bytes: 0, file });
    if (this.output.interactive) {
      this.#render(true);
    } else {
      this.output.info("Uploading " + file.basename + " (" + formatBytes(file.size) + ")");
    }
  }

  update(file: ProgressFile, bytes: number): void {
    this.#active.set(file.canonicalPath, {
      bytes: Math.min(file.size, Math.max(0, bytes)),
      file,
    });
    this.#render(false);
  }

  complete(file: ProgressFile): void {
    this.#active.delete(file.canonicalPath);
    this.#completedBytes += file.size;
    this.#completedFiles += 1;
    if (this.output.interactive) {
      this.#render(true);
    } else {
      this.output.success("Uploaded " + file.basename);
    }
  }

  fail(file: ProgressFile): void {
    this.#active.delete(file.canonicalPath);
    this.#render(true);
  }

  async finish(): Promise<void> {
    if (this.#instance === undefined) return;
    this.#render(true);
    const instance = this.#instance;
    this.#instance = undefined;
    await instance.waitUntilRenderFlush();
    instance.unmount();
    await instance.waitUntilExit();
  }

  #snapshot(): UploadProgressSnapshot {
    return {
      active: [...this.#active.values()],
      completedBytes: this.#completedBytes,
      completedFiles: this.#completedFiles,
      elapsedSeconds: Math.max(0.001, (Date.now() - this.#startedAt) / 1000),
      totalBytes: this.totalBytes,
      totalFiles: this.totalFiles,
    };
  }

  #render(force: boolean): void {
    if (!this.output.interactive) return;
    const now = Date.now();
    if (!force && now - this.#lastRender < 100) return;
    this.#lastRender = now;
    const view = (
      <UploadProgressView snapshot={this.#snapshot()} terminalWidth={this.output.columns} />
    );
    if (this.#instance) {
      this.#instance.rerender(view);
    } else {
      this.#instance = render(view, {
        stdout: process.stdout,
        stderr: process.stderr,
        stdin: process.stdin,
        interactive: true,
        patchConsole: true,
        maxFps: 20,
      });
    }
  }
}
