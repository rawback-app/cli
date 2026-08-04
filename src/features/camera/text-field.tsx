import { Text } from 'ink'
import { useInput } from 'ink'

interface Props {
  value: string
  onChange: (value: string) => void
  focus: boolean
  placeholder?: string
}

/**
 * A minimal single-line text input.
 *
 * Deliberately local rather than `ink-text-input`: every dependency is compiled
 * into the standalone binary, this one exists to read printable characters and
 * handle backspace, and the repo already hand-rolls its Ink primitives in
 * `src/ui/components.tsx`.
 */
export function TextField({ value, onChange, focus, placeholder }: Props) {
  useInput(
    (input, key) => {
      // Navigation and submission belong to the parent form.
      if (key.return || key.escape || key.tab || key.upArrow || key.downArrow) return

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1))
        return
      }
      if (key.ctrl) {
        if (input === 'u') onChange('')
        return
      }
      if (key.meta) return
      // Ink reports a paste or a burst as one string; take it whole.
      if (input.length > 0) onChange(value + input)
    },
    { isActive: focus },
  )

  if (value.length === 0) {
    return (
      <Text dimColor={!focus}>
        {focus ? <Text inverse> </Text> : null}
        {placeholder !== undefined ? <Text dimColor>{placeholder}</Text> : null}
      </Text>
    )
  }

  return (
    <Text>
      {value}
      {focus ? <Text inverse> </Text> : null}
    </Text>
  )
}
