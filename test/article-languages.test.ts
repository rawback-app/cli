import { describe, expect, test } from 'bun:test'

import { runArticleLanguage, validateArticleLanguage } from '../src/articles.ts'
describe('article languages', () => {
  test('normalizes and validates language tags', () => {
    expect(validateArticleLanguage('zh-hant')).toBe('zh-Hant')
    expect(() => validateArticleLanguage('und')).toThrow()
    expect(() => validateArticleLanguage('../en')).toThrow()
  })
  test('rejects invalid translation before connecting', async () => {
    await expect(
      runArticleLanguage('translate', { albumId: 1, from: 'en', to: 'en' }),
    ).rejects.toThrow('distinct')
    await expect(
      runArticleLanguage('translate', { albumId: 1, from: 'und', to: 'fr' }),
    ).rejects.toThrow('distinct')
  })
})
