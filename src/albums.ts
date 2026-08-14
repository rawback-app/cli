import { type FragmentType, useFragment } from '@rawback/sdk'
import {
  AlbumPermission,
  type CliAlbumFieldsFragment,
  CliAlbumFieldsFragmentDoc,
  type CliAlbumImageFieldsFragment,
  CliAlbumImageFieldsFragmentDoc,
  CliAlbumsDocument,
  CliAlbumDocument,
  CliAlbumSummaryDocument,
  CliCreateAlbumDocument,
  CliUpdateAlbumDocument,
  CliDeleteAlbumDocument,
  CliAddImageToAlbumDocument,
  CliRemoveImageFromAlbumDocument,
  CliAddTagsToAlbumDocument,
  CliRemoveTagsFromAlbumDocument,
  CliRefreshAlbumDocument,
  type CreateAlbumInput,
  type UpdateAlbumInput,
} from '@rawback/sdk'

import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import { albumListDocument, albumViewDocument } from './features/albums/view.ts'

export interface AlbumPrompts {
  confirm(message: string): Promise<boolean>
}

export interface AlbumCommandDependencies extends ReadCommandDependencies {
  prompts?: AlbumPrompts
}

export interface AlbumListOptions {
  json?: boolean
  page: number
  pageSize: number
  search?: string
}

export interface AlbumViewOptions {
  id: number
  json?: boolean
  page: number
  pageSize: number
}

interface AlbumMetadataOptions {
  cameraId?: number
  dateFrom?: string
  dateTo?: string
  description?: string
  lensId?: number
  permission?: string
  tagId?: Array<string | number>
  timezone?: string
}

function albumPermission(value: AlbumMetadataOptions['permission']): AlbumPermission {
  switch (value) {
    case 'protected':
      return AlbumPermission.Protected
    case 'public':
      return AlbumPermission.Public
    case 'private':
    case undefined:
      return AlbumPermission.Private
    default:
      throw new Error('--permission must be one of: private, protected, public')
  }
}

export interface AlbumCreateOptions extends AlbumMetadataOptions {
  json?: boolean
  name: string
}

export interface AlbumEditOptions extends AlbumMetadataOptions {
  clearCamera?: boolean
  clearDateFrom?: boolean
  clearDateTo?: boolean
  clearLens?: boolean
  clearTags?: boolean
  clearTimezone?: boolean
  coverImageId?: number
  id: number
  json?: boolean
  name?: string
}

export interface AlbumDeleteOptions {
  force?: boolean
  id: number
  json?: boolean
}

export interface AlbumRefreshOptions {
  id: number
  json?: boolean
}

export interface AlbumImageOptions {
  albumId: number
  force?: boolean
  imageId: number
  json?: boolean
}

export interface AlbumTagOptions {
  albumId: number
  json?: boolean
  tagIds: Array<string | number>
}

export function validatePositiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

export function parsePositiveIds(
  values: readonly (string | number)[] | undefined,
  label: string,
): number[] {
  const parsed = [
    ...new Set(
      (values ?? [])
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean)
        .map(Number),
    ),
  ]
  if (parsed.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} must contain only positive integers`)
  }
  return parsed
}

function validateName(value: string): string {
  const name = value.trim()
  if (name.length === 0) throw new Error('Album name is required')
  if (name.length > 100) throw new Error('Album name must be at most 100 characters')
  return name
}

function validateDescription(value: string | undefined): string | undefined {
  if (value !== undefined && value.length > 500) {
    throw new Error('Album description must be at most 500 characters')
  }
  return value
}

function parseDate(value: string, option: string): number {
  const trimmed = value.trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (dateOnly) {
    const parsed = Date.parse(`${trimmed}T00:00:00.000Z`)
    if (Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === trimmed) {
      return parsed
    }
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error(`${option} must be a valid YYYY-MM-DD date or RFC3339 timestamp`)
}

function validateDates(dateFrom: string | undefined, dateTo: string | undefined): void {
  const from = dateFrom === undefined ? undefined : parseDate(dateFrom, '--date-from')
  const to = dateTo === undefined ? undefined : parseDate(dateTo, '--date-to')
  if (from !== undefined && to !== undefined && from > to) {
    throw new Error('--date-from must not be later than --date-to')
  }
}

function validateTimezone(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const timezone = value.trim()
  if (timezone.length === 0) throw new Error('--timezone must not be empty')
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  } catch {
    throw new Error('--timezone must be a valid IANA timezone name')
  }
  return timezone
}

function optionalId(value: number | undefined, label: string): number | undefined {
  return value === undefined ? undefined : validatePositiveId(value, label)
}

export function createAlbumInput(options: AlbumCreateOptions): CreateAlbumInput {
  validateDates(options.dateFrom, options.dateTo)
  const description = validateDescription(options.description)
  const timezone = validateTimezone(options.timezone)
  const tagIds = parsePositiveIds(options.tagId, '--tag-id')
  const cameraId = optionalId(options.cameraId, '--camera-id')
  const lensId = optionalId(options.lensId, '--lens-id')
  return {
    name: validateName(options.name),
    permission: albumPermission(options.permission),
    tagIds,
    ...(description !== undefined ? { description } : {}),
    ...(options.dateFrom !== undefined ? { dateFrom: options.dateFrom.trim() } : {}),
    ...(options.dateTo !== undefined ? { dateTo: options.dateTo.trim() } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(cameraId !== undefined ? { cameraId } : {}),
    ...(lensId !== undefined ? { lensId } : {}),
  }
}

function rejectSetAndClear(
  value: unknown,
  clear: boolean | undefined,
  option: string,
  clearOption: string,
): void {
  if (value !== undefined && clear) {
    throw new Error(`${option} and ${clearOption} cannot be used together`)
  }
}

export function updateAlbumInput(options: AlbumEditOptions): UpdateAlbumInput {
  const id = validatePositiveId(options.id, 'Album ID')
  rejectSetAndClear(options.tagId, options.clearTags, '--tag-id', '--clear-tags')
  rejectSetAndClear(options.dateFrom, options.clearDateFrom, '--date-from', '--clear-date-from')
  rejectSetAndClear(options.dateTo, options.clearDateTo, '--date-to', '--clear-date-to')
  rejectSetAndClear(options.timezone, options.clearTimezone, '--timezone', '--clear-timezone')
  rejectSetAndClear(options.cameraId, options.clearCamera, '--camera-id', '--clear-camera')
  rejectSetAndClear(options.lensId, options.clearLens, '--lens-id', '--clear-lens')
  validateDates(options.dateFrom, options.dateTo)

  const description = validateDescription(options.description)
  const timezone = validateTimezone(options.timezone)
  const cameraId = optionalId(options.cameraId, '--camera-id')
  const lensId = optionalId(options.lensId, '--lens-id')
  const coverImageId = optionalId(options.coverImageId, '--cover-image-id')
  const input: UpdateAlbumInput = {
    id,
    ...(options.name !== undefined ? { name: validateName(options.name) } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(options.permission !== undefined
      ? { permission: albumPermission(options.permission) }
      : {}),
    ...(coverImageId !== undefined ? { coverImageId } : {}),
    ...(options.tagId !== undefined ? { tagIds: parsePositiveIds(options.tagId, '--tag-id') } : {}),
    ...(options.clearTags ? { tagIds: [] } : {}),
    ...(options.dateFrom !== undefined ? { dateFrom: options.dateFrom.trim() } : {}),
    ...(options.dateTo !== undefined ? { dateTo: options.dateTo.trim() } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(cameraId !== undefined ? { cameraId } : {}),
    ...(lensId !== undefined ? { lensId } : {}),
    ...(options.clearDateFrom ? { clearDateFrom: true } : {}),
    ...(options.clearDateTo ? { clearDateTo: true } : {}),
    ...(options.clearTimezone ? { clearTimezone: true } : {}),
    ...(options.clearCamera ? { clearCameraId: true } : {}),
    ...(options.clearLens ? { clearLensId: true } : {}),
  }
  if (Object.keys(input).length === 1) {
    throw new Error('rawback album edit requires at least one change option')
  }
  return input
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

export function serializeAlbum(album: CliAlbumFieldsFragment) {
  return {
    id: album.id,
    name: album.name,
    description: album.description,
    slug: album.slug,
    permission: album.permission,
    status: album.status,
    isSecret: album.isSecret,
    coverImage: album.coverImage
      ? {
          id: album.coverImage.id,
          filename: album.coverImage.filename,
          url: album.coverImage.url,
          thumbnailUrl: album.coverImage.thumbnailUrl ?? null,
          rotation: album.coverImage.rotation,
        }
      : null,
    imageCount: album.imageCount,
    tags: album.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      color: tag.color ?? null,
    })),
    dateFrom: album.dateFrom ?? null,
    dateTo: album.dateTo ?? null,
    timezone: album.timezone ?? null,
    camera: album.camera
      ? { id: album.camera.id, make: album.camera.make ?? null, model: album.camera.model }
      : null,
    lens: album.lens
      ? { id: album.lens.id, make: album.lens.make ?? null, model: album.lens.model }
      : null,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  }
}

function serializeImage(image: CliAlbumImageFieldsFragment) {
  return {
    id: image.id,
    displayName: image.displayName,
    filename: image.filename,
    url: image.url,
    thumbnailUrl: image.thumbnailUrl ?? null,
    status: image.status,
    width: image.width ?? null,
    height: image.height ?? null,
    blurhash: image.blurhash ?? null,
    capturedAt: image.capturedAt ?? null,
    cameraMake: image.cameraMake ?? null,
    cameraModel: image.cameraModel ?? null,
    rotation: image.rotation,
    rate: image.rate ?? null,
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

function fragmentAlbum(
  value: FragmentType<typeof CliAlbumFieldsFragmentDoc>,
): CliAlbumFieldsFragment {
  return useFragment(CliAlbumFieldsFragmentDoc, value)
}

async function albumSummary(
  id: number,
  dependencies: AlbumCommandDependencies,
): Promise<CliAlbumFieldsFragment> {
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.query({ query: CliAlbumSummaryDocument, variables: { id } })
  if (result.error) throw result.error
  if (!result.data) throw new Error('The album response did not include album data')
  if (!result.data.me.album) throw new Error(`Album ${id} not found`)
  return fragmentAlbum(result.data.me.album)
}

async function confirm(
  dependencies: AlbumCommandDependencies,
  message: string,
  nonInteractiveMessage: string,
): Promise<boolean> {
  if (dependencies.prompts) return dependencies.prompts.confirm(message)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(nonInteractiveMessage)
  const { confirm: prompt } = await import('@inquirer/prompts')
  return prompt({ default: false, message })
}

function mutationOutput(
  album: CliAlbumFieldsFragment,
  options: { json?: boolean },
  dependencies: AlbumCommandDependencies,
  message: string,
): void {
  const ui = commandOutput(dependencies)
  if (options.json) {
    ui.json(serializeAlbum(album))
  } else {
    ui.success(message)
  }
}

export async function runAlbumList(
  options: AlbumListOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  validatePagination(options.page, options.pageSize)
  const search = options.search?.trim()
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading albums…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({
        query: CliAlbumsDocument,
        variables: {
          pagination: { page: options.page, pageSize: options.pageSize },
          ...(search ? { keyword: search } : {}),
        },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The albums response did not include album data')
  const albums = result.data.me.albums.edges.map(fragmentAlbum)
  const pagination = pageInfo(result.data.me.albums.pageInfo)
  if (options.json) {
    ui.json({ albums: albums.map(serializeAlbum), pageInfo: pagination })
    return
  }
  ui.document(albumListDocument(albums, pagination))
}

export async function runAlbumView(
  options: AlbumViewOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  const id = validatePositiveId(options.id, 'Album ID')
  validatePagination(options.page, options.pageSize)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading album…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({
        query: CliAlbumDocument,
        variables: { id, pagination: { page: options.page, pageSize: options.pageSize } },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The album response did not include album data')
  const resultAlbum = result.data.me.album
  if (!resultAlbum) throw new Error(`Album ${id} not found`)
  const album = fragmentAlbum(resultAlbum)
  const images = resultAlbum.images.edges.map((image) =>
    useFragment(CliAlbumImageFieldsFragmentDoc, image),
  )
  const pagination = pageInfo(resultAlbum.images.pageInfo)
  if (options.json) {
    ui.json({
      album: serializeAlbum(album),
      images: images.map(serializeImage),
      pageInfo: pagination,
    })
    return
  }
  ui.document(albumViewDocument(album, images, pagination))
}

export async function runAlbumCreate(
  options: AlbumCreateOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  const input = createAlbumInput(options)
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliCreateAlbumDocument,
    variables: { input },
  })
  if (result.error) throw result.error
  const value = result.data?.createAlbum
  if (!value) throw new Error('The create album response did not include the album')
  const album = fragmentAlbum(value)
  mutationOutput(album, options, dependencies, `Created album ${album.id} (${album.name}).`)
}

export async function runAlbumEdit(
  options: AlbumEditOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  const input = updateAlbumInput(options)
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliUpdateAlbumDocument,
    variables: { input },
  })
  if (result.error) throw result.error
  const value = result.data?.updateAlbum
  if (!value) throw new Error('The update album response did not include the album')
  const album = fragmentAlbum(value)
  mutationOutput(album, options, dependencies, `Updated album ${album.id} (${album.name}).`)
}

export async function runAlbumDelete(
  options: AlbumDeleteOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  const id = validatePositiveId(options.id, 'Album ID')
  if (!options.force) {
    const album = await albumSummary(id, dependencies)
    const confirmed = await confirm(
      dependencies,
      `Delete album "${album.name}" (ID ${id})?`,
      'Deleting an album requires an interactive terminal unless --force is provided.',
    )
    if (!confirmed) {
      const ui = commandOutput(dependencies)
      if (options.json) {
        ui.json({ deleted: false, id })
      } else {
        ui.info('Deletion cancelled.')
      }
      return
    }
  }
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliDeleteAlbumDocument,
    variables: { id },
  })
  if (result.error) throw result.error
  if (result.data?.deleteAlbum !== true) {
    throw new Error('The delete album response did not confirm deletion')
  }
  const ui = commandOutput(dependencies)
  if (options.json) {
    ui.json({ deleted: true, id })
  } else {
    ui.success(`Deleted album ${id}.`)
  }
}

export async function runAlbumRefresh(
  options: AlbumRefreshOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.id, 'Album ID')
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliRefreshAlbumDocument,
    variables: { albumId },
  })
  if (result.error) throw result.error
  const value = result.data?.refreshAlbum
  if (!value) throw new Error('The refresh album response did not include the album')
  const album = fragmentAlbum(value)
  mutationOutput(
    album,
    options,
    dependencies,
    `Refreshing album ${album.id} (${album.name}); photo collection runs in the background.`,
  )
}

export async function runAlbumImageAdd(
  options: AlbumImageOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  const imageId = validatePositiveId(options.imageId, 'Image ID')
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliAddImageToAlbumDocument,
    variables: { albumId, imageId },
  })
  if (result.error) throw result.error
  const value = result.data?.addImageToAlbum
  if (!value) throw new Error('The add image response did not include the album')
  const album = fragmentAlbum(value)
  mutationOutput(
    album,
    options,
    dependencies,
    `Added image ${imageId} to album ${album.id} (${album.name}).`,
  )
}

export async function runAlbumImageRemove(
  options: AlbumImageOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  const imageId = validatePositiveId(options.imageId, 'Image ID')
  if (!options.force) {
    const album = await albumSummary(albumId, dependencies)
    const confirmed = await confirm(
      dependencies,
      `Remove image ${imageId} from album "${album.name}" (ID ${albumId})?`,
      'Removing an image from an album requires an interactive terminal unless --force is provided.',
    )
    if (!confirmed) {
      const ui = commandOutput(dependencies)
      if (options.json) {
        ui.json({ albumId, imageId, removed: false })
      } else {
        ui.info('Image removal cancelled.')
      }
      return
    }
  }
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.mutate({
    mutation: CliRemoveImageFromAlbumDocument,
    variables: { albumId, imageId },
  })
  if (result.error) throw result.error
  const value = result.data?.removeImageFromAlbum
  if (!value) throw new Error('The remove image response did not include the album')
  const album = fragmentAlbum(value)
  mutationOutput(
    album,
    options,
    dependencies,
    `Removed image ${imageId} from album ${album.id} (${album.name}).`,
  )
}

async function runAlbumTags(
  operation: 'add' | 'remove',
  options: AlbumTagOptions,
  dependencies: AlbumCommandDependencies,
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, 'Album ID')
  const tagIds = parsePositiveIds(options.tagIds, 'Tag IDs')
  if (tagIds.length === 0) throw new Error('At least one tag ID is required')
  const client = await createCommandClient(dependencies)
  let value: FragmentType<typeof CliAlbumFieldsFragmentDoc> | undefined
  if (operation === 'add') {
    const result = await client.graphql.mutate({
      mutation: CliAddTagsToAlbumDocument,
      variables: { albumId, tagIds },
    })
    if (result.error) throw result.error
    value = result.data?.addTagsToAlbum
  } else {
    const result = await client.graphql.mutate({
      mutation: CliRemoveTagsFromAlbumDocument,
      variables: { albumId, tagIds },
    })
    if (result.error) throw result.error
    value = result.data?.removeTagsFromAlbum
  }
  if (!value) throw new Error(`The ${operation} tags response did not include the album`)
  const album = fragmentAlbum(value)
  mutationOutput(
    album,
    options,
    dependencies,
    `${operation === 'add' ? 'Added' : 'Removed'} ${tagIds.length} tag${tagIds.length === 1 ? '' : 's'} ${operation === 'add' ? 'to' : 'from'} album ${album.id} (${album.name}).`,
  )
}

export function runAlbumTagAdd(
  options: AlbumTagOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  return runAlbumTags('add', options, dependencies)
}

export function runAlbumTagRemove(
  options: AlbumTagOptions,
  dependencies: AlbumCommandDependencies = {},
): Promise<void> {
  return runAlbumTags('remove', options, dependencies)
}
