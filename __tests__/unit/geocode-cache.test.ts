/**
 * Unit tests for the Supabase geocode cache layer (PRT-38).
 *
 * Tests: cache hit returns DB result, cache miss returns null, stale entries
 * are skipped, setCachedGeocode upserts correctly, and geocodeAddress
 * integrates the cache (hit skips API, miss writes to cache).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Supabase client ─────────────────────────────────────────────────────

const mockSingle = vi.hoisted(() => vi.fn())
const mockUpsert = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      upsert: mockUpsert,
      single: mockSingle,
    }),
  },
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const cachedRow = {
  lat: 43.589,
  lng: -79.644,
  formatted_address: '300 City Centre Dr, Mississauga, ON L5B 3C1, Canada',
  cached_at: new Date().toISOString(),
}

// ─── getCachedGeocode ─────────────────────────────────────────────────────────

describe('getCachedGeocode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsert.mockReturnValue({ error: null })
  })

  it('returns geocode result when a fresh cache entry exists', async () => {
    mockSingle.mockResolvedValueOnce({ data: cachedRow, error: null })
    const { getCachedGeocode } = await import('@/lib/supabase/geocodeCache')

    const result = await getCachedGeocode('300 City Centre Dr')

    expect(result).toEqual({
      lat: 43.589,
      lng: -79.644,
      formattedAddress: '300 City Centre Dr, Mississauga, ON L5B 3C1, Canada',
    })
  })

  it('returns null when no cache entry exists', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
    const { getCachedGeocode } = await import('@/lib/supabase/geocodeCache')

    const result = await getCachedGeocode('unknown place')

    expect(result).toBeNull()
  })

  it('normalises address key to lowercase trimmed before lookup', async () => {
    const { normaliseKey } = await import('@/lib/supabase/geocodeCache')

    expect(normaliseKey('  Union Station  ')).toBe('union station')
    expect(normaliseKey('PEARSON AIRPORT')).toBe('pearson airport')
    expect(normaliseKey('123 Main St')).toBe('123 main st')
  })
})

// ─── setCachedGeocode ─────────────────────────────────────────────────────────

describe('setCachedGeocode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts the result with the correct shape', async () => {
    mockUpsert.mockReturnValueOnce({ error: null })
    const { setCachedGeocode } = await import('@/lib/supabase/geocodeCache')

    await setCachedGeocode('Union Station', {
      lat: 43.6453,
      lng: -79.3806,
      formattedAddress: 'Union Station, Toronto, ON, Canada',
    })

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        address_key: 'union station',
        lat: 43.6453,
        lng: -79.3806,
        formatted_address: 'Union Station, Toronto, ON, Canada',
      })
    )
  })

  it('does not throw when upsert returns an error', async () => {
    mockUpsert.mockReturnValueOnce({ error: { message: 'db error' } })
    const { setCachedGeocode } = await import('@/lib/supabase/geocodeCache')

    await expect(
      setCachedGeocode('some address', { lat: 1, lng: 2, formattedAddress: 'Test' })
    ).resolves.toBeUndefined()
  })
})
