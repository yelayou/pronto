import { supabase } from './client'
import type { CustomerRecord } from '@/types'

const TABLE = 'customers'

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch a customer by phone number.
 * Returns null if the customer has never messaged before.
 */
export async function getCustomer(phone: string): Promise<CustomerRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('phone', phone)
    .maybeSingle()

  if (error) throw new Error(`Failed to fetch customer ${phone}: ${error.message}`)
  return data ? rowToCustomer(data) : null
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Upsert a customer record — creates on first message, updates last_seen on return.
 * Does NOT overwrite the name if one is already stored.
 */
export async function upsertCustomer(phone: string): Promise<CustomerRecord> {
  // Try insert first; on conflict just bump last_seen
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        phone,
        last_seen: new Date().toISOString(),
      },
      {
        onConflict: 'phone',
        ignoreDuplicates: false,
      }
    )
    .select()
    .single()

  if (error) throw new Error(`Failed to upsert customer ${phone}: ${error.message}`)
  return rowToCustomer(data)
}

/**
 * Save or update the customer's name.
 */
export async function updateCustomerName(
  phone: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ name, last_seen: new Date().toISOString() })
    .eq('phone', phone)

  if (error) throw new Error(`Failed to update customer name for ${phone}: ${error.message}`)
}

/**
 * Increment the booking count for a customer.
 */
export async function incrementBookingCount(phone: string): Promise<void> {
  const { error } = await supabase.rpc('increment_booking_count', { customer_phone: phone })
  if (error) throw new Error(`Failed to increment booking count for ${phone}: ${error.message}`)
}

/**
 * Increment the incident count for a customer (called on NOSHOW).
 */
export async function incrementIncidentCount(phone: string): Promise<void> {
  const { error } = await supabase.rpc('increment_incident_count', { customer_phone: phone })
  if (error) throw new Error(`Failed to increment incident count for ${phone}: ${error.message}`)
}

/**
 * Returns true if the customer has 2+ incidents in the last 30 days.
 */
export async function isRepeatOffender(phone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_repeat_offender', { p_customer_phone: phone })
  if (error) throw new Error(`Failed to check repeat offender for ${phone}: ${error.message}`)
  return data as boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToCustomer(row: Record<string, unknown>): CustomerRecord {
  return {
    phone: row.phone as string,
    name: row.name != null ? (row.name as string) : undefined,
    bookingCount: (row.booking_count as number) ?? 0,
    incidentCount: (row.incident_count as number) ?? 0,
    lastSeen: row.last_seen as string,
  }
}
