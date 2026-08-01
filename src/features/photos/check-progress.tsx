import { Box, Text, render, type Instance } from 'ink'

import type { CommandOutput } from '../../ui/output.tsx'

export type PhotoCheckProgressStage = 'scanning' | 'metadata' | 'checking'

export interface PhotoCheckProgress {
  completed: number
  stage: PhotoCheckProgressStage
  total?: number
}

function percent(completed: number, total: number): number {
  if (total === 0) return 100
  return Math.max(0, Math.min(100, Math.floor((completed / total) * 100)))
}

function ProgressBar({
  frame,
  value,
  width,
}: {
  frame: number
  value: number | undefined
  width: number
}) {
  if (value !== undefined) {
    const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * width)
    return (
      <Text>
        <Text color="cyan">{'━'.repeat(filled)}</Text>
        <Text dimColor>{'─'.repeat(Math.max(0, width - filled))}</Text>
      </Text>
    )
  }

  const segmentWidth = Math.max(4, Math.floor(width * 0.35))
  const start = ((frame + segmentWidth) % (width + segmentWidth)) - segmentWidth
  const visibleStart = Math.max(0, start)
  const visibleEnd = Math.min(width, start + segmentWidth)
  return (
    <Text>
      <Text dimColor>{'─'.repeat(visibleStart)}</Text>
      <Text color="cyan">{'━'.repeat(Math.max(0, visibleEnd - visibleStart))}</Text>
      <Text dimColor>{'─'.repeat(Math.max(0, width - visibleEnd))}</Text>
    </Text>
  )
}

export function PhotoCheckProgressView({
  frame,
  progress,
  terminalWidth,
}: {
  frame: number
  progress: PhotoCheckProgress
  terminalWidth: number
}) {
  const barWidth = Math.max(12, Math.min(42, terminalWidth - 2))
  const total = progress.total
  const value = total === undefined ? undefined : percent(progress.completed, total)
  const label =
    progress.stage === 'scanning'
      ? progress.completed > 0
        ? `Scanning files — ${progress.completed.toLocaleString()} scanned`
        : 'Scanning files…'
      : `${progress.stage === 'metadata' ? 'Reading photo metadata' : 'Checking Rawback'} — ${progress.completed.toLocaleString()} of ${(total ?? 0).toLocaleString()} (${value ?? 0}%)`

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <ProgressBar frame={frame} value={value} width={barWidth} />
    </Box>
  )
}

export class PhotoCheckProgressController {
  #frame = 0
  #instance: Instance | undefined
  #lastRender = 0
  #progress: PhotoCheckProgress | undefined
  #timer: ReturnType<typeof setInterval> | undefined

  constructor(
    readonly output: CommandOutput,
    readonly enabled = true,
  ) {}

  update(progress: PhotoCheckProgress): void {
    const stageChanged = this.#progress?.stage !== progress.stage
    this.#progress = { ...progress }
    if (!this.enabled || !this.output.interactive) return

    if (progress.stage === 'scanning') this.#startAnimation()
    else this.#stopAnimation()

    const completed = progress.total !== undefined && progress.completed >= progress.total
    this.#render(stageChanged || completed)
  }

  async finish(): Promise<void> {
    this.#stopAnimation()
    this.#progress = undefined
    if (this.#instance === undefined) return
    const instance = this.#instance
    this.#instance = undefined
    instance.clear()
    instance.unmount()
    await instance.waitUntilExit()
  }

  #render(force: boolean): void {
    if (this.#progress === undefined) return
    const now = Date.now()
    if (!force && now - this.#lastRender < 100) return
    this.#lastRender = now
    const view = (
      <PhotoCheckProgressView
        frame={this.#frame}
        progress={this.#progress}
        terminalWidth={this.output.columns}
      />
    )
    if (this.#instance) {
      this.#instance.rerender(view)
    } else {
      this.#instance = render(view, {
        stdout: process.stdout,
        stderr: process.stderr,
        stdin: process.stdin,
        interactive: true,
        patchConsole: false,
        maxFps: 20,
      })
    }
  }

  #startAnimation(): void {
    if (this.#timer !== undefined) return
    this.#timer = setInterval(() => {
      this.#frame += 1
      this.#render(true)
    }, 80)
    this.#timer.unref?.()
  }

  #stopAnimation(): void {
    if (this.#timer === undefined) return
    clearInterval(this.#timer)
    this.#timer = undefined
  }
}
