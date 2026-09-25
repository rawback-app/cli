import type { GeoNearInput } from '@rawback/sdk'

/** The server's limit for `near.radiusMeters`, shared by photos and spots. */
export const MAX_RADIUS_METERS = 500_000
export const DEFAULT_RADIUS_METERS = 1_000

/**
 * Builds a `GeoNearInput` from `--near "lat,lng"` and `--radius <meters>`.
 * Returns undefined when neither is given, and throws before any request when
 * they are malformed or `--radius` arrives without a point.
 */
export function parseNear(
  near: string | undefined,
  radius: number | undefined,
): GeoNearInput | undefined {
  if (near === undefined) {
    if (radius !== undefined) throw new Error('--radius needs --near')
    return undefined
  }
  const parts = near.split(',').map((part) => part.trim())
  const [latitude, longitude] = parts.map((part) => (part === '' ? Number.NaN : Number(part)))
  if (
    parts.length !== 2 ||
    latitude === undefined ||
    longitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error('--near must be "latitude,longitude" in degrees, e.g. --near 37.7749,-122.4194')
  }
  const radiusMeters = radius ?? DEFAULT_RADIUS_METERS
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > MAX_RADIUS_METERS) {
    throw new Error(
      `--radius must be greater than 0 and at most ${String(MAX_RADIUS_METERS)} meters`,
    )
  }
  return { latitude, longitude, radiusMeters }
}
