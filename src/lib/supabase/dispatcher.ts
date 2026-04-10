import { supabase } from './client'
import type { DispatcherState } from '@/types'

const TABLE = 'dispatcher_state'
const ROW_ID = 1

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the current dispatcher state.
 * Returns null if the row doesn't exist yet.
 */
export async function getDispatcherState(): Promise<DispatcherState | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', ROW_ID)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // row not found
    throw new Error(`Failed to fetch dispatcher state: ${error.message}`)
  }

  return rowToState(data)
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Set dispatcher ON DUTY with a zone name.
 */
export async function setOnDuty(zone: string): Promise<DispatcherState> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      duty_status: 'on',
      current_zone: zone,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ROW_ID)
    .select()
    .single()

  if (error) throw new Error(`Failed to set ON DUTY: ${error.message}`)
  return rowToState(data)
}

/**
 * Set dispatcher OFF DUTY — clears zone and location.
 */
export async function setOffDuty(): Promise<DispatcherState> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      duty_status: 'off',
      current_zone: null,
      current_lat: null,
      current_lng: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ROW_ID)
    .select()
    .single()

  if (error) throw new Error(`Failed to set OFF DUTY: ${error.message}`)
  return rowToState(data)
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
