/**
 * Pronto — Google Maps Platform client
 *
 * Provides three operations:
 *   geocode()        — text address → LatLng + canonical formatted address
 *   reverseGeocode() — LatLng → formatted address string
 *   getRoute()       — origin + destination → distance, duration, traffic flag
 *
 * All calls are server-side only (GOOGLE_MAPS_API_KEY is never exposed to the browser).
 */

import type { LatLng, RouteResult } from '@/types'

const API_KEY = process.env.GOOGLE_MAPS_API_KEY

if (!API_KEY) {
  throw new Error('Missing env var: GOOGLE_MAPS_API_KEY')
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
}

// ─── Geocode ──────────────────────────────────────────────────────────────────

/**
 * Convert a free-text address to coordinates + canonical formatted address.
 * Returns null if Google can't find a match.
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', `${address}, Ontario, Canada`)
  url.searchParams.set('region', 'ca')
  url.searchParams.set('key', API_KEY!)

  const res = await fetch(url.toString())
  const json = await res.json() as GoogleGeocodeResponse

  if (json.status !== 'OK' || json.results.length === 0) {
    console.warn('[maps] geocode failed:', json.status, address)
    return null
  }

  const result = json.results[0]
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  }
}

// ─── Reverse geocode ──────────────────────────────────────────────────────────

/**
 * Convert coordinates to a human-readable street address.
 * Returns a short street-level address or the full formatted address as fallback.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('latlng', `${lat},${lng}`)
  url.searchParams.set('result_type', 'street_address|route')
  url.searchParams.set('key', API_KEY!)

  const res = await fetch(url.toString())
  const json = await res.json() as GoogleGeocodeResponse

  if (json.status !== 'OK' || json.results.length === 0) {
    // Fallback: just return the coordinates as a string
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }

  return json.results[0].formatted_address
}

// ─── Route (distance + duration) ─────────────────────────────────────────────

/**
 * Get distance and estimated duration between two points.
 * Accepts either a text address or a LatLng object.
 *
 * Heavy traffic flag is set when live traffic adds >20% to the baseline duration.
 */
export async function getRoute(
  origin: string | LatLng,
  destination: string | LatLng
): Promise<RouteResult | null> {
  const originStr =
    typeof origin === 'string' ? origin : `${origin.lat},${origin.lng}`
  const destStr =
    typeof destination === 'string'
      ? destination
      : `${destination.lat},${destination.lng}`

  const url = new URL(
    'https://maps.googleapis.com/maps/api/distancematrix/json'
  )
  url.searchParams.set('origins', originStr)
  url.searchParams.set('destinations', destStr)
  url.searchParams.set('units', 'metric')
  url.searchParams.set('departure_time', 'now')        // enables live traffic
  url.searchParams.set('traffic_model', 'best_guess')
  url.searchParams.set('key', API_KEY!)

  const res = await fetch(url.toString())
  const json = await res.json() as GoogleDistanceMatrixResponse

  if (json.status !== 'OK') {
    console.warn('[maps] distance matrix failed:', json.status)
    return null
  }

  const element = json.rows[0]?.elements[0]
  if (!element || element.status !== 'OK') {
    console.warn('[maps] distance matrix element failed:', element?.status)
    return null
  }

  const distanceKm = element.distance.value / 1000
  // duration_in_traffic is present when departure_time=now and traffic data available
  const durationMin = Math.round(
    (element.duration_in_traffic?.value ?? element.duration.value) / 60
  )
  const durationMinNoTraffic = Math.round(element.duration.value / 60)
  const heavyTraffic = durationMin > durationMinNoTraffic * 1.2

  return { distanceKm, durationMin, durationMinNoTraffic, heavyTraffic }
}

// ─── Google Maps API response types ──────────────────────────────────────────

interface GoogleGeocodeResponse {
  status: string
  results: Array<{
    formatted_address: string
    geometry: { location: { lat: number; lng: number } }
  }>
}

interface GoogleDistanceMatrixResponse {
  status: string
  rows: Array<{
    elements: Array<{
      status: string
      distance: { value: number; text: string }
      duration: { value: number; text: string }
      duration_in_traffic?: { value: number; text: string }
    }>
  }>
}
