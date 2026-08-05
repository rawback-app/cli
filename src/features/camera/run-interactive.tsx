import { render } from 'ink'

import type { CameraSession } from '../../camera-session.ts'
import { CameraExplorer } from './explorer.tsx'

/**
 * Renders the explorer and returns when the user quits.
 *
 * Deliberately no `process.exit`: returning normally lets the caller's `finally`
 * run, which is what releases the camera and flushes stdout. `exitOnCtrlC` is
 * off so the explorer's own handler can unmount cleanly and restore the cursor.
 */
export async function runInteractive(session: CameraSession): Promise<void> {
  const instance = render(<CameraExplorer session={session} />, {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  })

  try {
    await instance.waitUntilExit()
  } finally {
    instance.unmount()
  }
}
