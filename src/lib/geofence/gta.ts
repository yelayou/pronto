/**
 * Pronto — GTA Geofence Validator (PRT-26)
 *
 * Determines whether a given lat/lng falls within the Greater Toronto Area
 * service boundary. Prevents bookings outside the service zone (e.g. Ottawa,
 * Hamilton, Barrie, Guelph).
 *
 * Approach:
 *   1. Fast bounding-box pre-check  — rejects obviously out-of-range points
 *   2. Ray-casting polygon test     — accurate boundary for edge cases
 *
 * The polygon covers City of Toronto + Region of York + Region of Peel +
 * Region of Durham + Region of Halton (all five GTA upper-tier municipalities).
 *
 * Vertices are [lat, lng] pairs traced clockwise from the SW corner.
 */

export interface GeofenceResult {
  withinGTA: boolean
  /** Human-readable explanation when outside the service area */
  reason?: string
}

// ─── GTA boundary polygon ─────────────────────────────────────────────────────
// Traced clockwise from Burlington/Hamilton border (SW) → Oshawa coast (SE) →
// Uxbridge/Clarington (NE) → Caledon/Newmarket (N) → Brampton/Halton (NW)

const GTA_POLYGON: Array<[number, number]> = [
  // ── South / SW (below Burlington — into Lake Ontario so all GTA land is in) ─
  [43.2700, -79.8700], // SW anchor (lake) — well south of Burlington
  [43.2700, -79.9500], // SW, west leg below Oakville / Halton Hills
  // ── West (Halton Hills / Brampton) ───────────────────────────────────────
  [43.6500, -79.9700], // Brampton W / Halton Hills NW
  [43.8500, -79.9700], // Caledon W
  // ── North (Caledon / Newmarket) ──────────────────────────────────────────
  [44.0000, -79.9000], // Caledon N / Peel northern limit
  [44.1000, -79.7500], // Schomberg / King Twp N
  [44.1300, -79.5000], // Newmarket / Bradford N
  [44.1500, -79.2500], // East Gwillimbury / Uxbridge N
  // ── NE / East (Durham Region) ────────────────────────────────────────────
  [44.0500, -78.9000], // Uxbridge / Clarington N
  [43.9500, -78.7500], // Clarington / Oshawa E boundary
  [43.8500, -78.7500], // Oshawa coast (easternmost)
  // ── South / SE (Lake Ontario shoreline, east→west) ───────────────────────
  [43.2700, -78.7500], // SE anchor (lake) — south of Oshawa
  [43.2700, -79.8700], // close — back to SW anchor
]

// ─── Bounding box (cheap pre-check) ──────────────────────────────────────────

const BBOX = {
  latMin: 43.25,
  latMax: 44.20,
  lngMin: -79.97,
  lngMax: -78.70,
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the coordinate is within the GTA service area.
 */
export function isWithinGTA(lat: number, lng: number): boolean {
  return validateGTALocation(lat, lng).withinGTA
}

/**
 * Full validation result with an optional human-readable reason.
 */
export function validateGTALocation(lat: number, lng: number): GeofenceResult {
  // 1. Bounding-box fast rejection
  if (
    lat < BBOX.latMin ||
    lat > BBOX.latMax ||
    lng < BBOX.lngMin ||
    lng > BBOX.lngMax
  ) {
    return {
      withinGTA: false,
      reason: 'Sorry, that location is outside our GTA service area.',
    }
  }

  // 2. Polygon test (ray-casting algorithm)
  if (!pointInPolygon(lat, lng, GTA_POLYGON)) {
    return {
      withinGTA: false,
      reason: 'Sorry, that location is outside our GTA service area.',
    }
  }

  return { withinGTA: true }
}

// ─── Ray-casting ──────────────────────────────────────────────────────────────

/**
 * Even-odd ray-casting point-in-polygon test.
 * Casts a horizontal ray from (lat, lng) and counts edge crossings.
 * An odd count means the point is inside the polygon.
 *
 * Using lat as Y-axis and lng as X-axis (standard for geographic polygons).
 */
function pointInPolygon(
  lat: number,
  lng: number,
  polygon: Array<[number, number]>
): boolean {
  let inside = false
  const n = polygon.length

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]

    // Does the edge [i, j] cross the horizontal ray from (lat, lng) to +∞?
    const crossesLatitude = yi > lat !== yj > lat
    if (crossesLatitude) {
      const xIntersect = ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (lng < xIntersect) {
        inside = !inside
      }
    }
  }

  return inside
}
