import type { CameraSession } from './camera-session.ts'
import type { CommandOutput } from './ui/output.tsx'

export interface StreamStopReason {
  reason: 'signal' | 'limit' | 'duration' | 'end'
  interrupted: boolean
}

/**
 * How long teardown gets to release camera-side resources after a Ctrl-C. The
 * camera serves one client at a time, so leaving a stream open locks out the
 * next connection until the camera times out or is power-cycled.
 */
const TEARDOWN_BUDGET_MS = 3000

export interface StreamRunOptions {
  /** Stop after this many items. */
  limit?: number | undefined
  /** Stop after this many seconds. */
  durationSeconds?: number | undefined
}

/**
 * Drives an open-ended camera stream to a clean stop.
 *
 * A user-requested stop is a success, not a failure: the first Ctrl-C asks the
 * stream to end, releases the camera, and exits 0. A second Ctrl-C gives up on
 * releasing and exits 130, telling the user which command will clear it.
 */
export async function runCameraStream<T>(
  session: CameraSession,
  ui: CommandOutput,
  options: StreamRunOptions,
  source: (signal: AbortSignal) => AsyncIterable<T>,
  onItem: (item: T, index: number) => Promise<void> | void,
  recovery: string,
): Promise<StreamStopReason> {
  let interrupts = 0
  let reason: StreamStopReason['reason'] = 'end'

  const onInterrupt = () => {
    interrupts += 1
    if (interrupts === 1) {
      ui.warning('Stopping and releasing the camera. Press Ctrl-C again to exit immediately.')
      reason = 'signal'
      session.abort()
      return
    }
    ui.warning(`The camera may still be holding the stream; run ${recovery}.`)
    process.exitCode = 130
    process.off('SIGINT', onInterrupt)
    process.kill(process.pid, 'SIGINT')
  }
  process.on('SIGINT', onInterrupt)

  const deadline =
    options.durationSeconds !== undefined && options.durationSeconds > 0
      ? setTimeout(() => {
          reason = 'duration'
          session.abort()
        }, options.durationSeconds * 1000)
      : undefined

  let count = 0
  try {
    for await (const item of source(session.signal)) {
      await onItem(item, count)
      count += 1
      if (options.limit !== undefined && count >= options.limit) {
        reason = 'limit'
        break
      }
    }
  } catch (error) {
    // An abort is how a stream is asked to stop, so it is not a failure.
    if (!session.signal.aborted) throw error
  } finally {
    if (deadline !== undefined) clearTimeout(deadline)
    process.off('SIGINT', onInterrupt)
    // Teardown is bounded: a camera that has stopped answering must not hang
    // the command that is trying to let go of it.
    await Promise.race([
      session.teardown(),
      new Promise((resolve) => setTimeout(resolve, TEARDOWN_BUDGET_MS)),
    ])
  }

  return { reason, interrupted: interrupts > 0 }
}
