/**
 * Bun's `fetch` accepts a `tls` request option, which is how a Canon camera's
 * self-signed certificate is tolerated without touching the process-global
 * `NODE_TLS_REJECT_UNAUTHORIZED`.
 */
interface CameraFetchInit extends RequestInit {
  tls?: { rejectUnauthorized?: boolean }
}

export interface CameraFetchOptions {
  host: string
  /** Relax certificate verification. Only ever set from an explicit `--insecure`. */
  insecure?: boolean
}

/**
 * Builds the `fetch` handed to `CCAPIClient`.
 *
 * Two things happen here that the bare global does not do. The request is
 * pinned to the camera's hostname, so a relaxed-TLS fetch can never follow a
 * redirect somewhere else and skip verification there. And certificate
 * verification is disabled only when the caller asked for it — cameras ship
 * self-signed certificates, but silently trusting them would make this the one
 * place in the CLI where trust is relaxed without the user saying so.
 */
export function createCameraFetch(
  options: CameraFetchOptions,
  base: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  const relax = options.insecure === true

  const cameraFetch = async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const hostname = hostnameOf(href)
    if (hostname !== undefined && hostname !== options.host) {
      throw new Error(`Camera fetch refused a request to ${hostname}`)
    }
    if (!relax) return base(input, init)
    const relaxed: CameraFetchInit = { ...init, tls: { rejectUnauthorized: false } }
    return base(input, relaxed)
  }

  // `typeof fetch` carries `preconnect` under Bun's types; forward the real one
  // rather than casting the wrapper into shape. An injected test double is a
  // plain function, so fall back to a no-op instead of binding `undefined`.
  const preconnect: typeof globalThis.fetch.preconnect =
    typeof base.preconnect === 'function' ? base.preconnect.bind(base) : () => {}
  return Object.assign(cameraFetch, { preconnect })
}

function hostnameOf(href: string): string | undefined {
  try {
    return new URL(href).hostname
  } catch {
    return undefined
  }
}

/**
 * Whether a failure looks like a rejected TLS certificate, so the caller can
 * point at `--insecure` rather than at the network. Bun surfaces these as an
 * opaque `Error` chain, so the check is textual across the whole `cause` chain.
 */
export function isCertificateError(error: unknown): boolean {
  const pattern =
    /self[- ]signed|certificate|CERT_|ERR_TLS|unable to verify|DEPTH_ZERO|not trusted/i
  let current: unknown = error
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      if (pattern.test(current.message)) return true
      const code = (current as Error & { code?: unknown }).code
      if (typeof code === 'string' && pattern.test(code)) return true
      current = current.cause
      continue
    }
    return false
  }
  return false
}
