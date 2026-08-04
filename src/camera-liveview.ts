import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { LiveViewCameraDisplay, LiveViewSize } from '@rawback/ccapi-js'

import { CameraError } from './camera-errors.ts'
import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraTargetOptions,
} from './camera-session.ts'
import { runCameraStream } from './camera-stream.ts'
import { commandOutput } from './command.ts'

export interface LiveViewStartOptions extends CameraTargetOptions {
  size?: string
  display?: string
  force?: boolean
}

export async function runCameraLiveviewStart(
  options: LiveViewStartOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const size = (options.size ?? 'small') as LiveViewSize
  const cameradisplay = (options.display ?? 'keep') as LiveViewCameraDisplay

  await withCameraSession(options, dependencies, async (session) => {
    await session.client.liveview.start({ liveviewsize: size, cameradisplay })
    if (options.json === true) {
      ui.json({ started: true, size, display: cameradisplay })
      return
    }
    ui.success(`Live view started (${size}, display ${cameradisplay}).`)
  })
}

/**
 * Releases every live-view resource. Idempotent by design: this is the recovery
 * command after a killed stream, so a camera that is already idle is a success,
 * not an error.
 */
export async function runCameraLiveviewStop(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const released: string[] = []
    for (const [name, release] of [
      ['multipart', () => session.client.liveview.stopMultipart()],
      ['scroll', () => session.client.liveview.deleteScroll()],
    ] as const) {
      const ok = await release().then(
        () => true,
        () => false,
      )
      if (ok) released.push(name)
    }

    if (options.json === true) {
      ui.json({ stopped: true, released })
      return
    }
    ui.success(
      released.length > 0 ? `Released live view (${released.join(', ')}).` : 'Live view was idle.',
    )
  })
}

export async function runCameraLiveviewFrame(
  options: CameraTargetOptions & { output: string },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const frame = await session.client.liveview.getImage({ signal: session.signal })
    await mkdir(dirname(options.output), { recursive: true })
    await writeFile(options.output, frame.data)

    if (options.json === true) {
      ui.json({ output: options.output, bytes: frame.data.byteLength })
      return
    }
    ui.success(`Saved a live-view frame (${frame.data.byteLength} bytes) to ${options.output}.`)
  })
}

export interface LiveViewStreamOptions extends LiveViewStartOptions {
  outputDir?: string
  frames?: number
  duration?: number
}

/**
 * Streams live-view frames until Ctrl-C, a frame limit, or a duration.
 *
 * Under `--json` this emits NDJSON — one object per frame, then a summary — so
 * a consumer can read it incrementally. Buffering an unbounded stream into a
 * single JSON document would defeat the point.
 */
export async function runCameraLiveviewStream(
  options: LiveViewStreamOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const toStdout = options.outputDir === '-'
  if (!toStdout && options.outputDir === undefined) {
    throw new CameraError(
      'rawback camera liveview stream requires --output-dir <dir> or --output -',
    )
  }

  await withCameraSession(options, dependencies, async (session) => {
    await session.client.liveview.start({
      liveviewsize: (options.size ?? 'small') as LiveViewSize,
      cameradisplay: (options.display ?? 'keep') as LiveViewCameraDisplay,
    })
    // Registered before the first frame so an immediate Ctrl-C still releases it.
    session.register(() => session.client.liveview.stopMultipart())

    if (!toStdout) await mkdir(options.outputDir as string, { recursive: true })

    let bytes = 0
    let frames = 0
    const started = Date.now()
    const stop = await runCameraStream(
      session,
      ui,
      {
        ...(options.frames !== undefined ? { limit: options.frames } : {}),
        ...(options.duration !== undefined ? { durationSeconds: options.duration } : {}),
      },
      (signal) => session.client.liveview.stream({ signal }),
      async (frame: Uint8Array, index) => {
        bytes += frame.byteLength
        frames += 1
        if (toStdout) {
          process.stdout.write(frame)
          return
        }
        const name = `frame-${String(index + 1).padStart(5, '0')}.jpg`
        const path = join(options.outputDir as string, name)
        await writeFile(path, frame)
        if (options.json === true) {
          ui.raw(JSON.stringify({ frame: index + 1, bytes: frame.byteLength, path }))
        }
      },
      'rawback camera liveview stop',
    )

    const seconds = Math.round((Date.now() - started) / 100) / 10

    if (toStdout) return
    if (options.json === true) {
      // The terminating summary object, so a consumer can tell a clean end
      // from a truncated stream.
      ui.raw(JSON.stringify({ stopped: true, frames, bytes, seconds, reason: stop.reason }))
      return
    }
    ui.success(`Stopped after ${frames} frame(s) in ${seconds}s (${bytes} bytes).`)
  })
}
