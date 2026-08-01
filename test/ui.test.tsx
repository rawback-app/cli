import { describe, expect, test } from 'bun:test'

import { renderToString } from 'ink'

import { helpDocument } from '../src/features/cli/help.ts'
import { PhotoCheckProgressView } from '../src/features/photos/check-progress.tsx'
import {
  UploadProgressView,
  type UploadProgressSnapshot,
} from '../src/features/upload/progress.tsx'
import { visibleTableColumns } from '../src/ui/components.tsx'
import { type UiTableBlock } from '../src/ui/model.ts'
import { type ActivityHandle, CommandOutput, createActivityStop } from '../src/ui/output.tsx'

describe('Ink output', () => {
  test('keeps required table columns and drops lower-priority detail on narrow terminals', () => {
    const table: UiTableBlock = {
      type: 'table',
      columns: [
        { key: 'id', label: 'ID', required: true },
        { key: 'name', label: 'Name', priority: 1 },
        { key: 'description', label: 'Description', priority: 9 },
      ],
      rows: [{ id: 1, name: 'Photo', description: 'A long description' }],
    }

    expect(visibleTableColumns(table, 12).map((column) => column.key)).toEqual(['id', 'name'])
    expect(visibleTableColumns(table, 80).map((column) => column.key)).toEqual([
      'id',
      'name',
      'description',
    ])
  })

  test('keeps JSON exact and routes errors to stderr', () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const output = new CommandOutput({
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })

    output.json({ ok: true })
    output.error('Request failed', 'Try again.')

    expect(stdout).toEqual(['{\n  "ok": true\n}'])
    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toContain('✗ Request failed')
    expect(stderr[0]).toContain('Hint: Try again.')
  })

  test('clears an activity before unmounting it and only stops once', async () => {
    const lifecycle: string[] = []
    const stop = createActivityStop(
      {
        clear() {
          lifecycle.push('clear')
        },
        unmount() {
          lifecycle.push('unmount')
        },
        async waitUntilExit() {
          lifecycle.push('exit')
        },
      },
      () => lifecycle.push('timer'),
      () => lifecycle.push('detach'),
    )

    await stop()
    await stop()

    expect(lifecycle).toEqual(['timer', 'detach', 'clear', 'unmount', 'exit'])
  })

  test('stops activity output after fulfilled and rejected operations', async () => {
    class TrackingOutput extends CommandOutput {
      stops = 0

      override startActivity(_label: string, _enabled = true): ActivityHandle {
        return {
          update() {},
          stop: async () => {
            this.stops += 1
          },
        }
      }
    }

    const output = new TrackingOutput()
    expect(await output.withActivity('Loading…', async () => 'done')).toBe('done')
    expect(output.stops).toBe(1)

    await expect(
      output.withActivity('Loading…', async () => {
        throw new Error('Request failed')
      }),
    ).rejects.toThrow('Request failed')
    expect(output.stops).toBe(2)
  })

  test('parses indented Yargs options into distinct help entries', () => {
    const output = new CommandOutput({ columns: 80 })
    const rendered = output.render(
      helpDocument(
        [
          'rawback photos list',
          '',
          'List photos',
          '',
          'Options:',
          '  -h, --help       display help  [boolean]',
          '      --page-size  photos per page [number]',
        ].join('\n'),
      ),
    )

    expect(rendered).toContain('Usage rawback photos list')
    expect(rendered).toContain('--page-size')
    expect(rendered).toContain('photos per page')
  })

  test('renders aggregate upload progress with speed, ETA, and active files', () => {
    const snapshot: UploadProgressSnapshot = {
      active: [
        {
          bytes: 500,
          file: { basename: 'photo.jpg', canonicalPath: '/photo.jpg', size: 1_000 },
        },
      ],
      completedBytes: 0,
      completedFiles: 0,
      elapsedSeconds: 2,
      totalBytes: 1_000,
      totalFiles: 1,
    }

    const rendered = renderToString(<UploadProgressView snapshot={snapshot} terminalWidth={80} />, {
      columns: 80,
    })

    expect(rendered).toContain('Uploading 0/1 files 50%')
    expect(rendered).toContain('250 Bytes/s')
    expect(rendered).toContain('ETA 2s')
    expect(rendered).toContain('photo.jpg')
  })

  test('renders indeterminate scanning and determinate photo-check progress', () => {
    const scanning = renderToString(
      <PhotoCheckProgressView
        frame={0}
        progress={{ stage: 'scanning', completed: 1_250 }}
        terminalWidth={80}
      />,
      { columns: 80 },
    )
    const metadata = renderToString(
      <PhotoCheckProgressView
        frame={0}
        progress={{ stage: 'metadata', completed: 250, total: 1_000 }}
        terminalWidth={80}
      />,
      { columns: 80 },
    )
    const checking = renderToString(
      <PhotoCheckProgressView
        frame={0}
        progress={{ stage: 'checking', completed: 500, total: 1_000 }}
        terminalWidth={80}
      />,
      { columns: 80 },
    )

    expect(scanning).toContain('Scanning files — 1,250 scanned')
    expect(metadata).toContain('Reading photo metadata — 250 of 1,000 (25%)')
    expect(checking).toContain('Checking Rawback — 500 of 1,000 (50%)')
  })
})
