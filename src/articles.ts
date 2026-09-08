import {
  CliTranslateArticleDocument,
  CliSetArticleDefaultLanguageDocument,
  CliLabelArticleVersionDocument,
  CliDeleteArticleVersionDocument,
} from '@rawback/sdk'
import { type FragmentType, useFragment } from '@rawback/sdk'
import {
  type CliAlbumArticleQuery,
  CliAlbumArticleDocument,
  type CliArticleFieldsFragment,
  CliArticleFieldsFragmentDoc,
  type CliArticleImageFieldsFragment,
  CliArticleImageFieldsFragmentDoc,
  CliArticlesDocument,
  CliDeleteArticleDocument,
  CliPublishArticleDocument,
  CliUnpublishArticleDocument,
  CliUpsertArticleDocument,
  type UpsertArticleInput,
} from '@rawback/sdk'

import { validatePositiveId } from './albums.ts'
import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import { articleListDocument, articleViewDocument } from './features/articles/view.ts'

export interface ArticlePrompts {
  confirm(message: string): Promise<boolean>
}

export interface ArticleCommandDependencies extends ReadCommandDependencies {
  prompts?: ArticlePrompts
  readContent?: (path: string) => Promise<string>
}

export interface ArticleListOptions {
  json?: boolean
  page: number
  pageSize: number
}

export interface ArticleViewOptions {
  language?: string
  albumId: number
  contentOnly?: boolean
  json?: boolean
}

export interface ArticleEditOptions {
  language?: string
  albumId: number
  contentFile?: string
  json?: boolean
  title?: string
}

export interface ArticleStatusOptions {
  albumId: number
  json?: boolean
}

export interface ArticleDeleteOptions extends ArticleStatusOptions {
  force?: boolean
}

type AlbumArticle = NonNullable<CliAlbumArticleQuery['me']['album']>

export function extractArticleImageIds(content: string): number[] {
  const ids: number[] = []
  const seen = new Set<number>()
  const pattern = /!\[[^\]]*\]\(rawback:\/\/image\/(\d+)\)/g
  for (const match of content.matchAll(pattern)) {
    const value = match[1]
    if (value === undefined) continue
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function pageInfo(page: {
  hasNextPage: boolean
  hasPreviousPage: boolean
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}) {
  return {
    page: page.page,
    pageSize: page.pageSize,
    totalCount: page.totalCount,
    totalPages: page.totalPages,
    hasNextPage: page.hasNextPage,
    hasPreviousPage: page.hasPreviousPage,
  }
}

function articleFragment(
  value: FragmentType<typeof CliArticleFieldsFragmentDoc>,
): CliArticleFieldsFragment {
  return useFragment(CliArticleFieldsFragmentDoc, value)
}

function serializeArticleImage(image: CliArticleImageFieldsFragment) {
  return {
    id: image.id,
    displayName: image.displayName,
    filename: image.filename,
    url: image.url,
    thumbnailUrl: image.thumbnailUrl ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    blurhash: image.blurhash ?? null,
    rotation: image.rotation,
    editedImages: image.editedImages.map((edited) => ({
      url: edited.url,
      thumbnailUrl: edited.thumbnailUrl ?? null,
      width: edited.width,
      height: edited.height,
      blurhash: edited.blurhash ?? null,
      createdAt: edited.createdAt,
    })),
  }
}

export function serializeArticle(article: CliArticleFieldsFragment) {
  return {
    id: article.id,
    title: article.title,
    content: article.content,
    defaultLanguage: article.defaultLanguage,
    availableLanguages: article.availableLanguages,
    versions: article.versions,
    status: article.status,
    album: {
      id: article.album.id,
      name: article.album.name,
      slug: article.album.slug,
    },
    images: article.images.map((image) =>
      serializeArticleImage(useFragment(CliArticleImageFieldsFragmentDoc, image)),
    ),
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  }
}

async function queryAlbumArticle(
  albumId: number,
  dependencies: ArticleCommandDependencies,
): Promise<AlbumArticle> {
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.query({
    query: CliAlbumArticleDocument,
    variables: { albumId },
  })
  if (result.error) throw result.error
  if (!result.data) throw new Error('The article response did not include article data')
  const album = result.data.me.album
  if (!album) throw new Error(`Album ${albumId} not found`)
  return album
}

function requireArticle(album: AlbumArticle): CliArticleFieldsFragment {
  if (!album.article) {
    throw new Error(
      `Album ${album.id} has no article; create one with rawback album article edit ${album.id} --content-file <path|->`,
    )
  }
  return articleFragment(album.article)
}

async function defaultReadContent(path: string): Promise<string> {
  if (path === '-') return Bun.stdin.text()
  return Bun.file(path).text()
}

async function confirm(
  dependencies: ArticleCommandDependencies,
  message: string,
): Promise<boolean> {
  if (dependencies.prompts) return dependencies.prompts.confirm(message)
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Deleting an article requires an interactive terminal unless --force is provided.',
    )
  }
  const { confirm: prompt } = await import('@inquirer/prompts')
  return prompt({ default: false, message })
}

function writeArticle(
  article: CliArticleFieldsFragment,
  json: boolean | undefined,
  dependencies: ArticleCommandDependencies,
  message: string,
): void {
  const ui = commandOutput(dependencies)
  if (json) {
    ui.json(serializeArticle(article))
  } else {
    ui.success(message)
  }
}

export async function runArticleList(
  options: ArticleListOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  validatePagination(options.page, options.pageSize)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading articles…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({
        query: CliArticlesDocument,
        variables: { pagination: { page: options.page, pageSize: options.pageSize } },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The articles response did not include article data')
  const articles = result.data.me.articles.edges.map(articleFragment)
  const pagination = pageInfo(result.data.me.articles.pageInfo)
  if (options.json) {
    ui.json({ articles: articles.map(serializeArticle), pageInfo: pagination })
    return
  }
  ui.document(articleListDocument(articles, pagination))
}

export async function runArticleView(
  options: ArticleViewOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  if (options.contentOnly && options.json) {
    throw new Error('--content-only and --json cannot be used together')
  }
  const ui = commandOutput(dependencies)
  let article = await ui.withActivity(
    'Loading article…',
    async () => requireArticle(await queryAlbumArticle(albumId, dependencies)),
    !options.contentOnly && !options.json,
  )
  if (options.language) {
    const language = validateArticleLanguage(options.language)
    const version = article.versions.find((v) => v.language === language)
    if (!version) throw new Error(`No article version for ${language}`)
    article = { ...article, title: version.title, content: version.content }
  }
  if (options.contentOnly) {
    ui.raw(article.content)
  } else if (options.json) {
    ui.json(serializeArticle(article))
  } else {
    ui.document(articleViewDocument(article))
  }
}

export async function runArticleEdit(
  options: ArticleEditOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  if (options.title === undefined && options.contentFile === undefined) {
    throw new Error('rawback album article edit requires --title or --content-file')
  }
  const input: UpsertArticleInput = {
    albumId,
    ...(options.language ? { language: validateArticleLanguage(options.language) } : {}),
    ...(options.title !== undefined ? { title: options.title.trim() } : {}),
  }
  if (options.contentFile !== undefined) {
    const path = options.contentFile.trim()
    if (path.length === 0) throw new Error('--content-file must not be empty')
    const content = await (dependencies.readContent ?? defaultReadContent)(path)
    input.content = content
    input.imageIds = extractArticleImageIds(content)
  }
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliUpsertArticleDocument,
    variables: { input },
  })
  if (result.error) throw result.error
  const value = result.data?.upsertArticle
  if (!value) throw new Error('The edit article response did not include the article')
  const savedArticle = articleFragment(value)
  const version = options.language
    ? savedArticle.versions.find((v) => v.language === validateArticleLanguage(options.language!))
    : undefined
  const article = version
    ? { ...savedArticle, title: version.title, content: version.content }
    : savedArticle
  writeArticle(
    article,
    options.json,
    dependencies,
    `Saved article ${article.id} for album ${article.album.id} (${article.album.name}).`,
  )
}

async function runArticleStatus(
  status: 'publish' | 'unpublish',
  options: ArticleStatusOptions,
  dependencies: ArticleCommandDependencies,
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  const current = requireArticle(await queryAlbumArticle(albumId, dependencies))
  const client = await createCommandClient(dependencies)
  let value: FragmentType<typeof CliArticleFieldsFragmentDoc> | undefined
  if (status === 'publish') {
    const result = await client.graphql.mutate({
      mutation: CliPublishArticleDocument,
      variables: { id: current.id },
    })
    if (result.error) throw result.error
    value = result.data?.publishArticle
  } else {
    const result = await client.graphql.mutate({
      mutation: CliUnpublishArticleDocument,
      variables: { id: current.id },
    })
    if (result.error) throw result.error
    value = result.data?.unpublishArticle
  }
  if (!value) throw new Error(`The ${status} article response did not include the article`)
  const article = articleFragment(value)
  writeArticle(
    article,
    options.json,
    dependencies,
    `${status === 'publish' ? 'Published' : 'Unpublished'} article ${article.id} for album ${albumId}.`,
  )
}

export function runArticlePublish(
  options: ArticleStatusOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  return runArticleStatus('publish', options, dependencies)
}

export function runArticleUnpublish(
  options: ArticleStatusOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  return runArticleStatus('unpublish', options, dependencies)
}

export async function runArticleDelete(
  options: ArticleDeleteOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  const article = requireArticle(await queryAlbumArticle(albumId, dependencies))
  if (!options.force) {
    const confirmed = await confirm(
      dependencies,
      `Delete article "${article.title || article.album.name}" (ID ${article.id}) from album ${albumId}?`,
    )
    if (!confirmed) {
      const ui = commandOutput(dependencies)
      if (options.json) {
        ui.json({ albumId, articleId: article.id, deleted: false })
      } else {
        ui.info('Deletion cancelled.')
      }
      return
    }
  }
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliDeleteArticleDocument,
    variables: { id: article.id },
  })
  if (result.error) throw result.error
  if (result.data?.deleteArticle !== true) {
    throw new Error('The delete article response did not confirm deletion')
  }
  const ui = commandOutput(dependencies)
  if (options.json) {
    ui.json({ albumId, articleId: article.id, deleted: true })
  } else {
    ui.success(`Deleted article ${article.id} from album ${albumId}.`)
  }
}

export function validateArticleLanguage(value: string): string {
  try {
    const language = Intl.getCanonicalLocales(value)[0]
    if (language && language !== 'und') return language
  } catch {
    /* actionable error below */
  }
  throw new Error('Use a known BCP-47 language tag, such as en or zh-Hant')
}
export interface ArticleLanguageOptions {
  albumId: number
  from?: string
  to?: string
  language?: string
  overwrite?: boolean
  json?: boolean
}
export async function runArticleLanguage(
  action: 'translate' | 'versions' | 'default' | 'label' | 'delete-version',
  options: ArticleLanguageOptions,
  dependencies: ArticleCommandDependencies = {},
) {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  const source =
    options.from === 'und'
      ? 'und'
      : options.from
        ? validateArticleLanguage(options.from)
        : undefined
  const target = options.to ? validateArticleLanguage(options.to) : undefined
  const language =
    options.language === 'und'
      ? 'und'
      : options.language
        ? validateArticleLanguage(options.language)
        : undefined
  if (action === 'translate' && (!source || !target || source === target || source === 'und'))
    throw new Error('Translation requires distinct --from and --to languages')
  if (action === 'label' && (!source || !target))
    throw new Error('Labeling requires --from and --to')
  if ((action === 'default' || action === 'delete-version') && !language)
    throw new Error('--language is required')
  const current = requireArticle(await queryAlbumArticle(albumId, dependencies))
  const ui = commandOutput(dependencies)
  if (action === 'versions') {
    if (options.json) ui.json(current.versions)
    else
      ui.raw(
        current.versions
          .map(
            (v) =>
              `${v.language}  revision ${v.revision}${v.language === current.defaultLanguage ? ' (default)' : ''}`,
          )
          .join('\n'),
      )
    return
  }
  const client = await createCommandClient(dependencies)
  if (action === 'translate') {
    const from = current.versions.find((v) => v.language === source)
    const to = current.versions.find((v) => v.language === target)
    if (!from) throw new Error('Source version does not exist')
    if (to && !options.overwrite) throw new Error('Target exists; use --overwrite to replace it')
    const result = await client.graphql.mutate({
      mutation: CliTranslateArticleDocument,
      variables: {
        input: {
          articleId: current.id,
          sourceLanguage: source!,
          targetLanguage: target!,
          expectedSourceRevision: from.revision,
          expectedTargetRevision: to?.revision ?? null,
          overwrite: options.overwrite ?? false,
          requestId: crypto.randomUUID(),
        },
      },
    })
    if (result.error) throw result.error
    if (!result.data) throw new Error('Translation returned no result')
    if (options.json) ui.json(result.data.translateArticle)
    else
      ui.success(
        `Saved ${target} translation (10 credits). It shares the article's publication settings.`,
      )
  } else if (action === 'default') {
    const result = await client.graphql.mutate({
      mutation: CliSetArticleDefaultLanguageDocument,
      variables: { id: current.id, language: language! },
    })
    if (result.error) throw result.error
    if (options.json) ui.json(result.data)
    else ui.success(`Default language: ${language}`)
  } else {
    const version = current.versions.find(
      (v) => v.language === (action === 'label' ? source : language),
    )
    if (!version) throw new Error('Language version does not exist')
    if (action === 'label') {
      const result = await client.graphql.mutate({
        mutation: CliLabelArticleVersionDocument,
        variables: {
          id: current.id,
          language: source!,
          targetLanguage: target!,
          expectedRevision: version.revision,
        },
      })
      if (result.error) throw result.error
      if (options.json) ui.json(result.data)
      else ui.success(`Labeled version ${target}`)
    } else {
      const result = await client.graphql.mutate({
        mutation: CliDeleteArticleVersionDocument,
        variables: { id: current.id, language: language!, expectedRevision: version.revision },
      })
      if (result.error) throw result.error
      if (options.json) ui.json(result.data)
      else ui.success(`Deleted version ${language}`)
    }
  }
}
