import { render, renderToString, type Instance } from 'ink'

import { ActivityView, DocumentView } from './components.tsx'
import { type UiDocument, type UiTone } from './model.ts'

export interface CommandOutputOptions {
  stdout?: (message: string) => void
  stderr?: (message: string) => void
  columns?: number
  interactive?: boolean
}

export interface ActivityHandle {
  update(label: string): void
  stop(): Promise<void>
}

export function createActivityStop(
  instance: Pick<Instance, 'clear' | 'unmount' | 'waitUntilExit'>,
  stopAnimation: () => void,
  detachInstance: () => void,
): ActivityHandle['stop'] {
  let current: typeof instance | undefined = instance

  return async () => {
    if (current === undefined) return
    stopAnimation()
    const stopping = current
    current = undefined
    detachInstance()
    stopping.clear()
    stopping.unmount()
    await stopping.waitUntilExit()
  }
}

export class CommandOutput {
  readonly columns: number
  readonly interactive: boolean

  readonly #stdout: (message: string) => void
  readonly #stderr: (message: string) => void

  constructor(options: CommandOutputOptions = {}) {
    this.#stdout = options.stdout ?? ((message) => console.log(message))
    this.#stderr = options.stderr ?? ((message) => console.error(message))
    this.columns = Math.max(40, options.columns ?? process.stdout.columns ?? 80)
    this.interactive =
      options.interactive ??
      (options.stdout === undefined &&
        options.stderr === undefined &&
        process.stdout.isTTY === true &&
        process.stderr.isTTY === true)
  }

  document(document: UiDocument): void {
    this.#stdout(this.render(document))
  }

  documentError(document: UiDocument): void {
    this.#stderr(this.render(document))
  }

  render(document: UiDocument): string {
    return renderToString(<DocumentView document={document} terminalWidth={this.columns} />, {
      columns: this.columns,
    })
  }

  json(value: unknown): void {
    this.#stdout(JSON.stringify(value, null, 2))
  }

  raw(value: string): void {
    this.#stdout(value)
  }

  success(message: string): void {
    this.document(noticeDocument(message, 'success'))
  }

  info(message: string): void {
    this.document(noticeDocument(message, 'info'))
  }

  warning(message: string): void {
    this.documentError(noticeDocument(message, 'warning'))
  }

  error(message: string, hint?: string): void {
    this.documentError({
      blocks: [
        { type: 'notice', message, tone: 'error' },
        ...(hint === undefined
          ? []
          : [{ type: 'text' as const, text: 'Hint: ' + hint, dim: true }]),
      ],
    })
  }

  async withActivity<T>(label: string, operation: () => Promise<T>, enabled = true): Promise<T> {
    const activity = this.startActivity(label, enabled)
    try {
      return await operation()
    } finally {
      await activity.stop()
    }
  }

  startActivity(label: string, enabled = true): ActivityHandle {
    if (!enabled || !this.interactive) {
      return {
        update: () => {},
        stop: async () => {},
      }
    }

    let currentLabel = label
    let frame = 0
    let instance: Instance | undefined = render(
      <ActivityView label={currentLabel} frame={frame} />,
      {
        stdout: process.stdout,
        stderr: process.stderr,
        stdin: process.stdin,
        interactive: true,
        patchConsole: false,
        maxFps: 20,
      },
    )
    const timer = setInterval(() => {
      frame += 1
      instance?.rerender(<ActivityView label={currentLabel} frame={frame} />)
    }, 80)
    const stop = createActivityStop(
      instance,
      () => clearInterval(timer),
      () => {
        instance = undefined
      },
    )

    return {
      update(nextLabel: string) {
        currentLabel = nextLabel
        instance?.rerender(<ActivityView label={currentLabel} frame={frame} />)
      },
      stop,
    }
  }
}

export function noticeDocument(message: string, tone: UiTone = 'neutral'): UiDocument {
  return {
    blocks: [{ type: 'notice', message, tone }],
  }
}
