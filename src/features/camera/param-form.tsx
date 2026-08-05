import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

import { validateArgs, type ApiEntry, type Args, type Param } from '../../camera-registry.ts'
import { TextField } from './text-field.tsx'

interface Props {
  entry: ApiEntry
  onSubmit: (args: Args) => void
  onCancel: () => void
}

/**
 * Collects an entry's arguments. Text fields delegate typing to `TextField`;
 * this component's `useInput` handles only field navigation and the special
 * keys, so plain characters fall through to the focused input.
 *
 * Submission goes through the registry's own `validateArgs`, so a form and a
 * `--arg` invocation cannot accept different things.
 */
export function ParamForm({ entry, onSubmit, onCancel }: Props) {
  const params = entry.params
  const [text, setText] = useState<Record<string, string>>(() => initialText(params))
  const [booleans, setBooleans] = useState<Record<string, boolean>>(() => initialBooleans(params))
  const [enums, setEnums] = useState<Record<string, number>>(() => initialEnums(params))
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | undefined>()

  const activeParam = params[active]

  useInput((input, key) => {
    if (key.escape) return onCancel()
    if (key.return) return submit()

    if (key.downArrow || (key.tab && !key.shift)) {
      setActive((index) => (index + 1) % params.length)
      return
    }
    if (key.upArrow || (key.tab && key.shift)) {
      setActive((index) => (index - 1 + params.length) % params.length)
      return
    }

    if (!activeParam) return
    if (activeParam.kind === 'boolean' && input === ' ') {
      setBooleans((current) => ({ ...current, [activeParam.name]: !current[activeParam.name] }))
      return
    }
    if (activeParam.kind === 'enum') {
      const options = activeParam.options
      if (key.rightArrow) {
        setEnums((current) => ({
          ...current,
          [activeParam.name]: ((current[activeParam.name] ?? 0) + 1) % options.length,
        }))
      }
      if (key.leftArrow) {
        setEnums((current) => ({
          ...current,
          [activeParam.name]:
            ((current[activeParam.name] ?? 0) - 1 + options.length) % options.length,
        }))
      }
    }
    // Letters and space for text fields fall through to the focused TextField.
  })

  function submit(): void {
    const args: Args = {}
    for (const param of params) {
      if (param.kind === 'boolean') {
        args[param.name] = booleans[param.name] ?? false
        continue
      }
      if (param.kind === 'enum') {
        // noUncheckedIndexedAccess: fall back rather than assert.
        args[param.name] = param.options[enums[param.name] ?? 0] ?? param.options[0] ?? ''
        continue
      }
      const raw = (text[param.name] ?? '').trim()
      if (raw === '') {
        // Leave an empty optional out entirely, per exactOptionalPropertyTypes.
        if (!param.required) continue
        setError(`${param.name} is required`)
        return
      }
      if (param.kind === 'number') {
        const value = Number(raw)
        if (!Number.isFinite(value)) {
          setError(`${param.name} must be a number`)
          return
        }
        args[param.name] = value
        continue
      }
      if (param.kind === 'json') {
        try {
          args[param.name] = JSON.parse(raw)
        } catch (parseError) {
          setError(
            `${param.name} must be JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          )
          return
        }
        continue
      }
      args[param.name] = raw
    }

    try {
      validateArgs(entry, args)
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : String(validationError))
      return
    }
    setError(undefined)
    onSubmit(args)
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>
        arguments — ↑/↓ field · space toggle · ←/→ cycle · enter run · esc cancel
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {params.map((param, index) => (
          <Box key={param.name}>
            <Box width={22}>
              <Text {...(index === active ? { color: 'cyan' } : {})}>
                {index === active ? '▸ ' : '  '}
                {param.name}
                {param.required ? '*' : ''}
              </Text>
            </Box>
            <Field
              param={param}
              focused={index === active}
              text={text[param.name] ?? ''}
              boolean={booleans[param.name] ?? false}
              enumIndex={enums[param.name] ?? 0}
              onText={(value) => setText((current) => ({ ...current, [param.name]: value }))}
            />
          </Box>
        ))}
      </Box>
      {error !== undefined ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function Field({
  param,
  focused,
  text,
  boolean,
  enumIndex,
  onText,
}: {
  param: Param
  focused: boolean
  text: string
  boolean: boolean
  enumIndex: number
  onText: (value: string) => void
}) {
  if (param.kind === 'boolean') {
    return <Text {...(boolean ? { color: 'green' } : {})}>{boolean ? 'true' : 'false'}</Text>
  }
  if (param.kind === 'enum') {
    const value = param.options[enumIndex] ?? param.options[0] ?? ''
    return (
      <Text>
        <Text dimColor>{'← '}</Text>
        <Text color="cyan">{value}</Text>
        <Text dimColor>{' →'}</Text>
      </Text>
    )
  }
  return (
    <TextField
      value={text}
      onChange={onText}
      focus={focused}
      {...('placeholder' in param && param.placeholder !== undefined
        ? { placeholder: param.placeholder }
        : {})}
    />
  )
}

function initialText(params: readonly Param[]): Record<string, string> {
  const initial: Record<string, string> = {}
  for (const param of params) {
    if (param.kind === 'string' || param.kind === 'number' || param.kind === 'json') {
      initial[param.name] = ''
    }
  }
  return initial
}

function initialBooleans(params: readonly Param[]): Record<string, boolean> {
  const initial: Record<string, boolean> = {}
  for (const param of params) if (param.kind === 'boolean') initial[param.name] = false
  return initial
}

function initialEnums(params: readonly Param[]): Record<string, number> {
  const initial: Record<string, number> = {}
  for (const param of params) if (param.kind === 'enum') initial[param.name] = 0
  return initial
}
