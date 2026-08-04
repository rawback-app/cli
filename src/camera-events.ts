import type { CameraEvent } from '@rawback/ccapi-js'

import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraTargetOptions,
} from './camera-session.ts'
import { runCameraStream } from './camera-stream.ts'
import { cameraPrompts } from './camera.ts'
import { commandOutput } from './command.ts'
import { eventDocument, type EventView } from './features/camera/view.ts'

/**
 * `changedKeys` carries every raw key the camera sent, including ones the
 * typed decoder does not model — which is exactly what a `watch` consumer
 * wants, so it is always reported.
 */
function serializeEvent(event: CameraEvent): EventView {
  const { changedKeys, ...rest } = event
  return { changedKeys, ...rest }
}

export interface EventPollOptions extends CameraTargetOptions {
  wait?: boolean
  timeoutKind?: string
}

export async function runCameraEventsPoll(
  options: EventPollOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const event = await session.client.event.getPolling({
      signal: session.signal,
      ...(options.wait === true ? { continue: true } : {}),
      ...(options.timeoutKind !== undefined ? { timeout: options.timeoutKind } : {}),
    })

    if (options.json === true) {
      ui.json(serializeEvent(event))
      return
    }
    ui.document(eventDocument(serializeEvent(event)))
  })
}

export interface EventWatchOptions extends CameraTargetOptions {
  count?: number
  duration?: number
  mode?: string
}

/**
 * Streams camera events until Ctrl-C, a count, or a duration.
 *
 * Under `--json` this emits NDJSON — one event per line, then a summary — so a
 * consumer can pipe it into `jq` incrementally.
 */
export async function runCameraEventsWatch(
  options: EventWatchOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    session.register(() => session.client.event.stopMonitoring())

    let events = 0
    const started = Date.now()
    const stop = await runCameraStream(
      session,
      ui,
      {
        ...(options.count !== undefined ? { limit: options.count } : {}),
        ...(options.duration !== undefined ? { durationSeconds: options.duration } : {}),
      },
      (signal) => session.client.event.streamMonitoring({ signal }),
      (event: CameraEvent) => {
        events += 1
        if (options.json === true) {
          ui.raw(JSON.stringify(serializeEvent(event)))
          return
        }
        ui.document(eventDocument(serializeEvent(event)))
      },
      'rawback camera events clear',
    )

    const seconds = Math.round((Date.now() - started) / 100) / 10
    if (options.json === true) {
      ui.raw(JSON.stringify({ stopped: true, events, seconds, reason: stop.reason }))
      return
    }
    ui.success(`Stopped after ${events} event(s) in ${seconds}s.`)
  })
}

export async function runCameraEventsClear(
  options: CameraTargetOptions & { force?: boolean } = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(
      'Discard the events the camera has accumulated?',
    )
    if (!confirmed) {
      if (options.json === true) ui.json({ cleared: false })
      else ui.info('Left the accumulated events in place.')
      return
    }
  }

  await withCameraSession(options, dependencies, async (session) => {
    await session.client.event.clearPolling()
    // Best-effort: a monitoring stream may not be running at all.
    await session.client.event.stopMonitoring().catch(() => undefined)

    if (options.json === true) {
      ui.json({ cleared: true })
      return
    }
    ui.success('Cleared the accumulated camera events.')
  })
}
