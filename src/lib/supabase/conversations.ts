import { supabase } from './client'
import type { ConversationState, ConversationStage, ServiceType, PackageSize, PaymentMethod, FareResult } from '@/types'

const TABLE = 'conversation_state'

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the current conversation state for a customer.
 * Returns null if the customer has no active conversation.
 */
export async function getConversationState(
  phone: string
): Promise<ConversationState | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('customer_phone', phone)
    .maybeSingle()

  if (error) throw new Error(`Failed to fetch conversation for ${phone}: ${error.message}`)
  return data ? rowToState(data) : null
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Upsert (create or replace) the full conversation state for a customer.
 */
export async function upsertConversationState(
  state: Omit<ConversationState, 'updatedAt'>
): Promise<ConversationState> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        customer_phone: state.customerPhone,
        stage: state.stage,
        service_type: state.serviceType ?? null,
        pickup_address: state.pickupAddress ?? null,
        dropoff_address: state.dropoffAddress ?? null,
        passenger_count: state.passengerCount ?? null,
        package_size: state.packageSize ?? null,
        fragile: state.fragile ?? null,
        recipient_name: state.recipientName ?? null,
        notes: state.notes ?? null,
        payment_method: state.paymentMethod ?? null,
        fare_result: state.fareResult ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_phone' }
    )
    .select()
    .single()

  if (error) throw new Error(`Failed to upsert conversation for ${state.customerPhone}: ${error.message}`)
  return rowToState(data)
}

/**
 * Advance just the stage of a conversation without touching other fields.
 */
export async function advanceStage(
  phone: string,
  stage: ConversationStage
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('customer_phone', phone)

  if (error) throw new Error(`Failed to advance stage for ${phone}: ${error.message}`)
}

/**
 * Reset a customer's conversation back to idle (e.g. after booking confirmed or timed out).
 */
export async function resetConversation(phone: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        customer_phone: phone,
        stage: 'idle',
        service_type: null,
        pickup_address: null,
        dropoff_address: null,
        passenger_count: null,
        package_size: null,
        fragile: null,
        recipient_name: null,
        notes: null,
        payment_method: null,
        fare_result: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_phone' }
    )

  if (error) throw new Error(`Failed to reset conversation for ${phone}: ${error.message}`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToState(row: Record<string, unknown>): ConversationState {
  return {
    customerPhone: row.customer_phone as string,
    stage: row.stage as ConversationStage,
    serviceType: row.service_type != null ? (row.service_type as ServiceType) : undefined,
    pickupAddress: row.pickup_address != null ? (row.pickup_address as string) : undefined,
    dropoffAddress: row.dropoff_address != null ? (row.dropoff_address as string) : undefined,
    passengerCount: row.passenger_count != null ? (row.passenger_count as number) : undefined,
    packageSize: row.package_size != null ? (row.package_size as PackageSize) : undefined,
    fragile: row.fragile != null ? (row.fragile as boolean) : undefined,
    recipientName: row.recipient_name != null ? (row.recipient_name as string) : undefined,
    notes: row.notes != null ? (row.notes as string) : undefined,
    paymentMethod: row.payment_method != null ? (row.payment_method as PaymentMethod) : undefined,
    fareResult: row.fare_result != null ? (row.fare_result as FareResult) : undefined,
    updatedAt: row.updated_at as string,
  }
}
