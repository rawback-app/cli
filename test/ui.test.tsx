import { describe, expect, test } from 'bun:test'

import { renderToString } from 'ink'

import { helpDocument } from '../src/features/cli/help.ts'
import {
  UploadProgressView,
  type UploadProgressSnapshot,
} from '../src/features/upload/progress.tsx'
import { visibleTableColumns } from '../src/ui/components.tsx'
import { type UiTableBlock } from '../src/ui/model.ts'
import { CommandOutput } from '../src/ui/output.tsx'

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
})
