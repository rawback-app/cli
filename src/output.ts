export function sanitizeCell(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function formatTable(headers: string[], rows: string[][]): string {
  const cleanHeaders = headers.map(sanitizeCell);
  const cleanRows = rows.map((row) => row.map((cell) => sanitizeCell(cell)));
  const widths = cleanHeaders.map((header, index) =>
    Math.max(header.length, ...cleanRows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");

  return [
    formatRow(cleanHeaders),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...cleanRows.map(formatRow),
  ].join("\n");
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 Bytes";
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  const amount = bytes / 1024 ** index;
  return `${Number(amount.toFixed(Math.max(0, decimals)))} ${sizes[index]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatTimestamp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString();
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}
