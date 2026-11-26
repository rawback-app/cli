import { afterEach, describe, expect, test } from 'bun:test'

import { JsonResponseError, RawbackGraphqlError, RawbackHttpError } from '@rawback/sdk'

import { setSelectedEnvironment } from '../src/environment.ts'
import { explainError, isSessionRejected } from '../src/explain-error.ts'

const TRACE = '0af7651916cd43dd8448eb211c80319c'
const traced = () => new Headers({ 'x-trace-id': TRACE })

function graphqlFailure(status: number, errors: RawbackGraphqlError['errors'] = []) {
  return new RawbackGraphqlError(errors, null, {
    headers: traced(),
    status,
    operationName: 'UserMemory',
  })
}

function restFailure(status: number, body: unknown) {
  return new RawbackHttpError(status, 'https://api.rawback.app/api/v1/photos', traced(), body)
}

/** What Bun's fetch throws when nothing answers at the address. */
function connectionRefused(url: string) {
  return Object.assign(
    new TypeError('ECONNREFUSED: Unable to connect. Is the computer able to access the url?'),
    { code: 'ECONNREFUSED', path: url, errno: 0 },
  )
}

afterEach(() => setSelectedEnvironment(undefined))

describe('explainError', () => {
  test('explains the HTTP 401 the API sends for an expired session on GraphQL', () => {
    // What production answered: a REST envelope, not GraphQL's shape, so the
    // SDK could only say "GraphQL request failed".
    const error = graphqlFailure(401)
    expect(error.message).toBe('GraphQL request failed')

    expect(explainError(error)).toEqual({
      message: `Your Rawback session has expired or was signed out. Trace ID: ${TRACE}.`,
      hint: "Run 'rawback auth --force' to sign in again.",
    })
    expect(isSessionRejected(error)).toBe(true)
  })

  test('explains an expired session on a REST endpoint', () => {
    const error = restFailure(401, { code: 401, data: null, msg: 'token has expired' })
    expect(explainError(error).message).toStartWith('Your Rawback session has expired')
    expect(explainError(error).hint).toBe("Run 'rawback auth --force' to sign in again.")
  })

  test('recognises an UNAUTHENTICATED GraphQL error', () => {
    const error = graphqlFailure(200, [
      { message: 'unauthorized', extensions: { code: 'UNAUTHENTICATED' } },
    ])
    expect(isSessionRejected(error)).toBe(true)
  })

  test('names the --env environment in the sign-in hint', () => {
    setSelectedEnvironment('local')
    expect(explainError(graphqlFailure(401)).hint).toBe(
      "Run 'rawback --env local auth --force' to sign in again.",
    )
  })

  test('keeps the message of a 401 that names its own reason', () => {
    const error = restFailure(401, {
      code: 401,
      data: null,
      msg: 'invalid email or password',
      reason: 'invalid_credentials',
    })
    expect(isSessionRejected(error)).toBe(false)
    expect(explainError(error)).toEqual({
      message: `invalid email or password Trace ID: ${TRACE}.`,
    })
  })

  test('points an unverified account at its confirmation email', () => {
    const error = graphqlFailure(200, [
      {
        message: 'Confirm your email address to make changes',
        extensions: { code: 403, reason: 'email_verification_required' },
      },
    ])
    expect(explainError(error)).toEqual({
      message: `Confirm your email address to make changes Trace ID: ${TRACE}.`,
      hint: 'Open the confirmation link Rawback emailed you, then try again.',
    })
  })

  test('keeps the message of a suspended account and of ordinary GraphQL errors', () => {
    const suspended = graphqlFailure(200, [
      {
        message: 'This account is suspended.',
        extensions: { code: 403, reason: 'account_suspended' },
      },
    ])
    expect(explainError(suspended)).toEqual({
      message: `This account is suspended. Trace ID: ${TRACE}.`,
    })
    const missing = graphqlFailure(200, [{ message: 'album not found' }])
    expect(explainError(missing)).toEqual({ message: `album not found Trace ID: ${TRACE}.` })
  })

  test('says a server failure is usually temporary', () => {
    expect(explainError(graphqlFailure(502))).toEqual({
      message: `The Rawback API failed to answer (HTTP 502). Trace ID: ${TRACE}.`,
      hint: 'This is usually temporary; try again in a moment. If it keeps failing, report it with the trace ID.',
    })
    const withMessage = restFailure(500, { code: 500, data: null, msg: 'upload failed' })
    expect(explainError(withMessage).message).toBe(`upload failed Trace ID: ${TRACE}.`)
    expect(explainError(withMessage).hint).toStartWith('This is usually temporary')
  })

  test('asks the user to wait out a rate limit', () => {
    expect(explainError(graphqlFailure(429))).toEqual({
      message: `The Rawback API is receiving too many requests (HTTP 429). Trace ID: ${TRACE}.`,
      hint: 'Wait a minute, then try again.',
    })
  })

  test('suggests checking the API host for a 404 or a reply that is not the API', () => {
    const notFound = explainError(graphqlFailure(404))
    expect(notFound.message).toStartWith(
      'The Rawback API did not recognise this request (HTTP 404).',
    )
    expect(notFound.hint).toBe(
      "Run 'rawback config view' to check which API host this environment uses.",
    )

    const portal = explainError(graphqlFailure(200))
    expect(portal.message).toStartWith(
      'The server answered, but not with a Rawback API response (HTTP 200).',
    )
    expect(portal.hint).toContain('captive portal')

    const notJson = explainError(
      new JsonResponseError(200, 'https://api.rawback.app/api/v1/x', '<html>'),
    )
    expect(notJson.message).toBe('Expected a JSON response from https://api.rawback.app/api/v1/x')
    expect(notJson.hint).toContain("'rawback config view'")
  })

  test('leads a bare 403 with reporting it, not with signing in again', () => {
    expect(explainError(graphqlFailure(403)).hint).toBe(
      "If it keeps happening, report it with the trace ID. Signing in again with 'rawback auth --force' may also help.",
    )
  })

  test('keeps the message of GraphQL errors that have none of their own', () => {
    const error = graphqlFailure(200, [{ extensions: { code: 'INTERNAL' } }])
    expect(explainError(error)).toEqual({ message: `GraphQL request failed Trace ID: ${TRACE}.` })
  })

  test('names the status of any other refusal', () => {
    expect(explainError(graphqlFailure(413))).toEqual({
      message: `The Rawback API rejected this request (HTTP 413). Trace ID: ${TRACE}.`,
    })
  })

  test('explains an API that cannot be reached', () => {
    expect(explainError(connectionRefused('http://localhost:23164/api/v2/graphql'))).toEqual({
      message: 'Could not connect to the Rawback API at http://localhost:23164 (ECONNREFUSED).',
      hint: "Check your internet connection. Run 'rawback config view' to check which API host this environment uses.",
    })
  })

  test('says a dropped connection was lost, since the change may have been made', () => {
    const error = Object.assign(new Error('The socket connection was closed unexpectedly'), {
      code: 'ECONNRESET',
      path: 'https://api.rawback.app/api/v2/graphql',
    })
    expect(explainError(error)).toEqual({
      message:
        'The connection to the Rawback API at https://api.rawback.app was lost (ECONNRESET).',
      hint: 'Check your internet connection, then try again. If you were changing something, check whether the change was made before repeating it.',
    })
  })

  test('takes the URL from a wrapped error when the wrapper has only the code', () => {
    const error = Object.assign(
      new Error('request failed', {
        cause: { path: 'https://api.rawback.app/api/v1/photos' },
      }),
      { code: 'ECONNREFUSED' },
    )
    expect(explainError(error).message).toBe(
      'Could not connect to the Rawback API at https://api.rawback.app (ECONNREFUSED).',
    )
  })

  test('finds a network code behind a wrapping error', () => {
    const error = new TypeError('fetch failed', {
      cause: connectionRefused('https://api.rawback.app/api/v1/auth/refresh'),
    })
    expect(explainError(error).message).toBe(
      'Could not connect to the Rawback API at https://api.rawback.app (ECONNREFUSED).',
    )
  })

  test('explains an untrusted TLS certificate', () => {
    const error = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      path: 'https://api.rawback.app/api/v2/graphql',
    })
    expect(explainError(error).message).toBe(
      'Could not verify the TLS certificate of the Rawback API at https://api.rawback.app (UNABLE_TO_VERIFY_LEAF_SIGNATURE).',
    )
  })

  test('leaves camera and SFTP network failures to their own messages', () => {
    const camera = connectionRefused('http://192.168.0.1:8080/ccapi/ver100/deviceinformation')
    expect(explainError(camera)).toEqual({ message: camera.message })
    const sftp = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:22'), {
      code: 'ECONNREFUSED',
    })
    expect(explainError(sftp)).toEqual({ message: 'connect ECONNREFUSED 127.0.0.1:22' })
  })

  test('passes other errors through', () => {
    expect(explainError(new Error('plain failure'))).toEqual({ message: 'plain failure' })
    expect(explainError('not an error')).toEqual({ message: 'not an error' })
  })

  test('falls back to the trace ID that was sent when the response has none', () => {
    const error = new RawbackGraphqlError([], null, {
      headers: new Headers(),
      status: 502,
      requestTraceId: TRACE,
    })
    expect(explainError(error).message).toBe(
      `The Rawback API failed to answer (HTTP 502). Trace ID: ${TRACE}.`,
    )
  })

  test('leaves a camera that answers 401 or 500 to its own message', () => {
    // `CCAPIError` from @rawback/ccapi-js carries a numeric status too.
    for (const status of [401, 500]) {
      const camera = Object.assign(new Error('Unauthorized: the camera refused the password'), {
        name: 'CCAPIError',
        status,
      })
      expect(isSessionRejected(camera)).toBe(false)
      expect(explainError(camera)).toEqual({
        message: 'Unauthorized: the camera refused the password',
      })
    }
  })

  test('treats GraphQL UNAUTHENTICATED as the session even with a reason', () => {
    const error = graphqlFailure(200, [
      {
        message: 'token expired',
        extensions: { code: 'UNAUTHENTICATED', reason: 'token_expired' },
      },
    ])
    expect(isSessionRejected(error)).toBe(true)
    expect(explainError(error).hint).toBe("Run 'rawback auth --force' to sign in again.")
  })

  test('says a 408 timed out rather than rate-limited', () => {
    expect(explainError(graphqlFailure(408))).toEqual({
      message: `The request to the Rawback API timed out (HTTP 408). Trace ID: ${TRACE}.`,
      hint: 'Check your internet connection, then try again.',
    })
  })

  test('explains a gateway error page by its status', () => {
    const error = new JsonResponseError(502, 'https://api.rawback.app/api/v1/x', '<html>502</html>')
    expect(explainError(error)).toEqual({
      message: 'The Rawback API failed to answer (HTTP 502).',
      hint: 'This is usually temporary; try again in a moment. If it keeps failing, report it with the trace ID.',
    })
    expect(isSessionRejected(new JsonResponseError(401, '', '<html>'))).toBe(false)
  })
})
