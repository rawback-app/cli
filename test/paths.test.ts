import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { expandHomePath } from '../src/paths.ts'

describe('expandHomePath', () => {
  test('expands a bare tilde to the home directory', () => {
    expect(expandHomePath('~')).toBe(homedir())
  })

  test('expands a leading tilde segment', () => {
    expect(expandHomePath('~/Downloads/photo.nef')).toBe(join(homedir(), 'Downloads', 'photo.nef'))
  })

  test.each(['-', '.', 'photos/a.nef', '/tmp/a.nef', 'a/~/b.nef', '~other/a.nef', '~a.nef'])(
    'leaves %s unchanged',
    (value) => {
      expect(expandHomePath(value)).toBe(value)
    },
  )
})
