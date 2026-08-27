/**
 * Unit tests for the Maps client geocoding bias fix (PRT-58)
 *
 * These tests mock the global fetch to assert:
 *  - The address sent to the Geocoding API uses `Ontario, Canada` (not `Toronto, ON`)
 *  - Addresses in Mississauga, Brampton, and Toronto all use the same province-level bias
 *  - A null result is returned when the API reports a non-OK status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Always return a cache miss so these tests exercise the API path
vi.mock('@/lib/supabase/geocodeCache', () => ({
  getCachedGeocode: vi.fn().mockResolvedValue(null),
  setCachedGeocode: vi.fn().mockResolvedValue(undefined),
}))

// Set required env var before importing the module
process.env.GOOGLE_MAPS_API_KEY = 'test-key'

// Dynamically import after env is set
const { geocodeAddress } = await import('@/lib/maps/client')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGeocodeResponse(overrides: Partial<{ status: string; formatted_address: string; lat: number; lng: number }> = {}) {
  const { status = 'OK', formatted_address = '123 Test St, Mississauga, ON, Canada', lat = 43.5890, lng = -79.6441 } = overrides
  return {
    status,
    results: status === 'OK' ? [{ formatted_address, geometry: { location: { lat, lng } } }] : [],
  }
}

function mockFetch(body: object) {
  return vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: () => Promise.resolve(body),
  }))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('geocodeAddress — address bias (PRT-58)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('appends ", Ontario, Canada" to a Mississauga address — NOT ", Toronto, ON"', async () => {
    mockFetch(makeGeocodeResponse({ formatted_address: '123 Hurontario St, Mississauga, ON, Canada' }))

    await geocodeAddress('123 Hurontario St')

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(fetchCall).toContain('Ontario%2C+Canada')
    expect(fetchCall).not.toContain('Toronto%2C+ON')
    expect(fetchCall).not.toContain('Toronto, ON')
  })

  it('appends ", Ontario, Canada" to a Brampton address', async () => {
    mockFetch(makeGeocodeResponse({ formatted_address: '1 Main St N, Brampton, ON, Canada' }))

    await geocodeAddress('1 Main St N, Brampton')

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(fetchCall).toContain('Ontario%2C+Canada')
  })

  it('appends ", Ontario, Canada" to a Toronto address too (unchanged behaviour for Toronto)', async () => {
    mockFetch(makeGeocodeResponse({ formatted_address: 'Union Station, Toronto, ON, Canada', lat: 43.6453, lng: -79.3806 }))

    await geocodeAddress('Union Station')

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(fetchCall).toContain('Ontario%2C+Canada')
  })

  it('returns correct lat/lng from the API response', async () => {
    mockFetch(makeGeocodeResponse({ lat: 43.5890, lng: -79.6441, formatted_address: '300 City Centre Dr, Mississauga, ON, Canada' }))

    const result = await geocodeAddress('300 City Centre Dr')

    expect(result).not.toBeNull()
    expect(result!.lat).toBe(43.5890)
    expect(result!.lng).toBe(-79.6441)
    expect(result!.formattedAddress).toContain('Mississauga')
  })

  it('returns null when the API status is not OK', async () => {
    mockFetch(makeGeocodeResponse({ status: 'ZERO_RESULTS' }))

    const result = await geocodeAddress('some unknown place')

    expect(result).toBeNull()
  })

  it('uses region=ca in every request', async () => {
    mockFetch(makeGeocodeResponse())

    await geocodeAddress('Pearson Airport')

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(fetchCall).toContain('region=ca')
  })
})
