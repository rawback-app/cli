export function sanitizeCell(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 Bytes'
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
  const amount = bytes / 1024 ** index
  return `${Number(amount.toFixed(Math.max(0, decimals)))} ${sizes[index]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  if (minutes < 60) {
    return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export function formatTimestamp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString()
}

/** UTC calendar day for a unix-seconds timestamp, so output is timezone-stable. */
export function formatDate(value: number | null | undefined): string {
  const timestamp = formatTimestamp(value)
  return timestamp === '—' ? timestamp : timestamp.slice(0, 10)
}

/** Renders a 0..1 ratio; values above 1 are reported honestly as over 100%. */
export function formatPercent(ratio: number | undefined, decimals = 0): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return '—'
  const percent = Math.max(0, ratio) * 100
  return `${percent.toFixed(Math.max(0, decimals))}%`
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  // Pin the locale so output does not depend on the machine running the CLI.
  return value.toLocaleString('en-US')
}

/**
 * Human phrasing for an upcoming reset, or `undefined` when there is nothing
 * useful to say — the caller drops the clause rather than printing a stale or
 * negative countdown.
 */
export function formatRelativeDays(
  target: number | null | undefined,
  now: number,
): string | undefined {
  if (target === null || target === undefined || !Number.isFinite(target)) return undefined
  if (!Number.isFinite(now)) return undefined
  const days = Math.ceil((target - now) / 86_400)
  if (days < 0) return undefined
  if (days === 0) return 'today'
  return days === 1 ? 'in 1 day' : `in ${String(days)} days`
}
