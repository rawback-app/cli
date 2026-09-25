import { type SpotSunPlanQuery, type SpotsQuery } from '@rawback/sdk'

import type { Spot, SpotPhoto } from '../../spots.ts'
import { sanitizeCell } from '../../ui/format.ts'
import { type UiBlock, cell, type UiDocument, type UiField } from '../../ui/model.ts'

type PageInfo = SpotsQuery['spots']['pageInfo']
type SunPlan = SpotSunPlanQuery['spotSunPlan']

const dash = () => cell('—', { dim: true })

function coordinates(latitude: number, longitude: number): string {
  return latitude.toFixed(5) + ', ' + longitude.toFixed(5)
}

function pagination(count: number, pageInfo: PageInfo): UiBlock {
  return {
    type: 'pagination',
    page: pageInfo.page,
    pageSize: pageInfo.pageSize,
    count,
    totalCount: pageInfo.totalCount,
    totalPages: pageInfo.totalPages,
  }
}

function exposure(photo: SpotPhoto): string {
  return [
    photo.focalLength ? String(photo.focalLength) + 'mm' : '',
    photo.aperture ? 'f/' + String(photo.aperture) : '',
    photo.exposureTime ? sanitizeCell(photo.exposureTime) + 's' : '',
    photo.iso ? 'ISO ' + String(photo.iso) : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function spotListDocument(spots: Spot[], pageInfo: PageInfo): UiDocument {
  return {
    title: 'Spots',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No public spots found.',
        columns: [
          // Never truncated: the ID is what `spots view` and `spots sun` take.
          { key: 'id', label: 'ID', required: true, priority: 1, minWidth: 16 },
          { key: 'name', label: 'Place', required: true, priority: 1, minWidth: 12 },
          { key: 'photos', label: 'Photos', priority: 2 },
          { key: 'location', label: 'Location', priority: 3 },
          { key: 'photographer', label: 'Top photo by', priority: 4 },
        ],
        rows: spots.map((spot) => ({
          id: spot.id,
          name: sanitizeCell(spot.name),
          photos: spot.photoCount,
          location: coordinates(spot.latitude, spot.longitude),
          photographer: sanitizeCell(spot.representative.photographerName) || dash(),
        })),
      },
      pagination(spots.length, pageInfo),
    ],
  }
}

export function spotDocument(spot: Spot, photos: SpotPhoto[], pageInfo: PageInfo): UiDocument {
  return {
    title: sanitizeCell(spot.name),
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'ID', value: spot.id },
          { label: 'Location', value: coordinates(spot.latitude, spot.longitude) },
          { label: 'Photos', value: spot.photoCount },
        ],
      },
      {
        type: 'table',
        emptyMessage: 'No photos on this page.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'title', label: 'Title', priority: 2, minWidth: 10 },
          { key: 'photographer', label: 'Photographer', priority: 2 },
          { key: 'camera', label: 'Camera', priority: 4 },
          { key: 'settings', label: 'Settings', priority: 3 },
          { key: 'reactions', label: 'Reactions', priority: 5 },
        ],
        rows: photos.map((photo) => ({
          id: photo.id,
          title: sanitizeCell(photo.title) || dash(),
          photographer: sanitizeCell(photo.photographerName) || dash(),
          camera: photo.camera ? sanitizeCell(photo.camera) : dash(),
          settings: exposure(photo) || dash(),
          reactions: photo.reactionCount,
        })),
      },
      pagination(photos.length, pageInfo),
    ],
  }
}

/** A time rendered in the spot's own zone, which is what a shoot is planned in. */
function localTime(value: string | null, timeZone: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  try {
    return date.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' })
  } catch {
    return date.toISOString().slice(11, 16) + ' UTC'
  }
}

function azimuth(value: number | null): string {
  return value === null ? '' : ' (' + String(Math.round(value)) + '°)'
}

export function sunPlanDocument(spotId: string, plan: SunPlan): UiDocument {
  const tz = plan.timezone
  const range = (start: string | null, end: string | null) => {
    const from = localTime(start, tz)
    const to = localTime(end, tz)
    return from && to ? from + '–' + to : dash()
  }
  const fields: UiField[] = [
    { label: 'Spot', value: spotId },
    { label: 'Date', value: plan.date + ' (' + tz + ')' },
    { label: 'Location', value: coordinates(plan.latitude, plan.longitude) },
  ]
  if (plan.state === 'polarDay' || plan.state === 'polarNight') {
    fields.push({
      label: 'Sun',
      value: plan.state === 'polarDay' ? 'up all day (polar day)' : 'down all day (polar night)',
    })
  } else {
    const sunrise = localTime(plan.sunrise, tz)
    const sunset = localTime(plan.sunset, tz)
    fields.push(
      { label: 'Sunrise', value: sunrise ? sunrise + azimuth(plan.sunriseAzimuth) : dash() },
      {
        label: 'Morning golden hour',
        value: range(plan.morningGoldenHourStart, plan.morningGoldenHourEnd),
      },
      { label: 'Evening golden hour', value: range(plan.goldenHourStart, plan.goldenHourEnd) },
      { label: 'Sunset', value: sunset ? sunset + azimuth(plan.sunsetAzimuth) : dash() },
    )
  }
  return { title: 'Sun plan', blocks: [{ type: 'fields', fields }] }
}
