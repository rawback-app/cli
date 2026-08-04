import { Box, Text } from 'ink'

import { describeCameraError } from '../../camera-errors.ts'
import type { ApiEntry, Args } from '../../camera-registry.ts'
import { JsonView } from './json-view.tsx'
import { ParamForm } from './param-form.tsx'

export type RunState =
  | { status: 'idle' }
  | { status: 'running'; entryId: string }
  | { status: 'ok'; entryId: string; result: unknown; ms: number }
  | { status: 'error'; entryId: string; error: unknown; ms: number }

export type DetailView = 'result' | 'form' | 'confirm'

interface Props {
  entry: ApiEntry
  view: DetailView
  runState: RunState
  pendingArgs: Args | null
  jsonHeight: number
  scrollOffset: number
  supported: boolean
  onSubmit: (args: Args) => void
  onCancel: () => void
}

export function EndpointDetail({
  entry,
  view,
  runState,
  pendingArgs,
  jsonHeight,
  scrollOffset,
  supported,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Header entry={entry} supported={supported} />
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {view === 'form' ? (
          <ParamForm entry={entry} onSubmit={onSubmit} onCancel={onCancel} />
        ) : view === 'confirm' ? (
          <Confirm entry={entry} args={pendingArgs} />
        ) : (
          <Result
            entry={entry}
            runState={runState}
            jsonHeight={jsonHeight}
            scrollOffset={scrollOffset}
          />
        )}
      </Box>
    </Box>
  )
}

function Header({ entry, supported }: { entry: ApiEntry; supported: boolean }) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{entry.id}</Text>
        <Text dimColor>{`  doc ${entry.doc}`}</Text>
      </Text>
      <Text>
        <Text color="magenta">{entry.method}</Text>
        {entry.mutates ? (
          <Text color="yellow"> · changes the camera</Text>
        ) : (
          <Text dimColor> · read-only</Text>
        )}
      </Text>
      {!supported ? (
        <Text color="yellow">⚠ this camera does not advertise the endpoint</Text>
      ) : null}
      {entry.unreliable === true ? (
        <Text color="yellow">⚠ known to misbehave on real hardware</Text>
      ) : null}
    </Box>
  )
}

function Confirm({ entry, args }: { entry: ApiEntry; args: Args | null }) {
  return (
    <Box flexDirection="column">
      <Text color="yellow">⚠ This call changes the camera.</Text>
      {args && Object.keys(args).length > 0 ? (
        <Text dimColor>{`args: ${oneLine(args)}`}</Text>
      ) : null}
      <Box marginTop={1}>
        <Text>
          Run <Text bold>{entry.label}</Text>? <Text color="green">y</Text> = yes ·{' '}
          <Text color="red">n / esc</Text> = cancel
        </Text>
      </Box>
    </Box>
  )
}

function Result({
  entry,
  runState,
  jsonHeight,
  scrollOffset,
}: {
  entry: ApiEntry
  runState: RunState
  jsonHeight: number
  scrollOffset: number
}) {
  const mine =
    'entryId' in runState && runState.entryId === entry.id
      ? runState
      : ({ status: 'idle' } as const)

  if (mine.status === 'idle') {
    return (
      <Text dimColor>
        {entry.params.length > 0
          ? 'press enter to fill in arguments, then run'
          : entry.mutates
            ? 'press enter to run (you will be asked to confirm)'
            : 'press enter to run'}
      </Text>
    )
  }
  if (mine.status === 'running') return <Text color="cyan">running…</Text>

  if (mine.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">{`✗ failed · ${mine.ms}ms`}</Text>
        <Text>{describeCameraError(mine.error)}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text color="green">{`✓ ok · ${mine.ms}ms`}</Text>
      <Box marginTop={1}>
        <JsonView value={mine.result} height={jsonHeight} offset={scrollOffset} />
      </Box>
    </Box>
  )
}

function oneLine(args: Args): string {
  try {
    return JSON.stringify(args)
  } catch {
    return String(args)
  }
}
