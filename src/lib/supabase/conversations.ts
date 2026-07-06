import { supabase } from './client'
import type { ConversationState, ConversationStage, ServiceType, PackageSize, PaymentMethod, FareResult, PendingLandmark } from '@/types'

const TABLE = 'conversation_state'

/** TTL in hours — configurable via CONVERSATION_TTL_HOURS, default 2 */
function getTtlHours(): number {
  const raw = process.env.CONVERSATION_TTL_HOURS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return isNaN(parsed) || parsed <= 0 ? 2 : parsed
}

function nextExpiresAt(): string {
  return new Date(Date.now() + getTtlHours() * 60 * 60 * 1000).toISOString()
}

/**
 * Returns true if the conversation has expired and should be reset.
 * A missing expiresAt is treated as valid (legacy rows before PRT-34).
 */
export function isConversationExpired(state: ConversationState): boolean {
  if (!state.expiresAt) return false
  return new Date(state.expiresAt) < new Date()
}

/**
 * Thrown when a versioned write finds the DB version has already advanced —
 * meaning a concurrent write beat this one. Callers should drop the update.
 */
export class ConversationVersionError extends Error {
  constructor(phone: string) {
    super(`Conversation version conflict for ${phone} — concurrent write detected`)
    this.name = 'ConversationVersionError'
  }
}

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
 * Persist a conversation state update.
 *
 * When `state.version` is set (existing conversation), uses an optimistic-lock
 * UPDATE that only succeeds if the DB version matches. On mismatch (concurrent
 * write), throws ConversationVersionError — callers should drop the update.
 *
 * When `state.version` is undefined (new conversation), upserts with version=1.
 */
export async function upsertConversationState(
  state: Omit<ConversationState, 'updatedAt'>
): Promise<ConversationState> {
  const fields = stateToRow(state)

  if (state.version !== undefined) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ ...fields, version: state.version + 1 })
      .eq('customer_phone', state.customerPhone)
      .eq('version', state.version)
      .select()

    if (error) throw new Error(`Failed to update conversation for ${state.customerPhone}: ${error.message}`)
    if (!data || data.length === 0) throw new ConversationVersionError(state.customerPhone)
    return rowToState(data[0])
  }

  // New conversation — upsert with version=1
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ ...fields, version: 1 }, { onConflict: 'customer_phone' })
    .select()
    .single()

  if (error) throw new Error(`Failed to upsert conversation for ${state.customerPhone}: ${error.message}`)
  return rowToState(data)
}

/**
 * Advance just the stage of a conversation without touching other fields.
 * Requires the current version to guard against concurrent writes.
 */
export async function advanceStage(
  phone: string,
  stage: ConversationStage,
  currentVersion: number
): Promise<void> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ stage, version: currentVersion + 1, updated_at: new Date().toISOString() })
    .eq('customer_phone', phone)
    .eq('version', currentVersion)
    .select('version')

  if (error) throw new Error(`Failed to advance stage for ${phone}: ${error.message}`)
  if (!data || data.length === 0) throw new ConversationVersionError(phone)
}

/**
 * Reset a customer's conversation back to idle (e.g. after booking confirmed or timed out).
 * Always succeeds regardless of version — resets are considered authoritative.
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
        pickup_lat: null,
        pickup_lng: null,
        dropoff_address: null,
        dropoff_lat: null,
        dropoff_lng: null,
        passenger_count: null,
        package_size: null,
        fragile: null,
        recipient_name: null,
        notes: null,
        payment_method: null,
        fare_result: null,
        pending_landmark: null,
        expires_at: nextExpiresAt(),
        updated_at: new Date().toISOString(),
        version: 1,
      },
      { onConflict: 'customer_phone' }
    )

  if (error) throw new Error(`Failed to reset conversation for ${phone}: ${error.message}`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stateToRow(state: Omit<ConversationState, 'updatedAt'>): Record<string, unknown> {
  return {
    customer_phone: state.customerPhone,
    stage: state.stage,
    service_type: state.serviceType ?? null,
    pickup_address: state.pickupAddress ?? null,
    pickup_lat: state.pickupLat ?? null,
    pickup_lng: state.pickupLng ?? null,
    dropoff_address: state.dropoffAddress ?? null,
    dropoff_lat: state.dropoffLat ?? null,
    dropoff_lng: state.dropoffLng ?? null,
    passenger_count: state.passengerCount ?? null,
    package_size: state.packageSize ?? null,
    fragile: state.fragile ?? null,
    recipient_name: state.recipientName ?? null,
    notes: state.notes ?? null,
    payment_method: state.paymentMethod ?? null,
    fare_result: state.fareResult ?? null,
    pending_landmark: state.pendingLandmark ?? null,
    expires_at: nextExpiresAt(),
    updated_at: new Date().toISOString(),
  }
}

function rowToState(row: Record<string, unknown>): ConversationState {
  return {
    customerPhone: row.customer_phone as string,
    stage: row.stage as ConversationStage,
    serviceType: row.service_type != null ? (row.service_type as ServiceType) : undefined,
    pickupAddress: row.pickup_address != null ? (row.pickup_address as string) : undefined,
    pickupLat: row.pickup_lat != null ? (row.pickup_lat as number) : undefined,
    pickupLng: row.pickup_lng != null ? (row.pickup_lng as number) : undefined,
    dropoffAddress: row.dropoff_address != null ? (row.dropoff_address as string) : undefined,
    dropoffLat: row.dropoff_lat != null ? (row.dropoff_lat as number) : undefined,
    dropoffLng: row.dropoff_lng != null ? (row.dropoff_lng as number) : undefined,
    passengerCount: row.passenger_count != null ? (row.passenger_count as number) : undefined,
    packageSize: row.package_size != null ? (row.package_size as PackageSize) : undefined,
    fragile: row.fragile != null ? (row.fragile as boolean) : undefined,
    recipientName: row.recipient_name != null ? (row.recipient_name as string) : undefined,
    notes: row.notes != null ? (row.notes as string) : undefined,
    paymentMethod: row.payment_method != null ? (row.payment_method as PaymentMethod) : undefined,
    fareResult: row.fare_result != null ? (row.fare_result as FareResult) : undefined,
    pendingLandmark: row.pending_landmark != null ? (row.pending_landmark as PendingLandmark) : undefined,
    expiresAt: row.expires_at != null ? (row.expires_at as string) : undefined,
    updatedAt: row.updated_at as string,
    version: row.version != null ? (row.version as number) : undefined,
  }
}
