import { Box, Text } from 'ink'

interface Props {
  value: unknown
  /** Rows available for the body, one JSON line per row. */
  height: number
  offset: number
}

/** Pretty-prints a value as JSON, windowed to `height` rows from `offset`. */
export function JsonView({ value, height, offset }: Props) {
  const lines = stringify(value).split('\n')
  const max = Math.max(1, height)
  const start = Math.min(offset, Math.max(0, lines.length - max))
  const window = lines.slice(start, start + max)
  const truncated = lines.length > max

  return (
    <Box flexDirection="column">
      {window.map((line, index) => (
        <Text key={start + index} wrap="truncate-end">
          {line || ' '}
        </Text>
      ))}
      {truncated ? (
        <Text dimColor>
          {`— lines ${start + 1}–${start + window.length} of ${lines.length} · [ / ] to scroll —`}
        </Text>
      ) : null}
    </Box>
  )
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '(no body — the request succeeded)'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
