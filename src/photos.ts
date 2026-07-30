import { type ImageFilter, ImageStatus, PhotosDocument, type PhotosQuery } from '@rawback/sdk'

import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import { photoListDocument } from './features/photos/view.ts'

const IMAGE_STATUSES = new Set<string>(Object.values(ImageStatus))

export interface PhotoListOptions {
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
  page: number
  pageSize: number
  rate?: string[]
  search?: string
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
  const rawRates = listValues(options.rate)
  const rates = rawRates?.map(Number) ?? [3, 4, 5]
  if (rates.length === 0 || rates.some((rate) => !Number.isInteger(rate) || rate < 0 || rate > 5)) {
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

  const search = options.search?.trim()
  return {
    rate: [...new Set(rates)],
    ...(statuses ? { status: statuses as ImageStatus[] } : {}),
    ...(search ? { search } : {}),
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
        },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The photos response did not include photo data')

  const { edges, pageInfo } = result.data.images
  const serializedPageInfo = {
    page: pageInfo.page,
    pageSize: pageInfo.pageSize,
    totalCount: pageInfo.totalCount,
    totalPages: pageInfo.totalPages,
    hasNextPage: pageInfo.hasNextPage,
    hasPreviousPage: pageInfo.hasPreviousPage,
  }
  if (options.json) {
    ui.json({ photos: edges.map(serializePhoto), pageInfo: serializedPageInfo })
    return
  }
  ui.document(photoListDocument(edges, pageInfo))
}
