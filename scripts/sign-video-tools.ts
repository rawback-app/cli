import { stat } from 'node:fs/promises'
import { join } from 'node:path'

const signingVariables = {
  QUILL_SIGN_P12: 'MACOS_SIGN_P12',
  QUILL_SIGN_PASSWORD: 'MACOS_SIGN_PASSWORD',
  QUILL_NOTARY_KEY: 'MACOS_NOTARY_KEY',
  QUILL_NOTARY_KEY_ID: 'MACOS_NOTARY_KEY_ID',
  QUILL_NOTARY_ISSUER: 'MACOS_NOTARY_ISSUER_ID',
} as const

interface SigningDependencies {
  root?: string
  env?: NodeJS.ProcessEnv
  run?: (command: string[], env: NodeJS.ProcessEnv) => Promise<void>
  log?: (message: string) => void
}

async function runQuill(command: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = Bun.spawn(command, {
    env,
    stdout: 'inherit',
    stderr: 'inherit',
    // Bound Apple's response time; failure must stop packaging and publishing.
    timeout: 20 * 60 * 1_000,
  })
  if ((await child.exited) !== 0) {
    throw new Error('Quill signing or notarization failed; inspect the preceding notary output')
  }
}

/** Sign the staged files in place, before GoReleaser copies them into archives. */
export async function signVideoTools(
  snapshot: boolean,
  dependencies: SigningDependencies = {},
): Promise<void> {
  const log = dependencies.log ?? console.log
  if (snapshot) {
    log('Snapshot: skipping Developer ID signing and notarization of video tools')
    return
  }

  const env = dependencies.env ?? process.env
  const missing = Object.values(signingVariables).filter((name) => !env[name])
  if (missing.length > 0) {
    throw new Error(`Missing macOS signing secrets: ${missing.join(', ')}`)
  }

  const signingEnv: NodeJS.ProcessEnv = { ...env, QUILL_LOG_LEVEL: 'info' }
  for (const [destination, source] of Object.entries(signingVariables)) {
    signingEnv[destination] = env[source]
  }

  const root = dependencies.root ?? join(import.meta.dir, '..', '.release-artifacts', 'ffmpeg')
  const targets = ['x64', 'arm64'].flatMap((arch) =>
    ['ffmpeg', 'ffprobe'].map((tool) => ({
      label: `darwin/${arch}/${tool}`,
      path: join(root, 'darwin', arch, tool),
    })),
  )
  // Check every expected helper before using credentials or contacting Apple.
  for (const target of targets) {
    const file = await stat(target.path).catch(() => undefined)
    if (!file?.isFile()) throw new Error(`Missing staged video tool: ${target.label}`)
  }

  const run = dependencies.run ?? runQuill
  const results = await Promise.allSettled(
    targets.map(async (target) => {
      log(`Signing and notarizing ${target.label}`)
      await run(['quill', 'sign-and-notarize', target.path, '--wait'], signingEnv)
      log(`Signed and notarized ${target.label}`)
    }),
  )
  const failures = targets.filter((_target, index) => results[index]?.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(
      `Signing or notarization failed for ${failures.map((target) => target.label).join(', ')}; release stopped`,
    )
  }
}

if (import.meta.main) {
  const flag = process.argv[2]
  if (process.argv.length !== 3 || (flag !== '--snapshot=true' && flag !== '--snapshot=false')) {
    throw new Error('Usage: bun run scripts/sign-video-tools.ts --snapshot=true|false')
  }
  await signVideoTools(flag === '--snapshot=true')
}
