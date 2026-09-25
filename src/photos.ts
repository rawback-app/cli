import {
  CliUpdatePhotoDocument,
  type ImageFilter,
  ImageOrderBy,
  ImagePermission,
  ImageStatus,
  PhotosDocument,
  type PhotosQuery,
} from '@rawback/sdk'

import { parsePositiveIds } from './albums.ts'
import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import { photoListDocument, photoPermissionDocument } from './features/photos/view.ts'
import { parseNear } from './geo.ts'

const IMAGE_STATUSES = new Set<string>(Object.values(ImageStatus))
const IMAGE_PERMISSIONS = new Set<string>(Object.values(ImagePermission))
export const PHOTO_SORTS = ['newest', 'rating', 'relevance', 'distance'] as const
export type PhotoSort = (typeof PHOTO_SORTS)[number]

export interface PhotoListOptions {
  /**
   * `images.aiSearch.id` from an earlier search. Replays that translation
   * without spending an AI credit, which is how later pages stay free.
   */
  aiSearchId?: string
  apertureMax?: number
  apertureMin?: number
  cameraMake?: string[]
  cameraModel?: string[]
  capturedAfter?: string
  capturedBefore?: string
  city?: string[]
  country?: string[]
  focalLengthMax?: number
  focalLengthMin?: number
  hasGps?: boolean
  json?: boolean
  lensModel?: string[]
  /** `"latitude,longitude"`: only photos taken within `radius` meters of it. */
  near?: string
  page: number
  pageSize: number
  /** Standalone access levels to keep: private, protected, public. */
  permission?: string[]
  /** A plain-language request the server translates into filters. */
  prompt?: string
  /** Meters around `near`; defaults to 1000. */
  radius?: number
  rate?: string[]
  search?: string
  sort?: string
  status?: string[]
}

export type PhotoListDependencies = ReadCommandDependencies

function listValues(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined
  const parsed = [
    ...new Set(
      values
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  return parsed.length > 0 ? parsed : undefined
}

function parseTimestamp(value: string, option: string): number {
  const numeric = Number(value)
  if (value.trim().length > 0 && Number.isFinite(numeric)) return numeric
  const timestamp = new Date(value).getTime() / 1000
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${option} must be an ISO date/time or Unix timestamp in seconds`)
  }
  return timestamp
}

function validateRange(min: number | undefined, max: number | undefined, name: string): void {
  if (min !== undefined && (!Number.isFinite(min) || min < 0)) {
    throw new Error(`--${name}-min must be a non-negative number`)
  }
  if (max !== undefined && (!Number.isFinite(max) || max < 0)) {
    throw new Error(`--${name}-max must be a non-negative number`)
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`--${name}-min must not be greater than --${name}-max`)
  }
}

export function createPhotoFilter(options: PhotoListOptions): ImageFilter {
  validatePagination(options.page, options.pageSize)
  validateRange(options.apertureMin, options.apertureMax, 'aperture')
  validateRange(options.focalLengthMin, options.focalLengthMax, 'focal-length')

  const statuses = listValues(options.status)
  if (statuses?.some((status) => !IMAGE_STATUSES.has(status))) {
    throw new Error(`--status must contain only: ${[...IMAGE_STATUSES].join(', ')}`)
  }
  const prompt = options.prompt?.trim()
  const aiSearchId = options.aiSearchId?.trim()
  if (aiSearchId && !prompt) {
    throw new Error('--ai-search-id needs the --prompt it came from')
  }

  const rawRates = listValues(options.rate)
  // The 3-star floor is a browsing default. Applying it to a plain-language
  // request would silently drop photos the user explicitly asked for, so a
  // prompt only gets a rating filter when one was passed explicitly.
  const defaultRates = prompt ? undefined : [3, 4, 5]
  const rates = rawRates?.map(Number) ?? defaultRates
  if (
    rates &&
    (rates.length === 0 || rates.some((rate) => !Number.isInteger(rate) || rate < 0 || rate > 5))
  ) {
    throw new Error('--rate must contain integers between 0 and 5')
  }

  const capturedAfter =
    options.capturedAfter === undefined
      ? undefined
      : parseTimestamp(options.capturedAfter, '--captured-after')
  const capturedBefore =
    options.capturedBefore === undefined
      ? undefined
      : parseTimestamp(options.capturedBefore, '--captured-before')
  if (
    capturedAfter !== undefined &&
    capturedBefore !== undefined &&
    capturedAfter > capturedBefore
  ) {
    throw new Error('--captured-after must not be later than --captured-before')
  }

  const permissions = listValues(options.permission)
  if (permissions?.some((permission) => !IMAGE_PERMISSIONS.has(permission))) {
    throw new Error(`--permission must contain only: ${[...IMAGE_PERMISSIONS].join(', ')}`)
  }
  const near = parseNear(options.near, options.radius)

  const search = options.search?.trim()
  return {
    ...(rates ? { rate: [...new Set(rates)] } : {}),
    ...(statuses ? { status: statuses as ImageStatus[] } : {}),
    ...(search ? { search } : {}),
    ...(prompt ? { prompt } : {}),
    // Sent alongside the prompt, never instead of it: the server prefers the
    // id and re-resolves the prompt when the id has expired, so a stale id
    // costs a credit rather than failing the command.
    ...(prompt && aiSearchId ? { aiSearchId } : {}),
    ...(listValues(options.cameraMake) ? { cameraMake: listValues(options.cameraMake) } : {}),
    ...(listValues(options.cameraModel) ? { cameraModel: listValues(options.cameraModel) } : {}),
    ...(listValues(options.lensModel) ? { lensModel: listValues(options.lensModel) } : {}),
    ...(capturedAfter !== undefined ? { capturedAfter } : {}),
    ...(capturedBefore !== undefined ? { capturedBefore } : {}),
    ...(options.apertureMin !== undefined ? { apertureMin: options.apertureMin } : {}),
    ...(options.apertureMax !== undefined ? { apertureMax: options.apertureMax } : {}),
    ...(options.focalLengthMin !== undefined ? { focalLengthMin: options.focalLengthMin } : {}),
    ...(options.focalLengthMax !== undefined ? { focalLengthMax: options.focalLengthMax } : {}),
    ...(listValues(options.city) ? { city: listValues(options.city) } : {}),
    ...(listValues(options.country) ? { country: listValues(options.country) } : {}),
    ...(options.hasGps ? { hasGps: true } : {}),
    ...(near ? { near } : {}),
    ...(permissions ? { permission: permissions as ImagePermission[] } : {}),
  }
}

/**
 * Maps `--sort` onto `ImageOrderBy`. `distance` and `relevance` would quietly
 * fall back to newest-first on the server without the input they rank by, so
 * that is refused here instead.
 */
export function photoOrderBy(options: PhotoListOptions): ImageOrderBy | undefined {
  switch (options.sort) {
    case undefined:
    case 'newest':
      return undefined
    case 'rating':
      return ImageOrderBy.RATEDESC
    case 'relevance':
      if (!options.search?.trim()) throw new Error('--sort relevance needs --search')
      return ImageOrderBy.RELEVANCE
    case 'distance':
      if (options.near === undefined) throw new Error('--sort distance needs --near')
      return ImageOrderBy.DISTANCE
    default:
      throw new Error(`--sort must be one of: ${PHOTO_SORTS.join(', ')}`)
  }
}

type Photo = PhotosQuery['images']['edges'][number]

function serializePhoto(photo: Photo) {
  return {
    id: photo.id,
    filename: photo.filename,
    url: photo.url,
    thumbnailUrl: photo.thumbnailUrl ?? null,
    status: photo.status,
    width: photo.width ?? null,
    height: photo.height ?? null,
    capturedAt: photo.capturedAt ?? null,
    cameraMake: photo.cameraMake ?? null,
    cameraModel: photo.cameraModel ?? null,
    rotation: photo.rotation,
    rate: photo.rate ?? null,
    permission: photo.permission,
    latitude: photo.latitude ?? null,
    longitude: photo.longitude ?? null,
    city: photo.city ?? null,
    country: photo.country ?? null,
    editedImages: photo.editedImages.map((image) => ({
      url: image.url,
      thumbnailUrl: image.thumbnailUrl ?? null,
      width: image.width,
      height: image.height,
      blurhash: image.blurhash ?? null,
      createdAt: image.createdAt,
    })),
  }
}

export async function runPhotoList(
  options: PhotoListOptions,
  dependencies: PhotoListDependencies = {},
): Promise<void> {
  const filter = createPhotoFilter(options)
  const orderBy = photoOrderBy(options)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading photos…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({
        query: PhotosDocument,
        variables: {
          filter,
          pagination: { page: options.page, pageSize: options.pageSize },
          ...(orderBy ? { orderBy } : {}),
        },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The photos response did not include photo data')

  const { edges, pageInfo, aiSearch } = result.data.images
  const serializedPageInfo = {
    page: pageInfo.page,
    pageSize: pageInfo.pageSize,
    totalCount: pageInfo.totalCount,
    totalPages: pageInfo.totalPages,
    hasNextPage: pageInfo.hasNextPage,
    hasPreviousPage: pageInfo.hasPreviousPage,
  }
  if (options.json) {
    ui.json({
      photos: edges.map(serializePhoto),
      pageInfo: serializedPageInfo,
      // Carried verbatim so a script can page with `aiSearch.id` and not be
      // charged again for the same request.
      aiSearch: aiSearch ?? null,
    })
    return
  }
  ui.document(photoListDocument(edges, pageInfo, aiSearch))
}

/**
 * `rawback photos search "<prompt>"` — the plain-language entry point.
 *
 * Shares the runner with `photos list`; the only difference is that the prompt
 * arrives as a positional argument rather than a flag.
 */
export function runPhotoSearch(
  options: PhotoListOptions,
  dependencies: PhotoListDependencies = {},
): Promise<void> {
  if (!options.prompt?.trim()) {
    throw new Error(
      'Provide something to search for, e.g. rawback photos search "photos from 2012 in NYC"',
    )
  }
  return runPhotoList(options, dependencies)
}

export interface PhotoPermissionOptions {
  imageIds: ReadonlyArray<string | number>
  json?: boolean
  /** private, protected or public. */
  level: string
}

export interface PhotoPermissionResult {
  id: number
  ok: boolean
  permission: ImagePermission | null
  error: string | null
}

/** Parallel `updateImage` calls; small enough to stay polite to the API. */
const PERMISSION_CONCURRENCY = 4

export function photoPermission(level: string): ImagePermission {
  if (!IMAGE_PERMISSIONS.has(level)) {
    throw new Error(`Permission must be one of: ${[...IMAGE_PERMISSIONS].join(', ')}`)
  }
  return level as ImagePermission
}

/**
 * `rawback photos permission <level> <image-ids..>` — sets each photo's
 * standalone access. The server takes one photo per call, so the IDs are sent
 * a few at a time; one photo failing does not stop the rest, but any failure
 * makes the command exit nonzero.
 */
export async function runPhotoPermission(
  options: PhotoPermissionOptions,
  dependencies: PhotoListDependencies = {},
): Promise<void> {
  const permission = photoPermission(options.level)
  const ids = parsePositiveIds(options.imageIds, 'Image ID')
  if (ids.length === 0) throw new Error('Provide at least one image ID')
  const ui = commandOutput(dependencies)
  const results = await ui.withActivity(
    `Setting ${String(ids.length)} photo${ids.length === 1 ? '' : 's'} to ${permission}…`,
    async () => {
      const client = await createCommandClient(dependencies)
      const out: PhotoPermissionResult[] = Array.from({ length: ids.length })
      let next = 0
      const worker = async (): Promise<void> => {
        while (next < ids.length) {
          const index = next++
          const id = ids[index] as number
          try {
            const result = await client.graphql.mutate({
              mutation: CliUpdatePhotoDocument,
              variables: { input: { id, permission } },
            })
            if (result.error) throw result.error
            if (!result.data) throw new Error('The response did not include the updated photo')
            out[index] = {
              id,
              ok: true,
              permission: result.data.updateImage.permission,
              error: null,
            }
          } catch (error) {
            out[index] = {
              id,
              ok: false,
              permission: null,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PERMISSION_CONCURRENCY, ids.length) }, () => worker()),
      )
      return out
    },
    !options.json,
  )

  const failed = results.filter((result) => !result.ok).length
  if (options.json) {
    ui.json({ permission, results, succeeded: results.length - failed, failed })
  } else {
    ui.document(photoPermissionDocument(permission, results))
  }
  if (failed > 0) {
    throw new Error(
      `${String(failed)} of ${String(results.length)} photo${results.length === 1 ? '' : 's'} could not be updated`,
    )
  }
}
