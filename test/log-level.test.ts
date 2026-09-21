import { afterEach, describe, expect, test } from 'bun:test'

import { LOG_LEVEL_CHOICES, selectedLogLevel, setSelectedLogLevel } from '../src/log-level.ts'

afterEach(() => setSelectedLogLevel({}))

describe('setSelectedLogLevel', () => {
  test('takes the named level when one is given', () => {
    setSelectedLogLevel({ level: ' warn ' })
    expect(selectedLogLevel()).toBe('warn')
  })

  test('maps -v to debug and -vv to trace', () => {
    setSelectedLogLevel({ verbose: 1 })
    expect(selectedLogLevel()).toBe('debug')
    setSelectedLogLevel({ verbose: 3 })
    expect(selectedLogLevel()).toBe('trace')
  })

  test('lets an explicit level beat the counted flag', () => {
    setSelectedLogLevel({ level: 'error', verbose: 2 })
    expect(selectedLogLevel()).toBe('error')
  })

  test('reports nothing when neither flag was passed', () => {
    // Reset to undefined between parses, so nothing leaks in a single process.
    setSelectedLogLevel({ verbose: 0 })
    expect(selectedLogLevel()).toBeUndefined()
    setSelectedLogLevel({ level: 'nonsense' })
    expect(selectedLogLevel()).toBeUndefined()
  })

  test('offers every level yargs advertises', () => {
    expect([...LOG_LEVEL_CHOICES]).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
      'silent',
    ])
  })
})
