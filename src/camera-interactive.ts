import { CameraError } from './camera-errors.ts'
import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraTargetOptions,
} from './camera-session.ts'

/**
 * Launches the full-screen endpoint explorer.
 *
 * The `.tsx` tree is reached only through the dynamic import below, so no
 * non-interactive camera command ever evaluates the explorer's components.
 */
export async function runCameraInteractive(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CameraError(
      'rawback camera interactive needs an interactive terminal. ' +
        'Use rawback camera api --list and rawback camera api <id> in a script instead.',
    )
  }

  await withCameraSession(options, dependencies, async (session) => {
    const { runInteractive } = await import('./features/camera/run-interactive.tsx')
    await runInteractive(session)
  })
}
