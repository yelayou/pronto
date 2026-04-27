/**
 * Unit tests for the GTA landmark lookup table (PRT-64 / PRT-68)
 *
 * Tests keyword matching, option integrity, and edge cases.
 * Pure functions — no mocking required.
 */

import { describe, it, expect } from 'vitest'
import { findLandmark, getLandmarkOption, LANDMARKS } from '@/lib/landmarks'

// ─── Data integrity ───────────────────────────────────────────────────────────

describe('LANDMARKS data integrity', () => {
  it('defines exactly 3 landmarks', () => {
    expect(Object.keys(LANDMARKS)).toHaveLength(3)
    expect(LANDMARKS).toHaveProperty('pearson')
    expect(LANDMARKS).toHaveProperty('union_station')
    expect(LANDMARKS).toHaveProperty('billy_bishop')
  })

  it('each landmark has at least 2 options', () => {
    for (const landmark of Object.values(LANDMARKS)) {
      expect(landmark.options.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('each option has a label, shortLabel, and valid GTA lat/lng', () => {
    for (const landmark of Object.values(LANDMARKS)) {
      for (const option of landmark.options) {
        expect(option.label).toBeTruthy()
        expect(option.shortLabel).toBeTruthy()
        // GTA bounds sanity check
        expect(option.lat).toBeGreaterThan(43.0)
        expect(option.lat).toBeLessThan(44.5)
        expect(option.lng).toBeGreaterThan(-80.5)
        expect(option.lng).toBeLessThan(-79.0)
      }
    }
  })

  it('each landmark has a non-empty prompt string', () => {
    for (const landmark of Object.values(LANDMARKS)) {
      expect(landmark.prompt.trim().length).toBeGreaterThan(0)
    }
  })

  it('each landmark has at least one trigger keyword', () => {
    for (const landmark of Object.values(LANDMARKS)) {
      expect(landmark.triggers.length).toBeGreaterThan(0)
    }
  })
})

// ─── Pearson Airport ──────────────────────────────────────────────────────────

describe('findLandmark — Pearson Airport', () => {
  it('matches "pearson"', () => {
    expect(findLandmark('pearson')?.id).toBe('pearson')
  })

  it('matches "airport"', () => {
    expect(findLandmark('airport')?.id).toBe('pearson')
  })

  it('matches "yyz" (case-insensitive)', () => {
    expect(findLandmark('YYZ')?.id).toBe('pearson')
  })

  it('matches within a sentence: "drop me at the airport"', () => {
    expect(findLandmark('drop me at the airport')?.id).toBe('pearson')
  })

  it('matches "toronto pearson"', () => {
    expect(findLandmark('toronto pearson')?.id).toBe('pearson')
  })

  it('has Terminal 1 and Terminal 3 options', () => {
    const labels = LANDMARKS.pearson.options.map((o) => o.label)
    expect(labels).toContain('Terminal 1')
    expect(labels).toContain('Terminal 3')
  })
})

// ─── Union Station ────────────────────────────────────────────────────────────

describe('findLandmark — Union Station', () => {
  it('matches "union station"', () => {
    expect(findLandmark('union station')?.id).toBe('union_station')
  })

  it('matches standalone "union" (word boundary)', () => {
    expect(findLandmark('union')?.id).toBe('union_station')
  })

  it('matches within a phrase "drop off at union"', () => {
    expect(findLandmark('drop off at union')?.id).toBe('union_station')
  })

  it('matches "go station"', () => {
    expect(findLandmark('go station')?.id).toBe('union_station')
  })

  it('matches "via rail"', () => {
    expect(findLandmark('via rail')?.id).toBe('union_station')
  })

  it('matches "union" even in an ambiguous phrase like "123 union ave" (conservative flag)', () => {
    // The word-boundary regex \bunion\b matches "union" in "union ave".
    // This is intentional — better to ask for disambiguation than to geocode wrong.
    expect(findLandmark('123 union ave')?.id).toBe('union_station')
  })

  it('has Front St, Bay St, and GO/VIA options', () => {
    const labels = LANDMARKS.union_station.options.map((o) => o.label)
    expect(labels).toContain('Front St entrance')
    expect(labels).toContain('Bay St entrance')
    expect(labels).toContain('GO/VIA concourse')
  })
})

// ─── Billy Bishop ─────────────────────────────────────────────────────────────

describe('findLandmark — Billy Bishop Airport', () => {
  it('matches "billy bishop"', () => {
    expect(findLandmark('billy bishop')?.id).toBe('billy_bishop')
  })

  it('matches "island airport"', () => {
    expect(findLandmark('island airport')?.id).toBe('billy_bishop')
  })

  it('matches "ytz" (case-insensitive)', () => {
    expect(findLandmark('flying out of YTZ')?.id).toBe('billy_bishop')
  })

  it('matches "porter" (common airline name at YTZ)', () => {
    expect(findLandmark('porter')?.id).toBe('billy_bishop')
  })

  it('has Passenger terminal and Ferry terminal options', () => {
    const labels = LANDMARKS.billy_bishop.options.map((o) => o.label)
    expect(labels).toContain('Passenger terminal')
    expect(labels).toContain('Ferry terminal (mainland)')
  })
})

// ─── No match ─────────────────────────────────────────────────────────────────

describe('findLandmark — no match', () => {
  it('returns null for a regular address', () => {
    expect(findLandmark('123 Main St, Toronto')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(findLandmark('')).toBeNull()
  })

  it('returns null for a typical GTA intersection', () => {
    expect(findLandmark('King St and Spadina Ave')).toBeNull()
  })

  it('returns null for a suburb address', () => {
    expect(findLandmark('4500 Sheppard Ave E, Scarborough')).toBeNull()
  })
})

// ─── getLandmarkOption ────────────────────────────────────────────────────────

describe('getLandmarkOption', () => {
  it('returns Terminal 1 for pearson index 0', () => {
    const opt = getLandmarkOption('pearson', 0)
    expect(opt?.label).toBe('Terminal 1')
    expect(opt?.shortLabel).toBe('T1')
    expect(opt?.lat).toBeCloseTo(43.6777, 2)
    expect(opt?.lng).toBeCloseTo(-79.6248, 2)
  })

  it('returns Terminal 3 for pearson index 1', () => {
    const opt = getLandmarkOption('pearson', 1)
    expect(opt?.label).toBe('Terminal 3')
    expect(opt?.shortLabel).toBe('T3')
  })

  it('returns Front St entrance for union_station index 0', () => {
    const opt = getLandmarkOption('union_station', 0)
    expect(opt?.label).toBe('Front St entrance')
  })

  it('returns null for an out-of-range index', () => {
    expect(getLandmarkOption('pearson', 99)).toBeNull()
  })

  it('returns null for a negative index', () => {
    expect(getLandmarkOption('pearson', -1)).toBeNull()
  })

  it('returns null for an unknown landmark id', () => {
    expect(getLandmarkOption('nowhere', 0)).toBeNull()
  })
})
