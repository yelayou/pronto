import { supabase } from './client'
import type { BookingRecord, BookingStatus } from '@/types'

const TABLE = 'bookings'

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch a booking by its ID.
 */
export async function getBookingById(id: string): Promise<BookingRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to fetch booking ${id}: ${error.message}`)
  }

  return rowToBooking(data)
}

/**
 * Find the most recent active booking (confirmed or arrived).
 * Used by ARRIVED, COMPLETE, NOSHOW commands which operate on the current trip.
 */
export async function getActiveBooking(): Promise<BookingRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .in('status', ['confirmed', 'en_route', 'arrived'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to fetch active booking: ${error.message}`)
  return data ? rowToBooking(data) : null
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update booking status and touch updated_at.
 */
export async function updateBookingStatus(
  id: string,
  status: BookingStatus
): Promise<BookingRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update booking ${id}: ${error.message}`)
  return rowToBooking(data)
}

// ─── Incidents ────────────────────────────────────────────────────────────────

/**
 * Log a no-show or cancellation incident.
 */
export async function logIncident(
  customerPhone: string,
  bookingId: string,
  type: 'noshow' | 'cancel',
  feeAmount: number
): Promise<void> {
  const { error } = await supabase
    .from('incidents')
    .insert({
      customer_phone: customerPhone,
      booking_id: bookingId,
      type,
      fee_amount: feeAmount,
    })

  if (error) throw new Error(`Failed to log incident: ${error.message}`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToBooking(row: Record<string, unknown>): BookingRecord {
  return {
    id: row.id,
    customerPhone: row.customer_phone,
    serviceType: row.service_type,
    pickupAddress: row.pickup_address,
    dropoffAddress: row.dropoff_address,
    pickupLat: row.pickup_lat ?? undefined,
    pickupLng: row.pickup_lng ?? undefined,
    dropoffLat: row.dropoff_lat ?? undefined,
    dropoffLng: row.dropoff_lng ?? undefined,
    fare: row.fare,
    fareBreakdown: row.fare_breakdown,
    status: row.status,
    paymentMethod: row.payment_method,
    passengerCount: row.passenger_count ?? undefined,
    packageSize: row.package_size ?? undefined,
    fragile: row.fragile ?? false,
    recipientName: row.recipient_name ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
