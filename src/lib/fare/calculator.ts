/**
 * Pronto — Fare engine
 * Pure function, no side effects, no API calls.
 * All monetary values in CAD. HST (13%) baked into final total.
 */
import type { FareInput, FareResult } from '@/types'

// ─── Rate constants ───────────────────────────────────────────────────────────

const TIME_RATE = 0.74          // $ per minute
const DIST_RATE = 0.60          // $ per km (first 35 km)
const DEAD_MILEAGE_RATE = 0.30  // $ per km added on top after 35 km
const DEAD_MILEAGE_TIER = 35    // km threshold for dead mileage premium
const HST_RATE = 1.13           // 13% HST baked in
const FARE_RANGE = 0.05         // ±5% range shown to customer

const PEAK_MULTIPLIER = 1.5     // morning 7–9am, evening 4–7pm
const LATE_MULTIPLIER = 1.3     // after 10pm
const TRAFFIC_SURCHARGE = 3.00  // flat $3 when heavy traffic detected

const PKG_SMALL_FEE = 2.00
const PKG_LARGE_FEE = 5.00
const FRAGILE_FEE = 3.00

const MIN_FARE_RIDE = 7.00
const MIN_FARE_PACKAGE = 8.00

// ─── Core fare function ───────────────────────────────────────────────────────

/**
 * Calculate fare from trip inputs.
 * Pure function — no side effects, no API calls.
 * All monetary values are pre-rounding floats; round only at display time.
 *
 * Formula:
 *   time_cost  = durationMin × $0.74
 *   dist_cost  = (km × $0.60) + max(0, (km − 35) × $0.30)
 *   trip_base  = max(time_cost, dist_cost)
 *   subtotal   = trip_base + surcharges
 *   total      = max(min_fare, subtotal × multiplier) × 1.13
 */
export function calculateFare(input: FareInput): FareResult {
  const { distanceKm, durationMin, serviceType, timeOfDay, heavyTraffic, packageSize, fragile } =
    input

  // Time cost
  const timeCost = durationMin * TIME_RATE

  // Distance cost — tiered at 35 km
  const distBase = distanceKm * DIST_RATE
  const deadExtra = distanceKm > DEAD_MILEAGE_TIER
    ? (distanceKm - DEAD_MILEAGE_TIER) * DEAD_MILEAGE_RATE
    : 0
  const distCost = distBase + deadExtra

  // Trip base — higher of time or distance
  const tripBase = Math.max(timeCost, distCost)
  const winner: FareResult['winner'] =
    timeCost >= distCost ? 'time' : 'distance'

  // Surcharges
  const trafficFee = heavyTraffic ? TRAFFIC_SURCHARGE : 0
  const packageFee = serviceType === 'package'
    ? packageSize === 'large' ? PKG_LARGE_FEE : PKG_SMALL_FEE
    : 0
  const fragileFee = serviceType === 'package' && fragile ? FRAGILE_FEE : 0

  const surcharges = {
    traffic: trafficFee,
    package: packageFee,
    fragile: fragileFee,
  }

  const subtotal = tripBase + trafficFee + packageFee + fragileFee

  // Peak / late night multiplier
  const multiplier =
    timeOfDay === 'peak' ? PEAK_MULTIPLIER
    : timeOfDay === 'late' ? LATE_MULTIPLIER
    : 1.0

  const multiplied = subtotal * multiplier

  // Minimum fare floor
  const minFare = serviceType === 'ride' ? MIN_FARE_RIDE : MIN_FARE_PACKAGE
  const appliedMinimum = multiplied < minFare
  const beforeHST = Math.max(minFare, multiplied)

  // Final total with HST baked in
  const preHST = beforeHST
  const hst = preHST * (HST_RATE - 1)
  const total = preHST * HST_RATE

  // Range for customer display
  const rangeL = total * (1 - FARE_RANGE)
  const rangeH = total * (1 + FARE_RANGE)

  // Human-readable breakdown
  const breakdown = buildBreakdown({
    timeCost,
    distCost,
    winner: appliedMinimum ? 'minimum' : winner,
    surcharges,
    multiplier,
    minFare,
    appliedMinimum,
    preHST,
    hst,
    total,
    distanceKm,
    durationMin,
  })

  return {
    total,
    preHST,
    hst,
    rangeL,
    rangeH,
    winner: appliedMinimum ? 'minimum' : winner,
    timeCost,
    distCost,
    tripBase,
    surcharges,
    multiplier,
    breakdown,
  }
}

// ─── Breakdown builder ────────────────────────────────────────────────────────

function buildBreakdown(p: {
  timeCost: number
  distCost: number
  winner: FareResult['winner']
  surcharges: FareResult['surcharges']
  multiplier: number
  minFare: number
  appliedMinimum: boolean
  preHST: number
  hst: number
  total: number
  distanceKm: number
  durationMin: number
}): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []

  const fmt = (n: number) => `$${n.toFixed(2)}`

  if (p.winner === 'time' || p.winner === 'minimum') {
    rows.push({ label: `Time (${p.durationMin} min × $${TIME_RATE}) — used`, value: fmt(p.timeCost) })
    rows.push({ label: `Distance (${p.distanceKm} km × $${DIST_RATE}) — not used`, value: fmt(p.distCost) })
  } else {
    rows.push({ label: `Time (${p.durationMin} min × $${TIME_RATE}) — not used`, value: fmt(p.timeCost) })
    rows.push({ label: `Distance (${p.distanceKm} km × $${DIST_RATE}) — used`, value: fmt(p.distCost) })
  }

  if (p.surcharges.traffic) rows.push({ label: 'Traffic surcharge', value: fmt(p.surcharges.traffic) })
  if (p.surcharges.package) rows.push({ label: 'Package surcharge', value: fmt(p.surcharges.package) })
  if (p.surcharges.fragile) rows.push({ label: 'Fragile surcharge', value: fmt(p.surcharges.fragile) })
  if (p.multiplier > 1) rows.push({ label: `Multiplier (${p.multiplier}×)`, value: `×${p.multiplier}` })
  if (p.appliedMinimum) rows.push({ label: 'Minimum fare applied', value: fmt(p.minFare) })

  rows.push({ label: 'HST (13%)', value: fmt(p.hst) })
  rows.push({ label: 'Total', value: fmt(p.total) })

  return rows
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Format a fare result as a WhatsApp-friendly string.
 * e.g. "Estimated fare: *$23.80 – $26.40* (HST included)"
 */
export function formatFareForCustomer(result: FareResult): string {
  const low = result.rangeL.toFixed(2)
  const high = result.rangeH.toFixed(2)
  return `Estimated fare: *$${low} – $${high}* (HST included)`
}
