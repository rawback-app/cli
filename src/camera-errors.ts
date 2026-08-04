import { CCAPIError } from '@rawback/ccapi-js'

import { isCertificateError } from './camera-fetch.ts'

/**
 * A camera failure whose `message` is already the finished, user-facing
 * sentence. Commands throw this so `runCommand` in `cli.ts` can print it
 * unchanged — and so `cli.ts` never has to import the CCAPI client, which would
 * drag it onto the startup path.
 */
export class CameraError extends Error {
  readonly kind: string | undefined

  constructor(message: string, options: { kind?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'CameraError'
    this.kind = options.kind
  }
}

export interface CameraErrorContext {
  host?: string
  port?: number
  /** The endpoint suffix being called, when known, e.g. `devicestatus/battery`. */
  suffix?: string
  firmwareVersion?: string
  useTLS?: boolean
  insecure?: boolean
}

/**
 * Turns a `CCAPIError` into prose that says what to do next.
 *
 * The camera's own `{ "message": ... }` is appended rather than substituted:
 * it is often just `"Not access"`, which on its own tells the user nothing
 * about the single-client rule that actually caused it.
 */
export function describeCameraError(error: unknown, context: CameraErrorContext = {}): string {
  if (error instanceof CameraError) return error.message

  const where =
    context.host !== undefined
      ? `${context.host}${context.port !== undefined ? `:${context.port}` : ''}`
      : 'the camera'

  if (!(error instanceof CCAPIError)) {
    if (isCertificateError(error)) return certificateAdvice(context)
    return error instanceof Error ? error.message : String(error)
  }

  return withCameraMessage(baseMessage(error, context, where), error.cameraMessage)
}

function baseMessage(error: CCAPIError, context: CameraErrorContext, where: string): string {
  switch (error.kind) {
    case 'notReachable':
      if (isCertificateError(error.cause)) return certificateAdvice(context)
      return (
        `Could not reach the camera at ${where}. Check the address and port, that the camera ` +
        'is awake with CCAPI enabled, and that both devices are on the same network.'
      )
    case 'unauthorized':
      return (
        'The camera rejected those credentials. Check the CCAPI user name and password set in ' +
        "the camera's menu, then run rawback camera connect again."
      )
    case 'forbidden':
      return (
        `The camera at ${where} refused the connection. A camera serves only one client at a ` +
        'time — close the Canon app, Rawback Desktop, or a browser tab holding the session, ' +
        'then try again. A camera with CORS enabled can also refuse an unexpected origin.'
      )
    case 'notActivated':
      if (context.suffix !== undefined) {
        const firmware =
          context.firmwareVersion !== undefined ? ` at firmware ${context.firmwareVersion}` : ''
        return (
          `This camera does not advertise "${context.suffix}"${firmware}. ` +
          'Run rawback camera api --list to see what it supports.'
        )
      }
      return (
        'CCAPI is not enabled on this camera, or the endpoint does not exist. Enable CCAPI in ' +
        'the camera menu, then run rawback camera connect.'
      )
    case 'pairingRequired':
      return (
        'The camera is busy or waiting for you to confirm the connection on its screen. ' +
        'Confirm on the camera, then try again.'
      )
    case 'conflict':
      return (
        'The camera rejected the change because the resource is locked. Protected contents ' +
        'cannot be deleted or modified until you unprotect them.'
      )
    case 'badRequest':
      return "The camera rejected the request as invalid. Check the values against the setting's ability list."
    case 'methodNotAllowed':
      return 'The camera does not allow that operation on this endpoint.'
    case 'rangeNotSatisfiable':
      return 'The camera rejected the requested byte range.'
    case 'serverError':
      return 'The camera reported an internal error. Power-cycling the camera usually clears it.'
    case 'noVersions':
      return `The camera at ${where} did not report a usable CCAPI version. Check that CCAPI is enabled.`
    case 'invalidRequest':
      return 'The camera connection was not initialised. This is a bug in the CLI; please report it.'
    case 'decoding':
      return 'The camera returned a response the client could not decode.'
    default:
      return error.message
  }
}

function certificateAdvice(context: CameraErrorContext): string {
  const target =
    context.host !== undefined
      ? `https://${context.host}${context.port !== undefined ? `:${context.port}` : ''}`
      : 'https://<camera>'
  return (
    "The camera's TLS certificate could not be verified. Canon cameras serve a self-signed " +
    `certificate — re-run with --insecure, or save the choice with rawback camera connect ${target} --insecure.`
  )
}

function withCameraMessage(message: string, cameraMessage: string | undefined): string {
  const trimmed = cameraMessage?.trim()
  if (trimmed === undefined || trimmed.length === 0) return message
  if (message.includes(trimmed)) return message
  return `${message} (camera said: ${trimmed})`
}

/** Wraps `error` as a `CameraError` carrying the finished message. */
export function toCameraError(error: unknown, context: CameraErrorContext = {}): CameraError {
  if (error instanceof CameraError) return error
  const kind = error instanceof CCAPIError ? error.kind : undefined
  return new CameraError(describeCameraError(error, context), {
    ...(kind !== undefined ? { kind } : {}),
    cause: error,
  })
}
