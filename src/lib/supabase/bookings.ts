import { supabase } from './client'
import type { BookingRecord, BookingStatus, ServiceType, PaymentMethod, PackageSize } from '@/types'

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
    id: row.id as string,
    customerPhone: row.customer_phone as string,
    serviceType: row.service_type as ServiceType,
    pickupAddress: row.pickup_address as string,
    dropoffAddress: row.dropoff_address as string,
    pickupLat: row.pickup_lat != null ? (row.pickup_lat as number) : undefined,
    pickupLng: row.pickup_lng != null ? (row.pickup_lng as number) : undefined,
    dropoffLat: row.dropoff_lat != null ? (row.dropoff_lat as number) : undefined,
    dropoffLng: row.dropoff_lng != null ? (row.dropoff_lng as number) : undefined,
    fare: row.fare as number,
    fareBreakdown: row.fare_breakdown as BookingRecord['fareBreakdown'],
    status: row.status as BookingStatus,
    paymentMethod: row.payment_method as PaymentMethod,
    passengerCount: row.passenger_count != null ? (row.passenger_count as number) : undefined,
    packageSize: row.package_size != null ? (row.package_size as PackageSize) : undefined,
    fragile: (row.fragile as boolean) ?? false,
    recipientName: row.recipient_name != null ? (row.recipient_name as string) : undefined,
    notes: row.notes != null ? (row.notes as string) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}
