import { supabase } from './client'
import type { GeocodeResult } from '@/lib/maps/client'

const TTL_DAYS = 7
const TABLE = 'geocode_cache'

export function normaliseKey(address: string): string {
  return address.toLowerCase().trim()
}

export async function getCachedGeocode(address: string): Promise<GeocodeResult | null> {
  const key = normaliseKey(address)
  const expiry = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from(TABLE)
    .select('lat, lng, formatted_address, cached_at')
    .eq('address_key', key)
    .gt('cached_at', expiry)
    .single()

  if (error || !data) return null

  return {
    lat: data.lat,
    lng: data.lng,
    formattedAddress: data.formatted_address,
  }
}

export async function setCachedGeocode(address: string, result: GeocodeResult): Promise<void> {
  const key = normaliseKey(address)

  const { error } = await supabase.from(TABLE).upsert({
    address_key: key,
    lat: result.lat,
    lng: result.lng,
    formatted_address: result.formattedAddress,
    cached_at: new Date().toISOString(),
  })

  if (error) {
    console.warn('[geocode-cache] failed to write cache entry:', error.message)
  }
}
