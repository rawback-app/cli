import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runLogsPath, runLogsPurge, runLogsShow } from '../src/logs.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
  process.exitCode = undefined
})

function logDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'rawback-cli-logs-'))
  directories.push(directory)
  return directory
}

function record(level: string, message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    time: '2026-09-21T10:00:00.000Z',
    level,
    levelValue: 30,
    msg: message,
    ...extra,
  })
}

function capture() {
  const lines: string[] = []
  const errors: string[] = []
  return {
    lines,
    errors,
    stdout: (message: string) => lines.push(message),
    stderr: (message: string) => errors.push(message),
    json: <T>() => JSON.parse(lines.join('\n')) as T,
  }
}

describe('rawback logs path', () => {
  test('reports every log file with its size', async () => {
    const directory = logDirectory()
    writeFileSync(join(directory, 'cli.log'), 'aaaa')
    writeFileSync(join(directory, 'desktop.log'), 'bb')
    const output = capture()

    await runLogsPath({ json: true }, { logDirectory: directory, stdout: output.stdout })

    expect(
      output.json<{ directory: string; totalBytes: number; files: Record<string, unknown>[] }>(),
    ).toEqual({
      directory,
      totalBytes: 6,
      files: [
        {
          name: 'cli.log',
          path: join(directory, 'cli.log'),
          bytes: 4,
          modifiedAt: expect.any(String),
        },
        {
          name: 'desktop.log',
          path: join(directory, 'desktop.log'),
          bytes: 2,
          modifiedAt: expect.any(String),
        },
      ],
    })
  })

  test('renders a document when JSON was not asked for', async () => {
    const directory = logDirectory()
    const output = capture()
    await runLogsPath({}, { logDirectory: directory, stdout: output.stdout })
    expect(output.lines.join('\n')).toContain('No log files yet.')
  })
})

describe('rawback logs show', () => {
  test('prints the most recent records, newest last', async () => {
    const directory = logDirectory()
    writeFileSync(
      join(directory, 'cli.log'),
      [record('info', 'one'), record('info', 'two'), record('info', 'three')].join('\n') + '\n',
    )
    const output = capture()

    await runLogsShow({ json: true, lines: 2 }, { logDirectory: directory, stdout: output.stdout })

    const shown = output.json<{ lines: { msg: string }[] }>()
    expect(shown.lines.map((line) => line.msg)).toEqual(['two', 'three'])
  })

  test('filters to the given level and above', async () => {
    const directory = logDirectory()
    writeFileSync(
      join(directory, 'cli.log'),
      [record('debug', 'noisy'), record('warn', 'notable'), record('error', 'bad')].join('\n'),
    )
    const output = capture()

    await runLogsShow(
      { json: true, level: 'warn' },
      { logDirectory: directory, stdout: output.stdout },
    )

    expect(output.json<{ lines: { msg: string }[] }>().lines.map((line) => line.msg)).toEqual([
      'notable',
      'bad',
    ])
  })

  test('surfaces the trace ID so it can be quoted in a support report', async () => {
    const directory = logDirectory()
    writeFileSync(
      join(directory, 'cli.log'),
      record('warn', 'http failed', { event: 'http.request', ids: { traceId: 'abc123' } }),
    )
    const output = capture()

    await runLogsShow({ json: true }, { logDirectory: directory, stdout: output.stdout })
    expect(output.json<{ lines: { traceId?: string }[] }>().lines[0]?.traceId).toBe('abc123')
  })

  test('shows a torn line rather than dropping the evidence', async () => {
    const directory = logDirectory()
    writeFileSync(join(directory, 'cli.log'), `${record('info', 'fine')}\n{"half":`)
    const output = capture()

    await runLogsShow({ json: true }, { logDirectory: directory, stdout: output.stdout })
    expect(output.json<{ lines: { raw?: string }[] }>().lines[1]?.raw).toBe('{"half":')
  })

  test('reads only the tail of a large file', async () => {
    const directory = logDirectory()
    const many = Array.from({ length: 5_000 }, (_, index) => record('info', `line-${index}`))
    writeFileSync(join(directory, 'cli.log'), `${many.join('\n')}\n`)
    const output = capture()

    await runLogsShow({ json: true, lines: 3 }, { logDirectory: directory, stdout: output.stdout })
    expect(output.json<{ lines: { msg: string }[] }>().lines.map((line) => line.msg)).toEqual([
      'line-4997',
      'line-4998',
      'line-4999',
    ])
  })

  test('reports cleanly when the file does not exist yet', async () => {
    const directory = logDirectory()
    const output = capture()
    await runLogsShow({ json: true }, { logDirectory: directory, stdout: output.stdout })
    expect(output.json<{ lines: unknown[] }>().lines).toEqual([])
    expect(process.exitCode).toBeUndefined()
  })

  test('rejects an out-of-range line count and an unknown level', async () => {
    const directory = logDirectory()
    await expect(runLogsShow({ lines: 0 }, { logDirectory: directory })).rejects.toThrow('--lines')
    await expect(runLogsShow({ level: 'loud' }, { logDirectory: directory })).rejects.toThrow(
      '--level',
    )
  })

  test('reads the app the caller asked for', async () => {
    const directory = logDirectory()
    writeFileSync(join(directory, 'desktop.log'), record('info', 'from desktop'))
    const output = capture()

    await runLogsShow(
      { app: 'desktop', json: true },
      { logDirectory: directory, stdout: output.stdout },
    )
    expect(output.json<{ lines: { msg: string }[] }>().lines[0]?.msg).toBe('from desktop')
  })
})

describe('rawback logs purge', () => {
  test('deletes the log files and leaves everything else alone', async () => {
    const directory = logDirectory()
    writeFileSync(join(directory, 'cli.log'), 'aaa')
    writeFileSync(join(directory, 'cli.1.log'), 'aa')
    // `logging.directory` is user-controlled, so purging must stay surgical.
    writeFileSync(join(directory, 'notes.txt'), 'keep me')
    const output = capture()

    await runLogsPurge(
      { json: true, yes: true },
      { logDirectory: directory, stdout: output.stdout },
    )

    expect(output.json<{ removed: string[]; bytes: number }>()).toMatchObject({ bytes: 5 })
    expect(readdirSync(directory)).toEqual(['notes.txt'])
  })

  test('narrows to one app when asked', async () => {
    const directory = logDirectory()
    writeFileSync(join(directory, 'cli.log'), 'a')
    writeFileSync(join(directory, 'desktop.log'), 'a')
    const output = capture()

    await runLogsPurge(
      { app: 'desktop', json: true, yes: true },
      { logDirectory: directory, stdout: output.stdout },
    )
    expect(readdirSync(directory)).toEqual(['cli.log'])
  })

  test('rejects an unknown app rather than deleting the wrong thing', async () => {
    const directory = logDirectory()
    await expect(
      runLogsPurge({ app: 'server', yes: true }, { logDirectory: directory }),
    ).rejects.toThrow('--app')
  })

  test('asks before deleting, and leaves the files when the answer is no', async () => {
    const directory = logDirectory()
    writeFileSync(join(directory, 'cli.log'), 'aaa')
    const output = capture()
    const asked: string[] = []

    await runLogsPurge(
      {},
      {
        logDirectory: directory,
        prompts: {
          confirm: async (message) => {
            asked.push(message)
            return false
          },
        },
        stdout: output.stdout,
      },
    )

    expect(asked[0]).toContain('Delete 1 log file')
    expect(readdirSync(directory)).toEqual(['cli.log'])
    expect(output.lines.join('')).toContain('Left the log files in place')
  })

  test('deletes once the prompt is answered yes', async () => {
    const directory = logDirectory()
    writeFileSync(join(directory, 'cli.log'), 'aaa')
    const output = capture()

    await runLogsPurge(
      {},
      {
        logDirectory: directory,
        prompts: { confirm: async () => true },
        stdout: output.stdout,
      },
    )
    expect(readdirSync(directory)).toEqual([])
  })

  test('does not prompt when there is nothing to delete', async () => {
    const directory = logDirectory()
    const output = capture()

    await runLogsPurge(
      {},
      {
        logDirectory: directory,
        prompts: {
          confirm: async () => {
            throw new Error('should not have asked')
          },
        },
        stdout: output.stdout,
      },
    )
    expect(output.lines.join('')).toContain('No log files to delete')
  })
})
