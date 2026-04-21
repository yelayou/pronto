/**
 * Unit tests for the GTA geofence validator (PRT-26)
 *
 * Covers:
 *  - Known GTA locations (should be inside)
 *  - Known out-of-GTA locations (should be outside)
 *  - Edge cases near the boundary
 */

import { describe, it, expect } from 'vitest'
import { isWithinGTA, validateGTALocation } from '@/lib/geofence/gta'

// ─── Inside GTA ───────────────────────────────────────────────────────────────

describe('isWithinGTA — locations inside the service area', () => {
  const cases: Array<[string, number, number]> = [
    ['Toronto downtown',       43.6532, -79.3832],
    ['Scarborough',            43.7731, -79.2580],
    ['North York',             43.7615, -79.4111],
    ['Etobicoke',              43.6205, -79.5132],
    ['Mississauga city centre',43.5890, -79.6441],
    ['Brampton downtown',      43.6854, -79.7593],
    ['Vaughan',                43.8361, -79.5006],
    ['Markham',                43.8561, -79.3370],
    ['Richmond Hill',          43.8828, -79.4403],
    ['Newmarket',              44.0592, -79.4610],
    ['Ajax',                   43.8509, -79.0204],
    ['Pickering',              43.8354, -79.0900],
    ['Whitby',                 43.8975, -78.9421],
    ['Oshawa downtown',        43.8971, -78.8658],
    ['Oakville',               43.4675, -79.6877],
    ['Burlington downtown',    43.3255, -79.7990],
  ]

  it.each(cases)('%s [%f, %f] should be inside GTA', (_name, lat, lng) => {
    expect(isWithinGTA(lat, lng)).toBe(true)
  })
})

// ─── Outside GTA ─────────────────────────────────────────────────────────────

describe('isWithinGTA — locations outside the service area', () => {
  const cases: Array<[string, number, number]> = [
    ['Ottawa downtown',        45.4215, -75.6972],
    ['Hamilton downtown',      43.2557, -79.8711],
    ['Barrie downtown',        44.3894, -79.6903],
    ['Guelph downtown',        43.5448, -80.2482],
    ['Kitchener downtown',     43.4516, -80.4925],
    ['London, ON',             42.9849, -81.2453],
    ['Windsor, ON',            42.3149, -83.0364],
    ['Kingston, ON',           44.2312, -76.4860],
    ['Niagara Falls',          43.0962, -79.0377],
    ['Buffalo, NY',            42.8864, -78.8784],
    ['Orangeville (N Caledon)',43.9200, -80.0940],
  ]

  it.each(cases)('%s [%f, %f] should be outside GTA', (_name, lat, lng) => {
    expect(isWithinGTA(lat, lng)).toBe(false)
  })
})

// ─── validateGTALocation result shape ────────────────────────────────────────

describe('validateGTALocation', () => {
  it('returns withinGTA: true with no reason for Toronto', () => {
    const result = validateGTALocation(43.6532, -79.3832)
    expect(result.withinGTA).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('returns withinGTA: false with a reason string for Ottawa', () => {
    const result = validateGTALocation(45.4215, -75.6972)
    expect(result.withinGTA).toBe(false)
    expect(typeof result.reason).toBe('string')
    expect(result.reason!.length).toBeGreaterThan(10)
  })

  it('returns withinGTA: false for a point far south in Lake Ontario', () => {
    // Mid-lake — not a real address but good for polygon test
    const result = validateGTALocation(43.2000, -79.0000)
    expect(result.withinGTA).toBe(false)
  })
})
