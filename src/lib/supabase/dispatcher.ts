import { supabase } from './client'
import type { DispatcherState } from '@/types'

const TABLE = 'dispatcher_state'
const ROW_ID = 1

const TTL_MS = (Number(process.env.DISPATCHER_CACHE_TTL_SECONDS) || 30) * 1000

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: { value: DispatcherState; cachedAt: number } | null = null

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the current dispatcher state, served from an in-memory cache with a
 * 30-second TTL (configurable via DISPATCHER_CACHE_TTL_SECONDS).
 * Cache is invalidated immediately on setOnDuty / setOffDuty.
 */
export async function getDispatcherState(): Promise<DispatcherState | null> {
  if (cache && Date.now() - cache.cachedAt < TTL_MS) {
    return cache.value
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', ROW_ID)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // row not found
    throw new Error(`Failed to fetch dispatcher state: ${error.message}`)
  }

  const value = rowToState(data)
  cache = { value, cachedAt: Date.now() }
  return value
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Set dispatcher ON DUTY with a zone name.
 * Uses upsert so the row is created if the migration seed hasn't run yet.
 */
export async function setOnDuty(zone: string): Promise<DispatcherState> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({
      id: ROW_ID,
      duty_status: 'on',
      current_zone: zone,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to set ON DUTY: ${error.message}`)
  const value = rowToState(data)
  cache = { value, cachedAt: Date.now() }
  return value
}

/**
 * Set dispatcher OFF DUTY — clears zone and location.
 * Uses upsert so the row is created if the migration seed hasn't run yet.
 */
export async function setOffDuty(): Promise<DispatcherState> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({
      id: ROW_ID,
      duty_status: 'off',
      current_zone: null,
      current_lat: null,
      current_lng: null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to set OFF DUTY: ${error.message}`)
  const value = rowToState(data)
  cache = { value, cachedAt: Date.now() }
  return value
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToState(row: Record<string, unknown>): DispatcherState {
  return {
    dutyStatus: row.duty_status as 'on' | 'off',
    currentZone: (row.current_zone as string) ?? null,
    currentLat: row.current_lat as number | undefined,
    currentLng: row.current_lng as number | undefined,
    updatedAt: row.updated_at as string,
  }
}
