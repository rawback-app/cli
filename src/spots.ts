import {
  type FragmentType,
  SpotDocument,
  type SpotFieldsFragment,
  SpotFieldsFragmentDoc,
  type SpotPhotoFieldsFragment,
  SpotPhotoFieldsFragmentDoc,
  SpotsDocument,
  SpotSunPlanDocument,
  useFragment,
} from '@rawback/sdk'

import { validatePositiveId } from './albums.ts'
import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import { spotDocument, spotListDocument, sunPlanDocument } from './features/spots/view.ts'
import { parseNear } from './geo.ts'

export type SpotCommandDependencies = ReadCommandDependencies

export interface SpotListOptions {
  featured?: boolean
  json?: boolean
  /** `"latitude,longitude"`: only spots within `radius` meters, nearest first. */
  near?: string
  page: number
  pageSize: number
  radius?: number
}

export interface SpotGetOptions {
  id: string
  json?: boolean
  page: number
  pageSize: number
}

export interface SpotSunOptions {
  date: string
  id: string
  json?: boolean
  photoId?: number
}

/** Spot IDs are level-18 map cells, `18-<x>-<y>`. */
const SPOT_ID = /^18-\d+-\d+$/
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateSpotId(id: string): string {
  const trimmed = id.trim()
  if (!SPOT_ID.test(trimmed)) {
    throw new Error('Spot ID must look like 18-206451-130118 (from rawback spots list)')
  }
  return trimmed
}

export type SpotPhoto = SpotPhotoFieldsFragment
export type Spot = Omit<SpotFieldsFragment, 'representative'> & { representative: SpotPhoto }

function unmaskSpot(value: FragmentType<typeof SpotFieldsFragmentDoc>): Spot {
  const spot = useFragment(SpotFieldsFragmentDoc, value)
  return { ...spot, representative: unmaskPhoto(spot.representative) }
}

function unmaskPhoto(value: FragmentType<typeof SpotPhotoFieldsFragmentDoc>): SpotPhoto {
  return useFragment(SpotPhotoFieldsFragmentDoc, value)
}

function serializePhoto(photo: SpotPhoto) {
  return {
    id: photo.id,
    title: photo.title,
    url: photo.url,
    thumbnailUrl: photo.thumbnailUrl,
    photographerName: photo.photographerName,
    photographerSlug: photo.photographerSlug,
    latitude: photo.latitude,
    longitude: photo.longitude,
    capturedAt: photo.capturedAt ?? null,
    camera: photo.camera ?? null,
    lens: photo.lens ?? null,
    iso: photo.iso ?? null,
    aperture: photo.aperture ?? null,
    exposureTime: photo.exposureTime ?? null,
    focalLength: photo.focalLength ?? null,
    reactionCount: photo.reactionCount,
  }
}

function serializeSpot(spot: Spot) {
  return {
    id: spot.id,
    name: spot.name,
    latitude: spot.latitude,
    longitude: spot.longitude,
    photoCount: spot.photoCount,
    representative: serializePhoto(spot.representative),
  }
}

/** `rawback spots list` — public photography spots, optionally near a point. */
export async function runSpotList(
  options: SpotListOptions,
  dependencies: SpotCommandDependencies = {},
): Promise<void> {
  validatePagination(options.page, options.pageSize)
  const near = parseNear(options.near, options.radius)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading spots…',
    async () => {
      // Spots are public; a signed-out CLI can browse them too.
      const client = await createCommandClient(dependencies, false)
      return client.graphql.query({
        query: SpotsDocument,
        variables: {
          page: options.page,
          pageSize: options.pageSize,
          ...(options.featured ? { featured: true } : {}),
          ...(near ? { near } : {}),
        },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The spots response did not include spot data')

  const spots = result.data.spots.spots.map(unmaskSpot)
  const pageInfo = result.data.spots.pageInfo
  if (options.json) {
    ui.json({ spots: spots.map(serializeSpot), pageInfo })
    return
  }
  ui.document(spotListDocument(spots, pageInfo))
}

/** `rawback spots view <id>` — one spot and a page of its published photos. */
export async function runSpotGet(
  options: SpotGetOptions,
  dependencies: SpotCommandDependencies = {},
): Promise<void> {
  const id = validateSpotId(options.id)
  validatePagination(options.page, options.pageSize)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading spot…',
    async () => {
      const client = await createCommandClient(dependencies, false)
      return client.graphql.query({
        query: SpotDocument,
        variables: { id, page: options.page, pageSize: options.pageSize },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data?.spot) throw new Error(`Spot ${id} was not found or has no public photos`)

  const spot = unmaskSpot(result.data.spot)
  const photos = result.data.spot.photos.photos.map(unmaskPhoto)
  const pageInfo = result.data.spot.photos.pageInfo
  if (options.json) {
    ui.json({ spot: serializeSpot(spot), photos: photos.map(serializePhoto), pageInfo })
    return
  }
  ui.document(spotDocument(spot, photos, pageInfo))
}

/** `rawback spots sun <id> --date YYYY-MM-DD` — sunrise, sunset and golden hour. */
export async function runSpotSun(
  options: SpotSunOptions,
  dependencies: SpotCommandDependencies = {},
): Promise<void> {
  const id = validateSpotId(options.id)
  const date = options.date.trim()
  if (!LOCAL_DATE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new Error('--date must be a calendar date, YYYY-MM-DD')
  }
  const photoId =
    options.photoId === undefined ? undefined : validatePositiveId(options.photoId, '--photo-id')
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Planning the light…',
    async () => {
      const client = await createCommandClient(dependencies, false)
      return client.graphql.query({
        query: SpotSunPlanDocument,
        variables: { id, date, ...(photoId !== undefined ? { photoId } : {}) },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The response did not include a sun plan')

  if (options.json) {
    ui.json({ spotId: id, ...result.data.spotSunPlan })
    return
  }
  ui.document(sunPlanDocument(id, result.data.spotSunPlan))
}
