import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { useMemo, useRef, useState } from 'react'

import { listEntries, type ApiEntry, type Args } from '../../camera-registry.ts'
import type { CameraSession } from '../../camera-session.ts'
import { ApiList } from './api-list.tsx'
import { EndpointDetail, type DetailView, type RunState } from './endpoint-detail.tsx'
import { TextField } from './text-field.tsx'

type Focus = 'list' | 'filter' | 'form'

const ENTRIES = listEntries()

/**
 * The two-column endpoint explorer.
 *
 * The session is built and connected *before* this renders, so a connection
 * failure surfaces as an ordinary CLI error rather than a red line inside a
 * half-drawn UI — and the header can show the real device from the first frame.
 */
export function CameraExplorer({ session }: { session: CameraSession }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  const bodyHeight = Math.max(6, rows - 4)
  const listHeight = Math.max(3, bodyHeight - 2)
  const jsonHeight = Math.max(3, bodyHeight - 5)

  const [filter, setFilter] = useState('')
  const [focus, setFocusState] = useState<Focus>('list')
  // Mirror focus in a ref so a mode switch is visible to the very next key in
  // the same input burst; state updates only land on the next render.
  const focusRef = useRef<Focus>('list')
  const setFocus = (next: Focus) => {
    focusRef.current = next
    setFocusState(next)
  }
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState<DetailView>('result')
  const [runState, setRunState] = useState<RunState>({ status: 'idle' })
  const [pendingArgs, setPendingArgs] = useState<Args | null>(null)
  const [scroll, setScroll] = useState(0)

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? ENTRIES.filter((entry) => entry.id.toLowerCase().includes(query)) : ENTRIES
  }, [filter])

  const index = Math.min(selected, Math.max(0, filtered.length - 1))
  const current = filtered[index]

  const isSupported = (entry: ApiEntry): boolean =>
    entry.suffix === undefined || session.supports(entry.suffix)

  async function runEntry(entry: ApiEntry, args: Args): Promise<void> {
    setView('result')
    setScroll(0)
    setRunState({ status: 'running', entryId: entry.id })
    const started = Date.now()
    try {
      const result = await entry.run(session, args)
      setRunState({ status: 'ok', entryId: entry.id, result, ms: Date.now() - started })
    } catch (error) {
      setRunState({ status: 'error', entryId: entry.id, error, ms: Date.now() - started })
    }
  }

  function activate(entry: ApiEntry): void {
    if (entry.params.length > 0) {
      setView('form')
      setFocus('form')
      return
    }
    if (entry.mutates) {
      setPendingArgs({})
      setView('confirm')
      return
    }
    void runEntry(entry, {})
  }

  function resetForSelection(): void {
    setView('result')
    setScroll(0)
    setPendingArgs(null)
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return exit()
    if (focusRef.current === 'form') return // the form owns the keyboard
    if (focusRef.current === 'filter') {
      if (key.escape || key.return) setFocus('list')
      return // typing is handled by the filter field
    }

    if (view === 'confirm' && current) {
      if (input === 'y' || input === 'Y') {
        const args = pendingArgs ?? {}
        setView('result')
        setPendingArgs(null)
        void runEntry(current, args)
      } else if (input === 'n' || input === 'N' || key.escape) {
        setView('result')
        setPendingArgs(null)
      }
      return
    }

    if (input === 'q') return exit()
    if (input === '/') {
      setFocus('filter')
      return
    }
    if (key.upArrow || input === 'k') {
      setSelected(Math.max(0, index - 1))
      resetForSelection()
    } else if (key.downArrow || input === 'j') {
      setSelected(Math.min(filtered.length - 1, index + 1))
      resetForSelection()
    } else if (input === '[') {
      setScroll((offset) => Math.max(0, offset - 1))
    } else if (input === ']') {
      setScroll((offset) => offset + 1)
    } else if (key.return && current) {
      activate(current)
    }
  })

  return (
    <Box flexDirection="column">
      <ConnectionHeader session={session} />
      <Box>
        <Box
          flexDirection="column"
          width={38}
          paddingX={1}
          borderStyle="single"
          borderTop={false}
          borderLeft={false}
          borderBottom={false}
        >
          <Text bold>{`APIs (${filtered.length}/${ENTRIES.length})`}</Text>
          {focus === 'filter' ? (
            <Box>
              <Text color="cyan">/ </Text>
              <TextField
                value={filter}
                onChange={(value) => {
                  setFilter(value)
                  setSelected(0)
                  resetForSelection()
                }}
                focus
                placeholder="filter…"
              />
            </Box>
          ) : filter ? (
            <Text dimColor>{`/ ${filter}`}</Text>
          ) : null}
          {filtered.length === 0 ? (
            <Text dimColor>no matches</Text>
          ) : (
            <ApiList
              entries={filtered}
              selected={index}
              height={listHeight - (filter || focus === 'filter' ? 1 : 0)}
              unsupported={(entry) => !isSupported(entry)}
            />
          )}
        </Box>
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          {current ? (
            <EndpointDetail
              entry={current}
              view={view}
              runState={runState}
              pendingArgs={pendingArgs}
              jsonHeight={jsonHeight}
              scrollOffset={scroll}
              supported={isSupported(current)}
              onSubmit={(args) => {
                setFocus('list')
                if (current.mutates) {
                  setPendingArgs(args)
                  setView('confirm')
                } else {
                  void runEntry(current, args)
                }
              }}
              onCancel={() => {
                setFocus('list')
                setView('result')
              }}
            />
          ) : (
            <Text dimColor>Select an endpoint on the left.</Text>
          )}
        </Box>
      </Box>
      <Footer focus={focus} view={view} />
    </Box>
  )
}

function ConnectionHeader({ session }: { session: CameraSession }) {
  const device = session.snapshot?.device
  const where = `${session.target.host}:${session.target.port} (${session.target.useTLS ? 'https' : 'http'})`
  return (
    <Text>
      <Text color="green">● </Text>
      <Text bold>{device?.productName ?? 'camera'}</Text>
      <Text dimColor>{`  ${where}`}</Text>
      {device?.firmwareVersion !== undefined ? (
        <Text dimColor>{`  fw ${device.firmwareVersion}`}</Text>
      ) : null}
      <Text dimColor>{`  ${session.apiVersion}`}</Text>
    </Text>
  )
}

function Footer({ focus, view }: { focus: Focus; view: DetailView }) {
  const hint =
    focus === 'filter'
      ? 'type to filter · enter/esc leave the filter'
      : view === 'confirm'
        ? 'y run · n/esc cancel'
        : focus === 'form'
          ? '↑/↓ field · space toggle · ←/→ cycle · enter run · esc cancel'
          : '↑/↓ move · enter run · / filter · [ / ] scroll · q quit'
  return (
    <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false}>
      <Text dimColor>{hint}</Text>
    </Box>
  )
}
