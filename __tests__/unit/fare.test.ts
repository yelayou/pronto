import { describe, it, expect } from 'vitest'
import { calculateFare } from '@/lib/fare/calculator'

// ─── Benchmark ────────────────────────────────────────────────────────────────

describe('benchmark ride — 25 km / 30 min', () => {
  it('returns $25.09 total (HST included)', () => {
    const result = calculateFare({
      distanceKm: 25,
      durationMin: 30,
      serviceType: 'ride',
      timeOfDay: 'normal',
      heavyTraffic: false,
    })
    expect(result.total).toBeCloseTo(25.09, 1)
  })

  it('time wins over distance', () => {
    const result = calculateFare({
      distanceKm: 25,
      durationMin: 30,
      serviceType: 'ride',
      timeOfDay: 'normal',
      heavyTraffic: false,
    })
    // time = 30 × 0.74 = $22.20, dist = 25 × 0.60 = $15.00 → time wins
    expect(result.winner).toBe('time')
    expect(result.timeCost).toBeCloseTo(22.20, 2)
    expect(result.distCost).toBeCloseTo(15.00, 2)
  })
})

// ─── Time vs distance ─────────────────────────────────────────────────────────

describe('time vs distance winner', () => {
  it('distance wins on a fast highway run (low time, high km)', () => {
    // 40 km in 25 min — fast highway trip
    // time = 25 × 0.74 = $18.50, dist = 40 × 0.60 = $24.00 → distance wins
    const result = calculateFare({
      distanceKm: 40,
      durationMin: 25,
      serviceType: 'ride',
      timeOfDay: 'normal',
      heavyTraffic: false,
    })
    expect(result.winner).toBe('distance')
    expect(result.distCost).toBeGreaterThan(result.timeCost)
  })

  it('time wins in slow city traffic (high time, low km)', () => {
    // 5 km in 25 min — gridlock
    // time = 25 × 0.74 = $18.50, dist = 5 × 0.60 = $3.00 → time wins
    const result = calculateFare({
      distanceKm: 5,
      durationMin: 25,
      serviceType: 'ride',
      timeOfDay: 'normal',
      heavyTraffic: false,
    })
    expect(result.winner).toBe('time')
  })
})

// ─── Dead mileage tier ────────────────────────────────────────────────────────

describe('dead mileage premium beyond 35 km', () => {
  it('applies $0.30/km premium on distance beyond 35 km', () => {
    // 45 km: first 35 × $0.60 = $21.00, next 10 × ($0.60+$0.30) = $9.00 → $30.00
    const result = calculateFare({
      distanceKm: 45,
      durationMin: 10, // very short time so distance wins
      serviceType: 'ride',
      timeOfDay: 'normal',
      heavyTraffic: false,
    })
    expect(result.distCost).toBeCloseTo(35 * 0.60 + 10 * 0.90, 2)
    expect(result.winner).toBe('distance')
  })

  it('does not apply premium for trips under 35 km', () => {
    const result = calculateFare({
      distanceKm: 30,
      durationMin: 5,
      serviceType: 'ride',
      timeOfDay: 'normal',
      heavyTraffic: false,
    })
    expect(result.distCost).toBeCloseTo(30 * 0.60, 2)
  })
})

// ─── Minimum fare ─────────────────────────────────────────────────────────────

describe('minimum fare floors', () => {
  it('applies $7 minimum for a very short ride', () => {
    const result = calculateFare({
      distanceKm: 1,
      durationMin: 2,
      serviceType: 'ride',
      timeOfDay: 'normal',
      heavyTraffic: false,
    })
    // preHST should be $7, total = $7 × 1.13 = $7.91
    expect(result.preHST).toBeCloseTo(7.00, 2)
    expect(result.total).toBeCloseTo(7.91, 1)
    expect(result.winner).toBe('minimum')
  })

  it('applies $8 minimum for a very short package', () => {
    const result = calculateFare({
      distanceKm: 1,
      durationMin: 2,
      serviceType: 'package',
      timeOfDay: 'normal',
      heavyTraffic: false,
      packageSize: 'small',
    })
    expect(result.preHST).toBeGreaterThanOrEqual(8.00)
  })
})

// ─── Multipliers ──────────────────────────────────────────────────────────────

describe('peak and late night multipliers', () => {
  it('applies 1.5× peak multiplier', () => {
    const normal = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: false,
    })
    const peak = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'peak', heavyTraffic: false,
    })
    expect(peak.preHST).toBeCloseTo(normal.preHST * 1.5, 1)
  })

  it('applies 1.3× late night multiplier', () => {
    const normal = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: false,
    })
    const late = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'late', heavyTraffic: false,
    })
    expect(late.preHST).toBeCloseTo(normal.preHST * 1.3, 1)
  })
})

// ─── Traffic surcharge ────────────────────────────────────────────────────────

describe('traffic surcharge', () => {
  it('adds $3.00 when heavy traffic is true', () => {
    const clear = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: false,
    })
    const heavy = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: true,
    })
    expect(heavy.surcharges.traffic).toBe(3.00)
    expect(heavy.preHST - clear.preHST).toBeCloseTo(3.00, 2)
  })
})

// ─── Package surcharges ───────────────────────────────────────────────────────

describe('package surcharges', () => {
  it('adds $2 for small package', () => {
    const result = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'package',
      timeOfDay: 'normal', heavyTraffic: false, packageSize: 'small',
    })
    expect(result.surcharges.package).toBe(2.00)
  })

  it('adds $5 for large package', () => {
    const result = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'package',
      timeOfDay: 'normal', heavyTraffic: false, packageSize: 'large',
    })
    expect(result.surcharges.package).toBe(5.00)
  })

  it('adds $3 fragile fee on top of size fee', () => {
    const result = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'package',
      timeOfDay: 'normal', heavyTraffic: false, packageSize: 'small', fragile: true,
    })
    expect(result.surcharges.package).toBe(2.00)
    expect(result.surcharges.fragile).toBe(3.00)
  })

  it('does not apply fragile fee to rides', () => {
    const result = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: false, fragile: true,
    })
    expect(result.surcharges.fragile).toBe(0)
  })
})

// ─── HST ──────────────────────────────────────────────────────────────────────

describe('HST', () => {
  it('HST is 13% of preHST amount', () => {
    const result = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: false,
    })
    expect(result.hst).toBeCloseTo(result.preHST * 0.13, 2)
  })

  it('total = preHST + hst', () => {
    const result = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: false,
    })
    expect(result.total).toBeCloseTo(result.preHST + result.hst, 2)
  })
})

// ─── Range ────────────────────────────────────────────────────────────────────

describe('fare range', () => {
  it('range is ±5% of total', () => {
    const result = calculateFare({
      distanceKm: 25, durationMin: 30, serviceType: 'ride',
      timeOfDay: 'normal', heavyTraffic: false,
    })
    expect(result.rangeL).toBeCloseTo(result.total * 0.95, 2)
    expect(result.rangeH).toBeCloseTo(result.total * 1.05, 2)
  })
})
