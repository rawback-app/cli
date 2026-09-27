import { refuseOverwrite, saveBytes } from './camera-files.ts'
import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraTargetOptions,
} from './camera-session.ts'
import { cameraPrompts } from './camera.ts'
import { commandOutput } from './command.ts'
import { rtpStatusDocument } from './features/camera/view.ts'

const RTP = 'shooting/liveview/rtp'
const SESSION_DESCRIPTION = 'shooting/liveview/rtpsessiondesc'

/**
 * Starts RTP live view towards `ip` (doc 4.11.8). The camera pushes the stream
 * to that address rather than serving it, so a player needs the session
 * description from `rtp sdp` to receive it.
 */
export async function runCameraRtpStart(
  options: CameraTargetOptions & { ip: string; force?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(
      `Start streaming live view over RTP to ${options.ip}?`,
    )
    if (!confirmed) {
      if (options.json === true) ui.json({ started: false })
      else ui.info('Left RTP stopped.')
      return
    }
  }

  await withCameraSession(options, dependencies, async (session) => {
    session.requireSupport(RTP, 'rawback camera rtp start')
    await session.client.liveview.setRTP('start', options.ip)
    if (options.json === true) {
      ui.json({ started: true, ipaddress: options.ip })
      return
    }
    ui.success(`Streaming live view over RTP to ${options.ip}.`)
    ui.info('Save the session description with rawback camera rtp sdp <file> to play it.')
  })
}

/** Stops RTP live view. Not confirmed: like `liveview stop`, it only frees the camera. */
export async function runCameraRtpStop(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    session.requireSupport(RTP, 'rawback camera rtp stop')
    await session.client.liveview.setRTP('stop')
    if (options.json === true) {
      ui.json({ stopped: true })
      return
    }
    ui.success('Stopped RTP live view.')
  })
}

export async function runCameraRtpStatus(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    session.requireSupport(RTP, 'rawback camera rtp status')
    const status = await session.client.liveview.getRTPStatus()
    if (options.json === true) {
      ui.json({ status: status.status ?? null, ipaddress: status.ipaddress ?? null })
      return
    }
    ui.document(rtpStatusDocument(status))
  })
}

/** Saves the SDP file a player such as VLC or ffplay opens to receive the stream. */
export async function runCameraRtpSdp(
  options: CameraTargetOptions & { output: string; overwrite?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await refuseOverwrite(options.output, options.overwrite)

  await withCameraSession(options, dependencies, async (session) => {
    session.requireSupport(SESSION_DESCRIPTION, 'rawback camera rtp sdp')
    const description = await session.client.liveview.getRTPSessionDesc()
    await saveBytes(options.output, description.data)
    if (options.json === true) {
      ui.json({ output: options.output, bytes: description.data.byteLength })
      return
    }
    ui.success(`Saved the RTP session description to ${options.output}.`)
    ui.info(`Play it with: ffplay -protocol_whitelist file,udp,rtp ${options.output}`)
  })
}
