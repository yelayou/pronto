/**
 * Pronto — Message idempotency (PRT-33)
 *
 * Prevents duplicate processing when Twilio or QStash retries a webhook
 * delivery. The strategy is an atomic INSERT: if it succeeds the message is
 * new; if it fails with a unique violation the message is a duplicate.
 *
 * This avoids the TOCTOU race of a separate SELECT-then-INSERT approach —
 * two concurrent retries of the same MessageSid will race on the INSERT and
 * only one will win.
 */

import { supabase } from './client'

const TABLE = 'processed_messages'
const TTL_HOURS = 24

/**
 * Attempt to claim a MessageSid for processing.
 *
 * Returns `true`  → already processed; caller should return 200 silently.
 * Returns `false` → new message; caller should proceed with processing.
 *
 * On unexpected Supabase errors the function returns `false` (allow through)
 * rather than dropping a real booking — a false negative is safer than a
 * false positive here.
 */
export async function deduplicateMessage(messageSid: string): Promise<boolean> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000)

  const { error } = await supabase.from(TABLE).insert({
    message_sid:  messageSid,
    processed_at: now.toISOString(),
    expires_at:   expiresAt.toISOString(),
  })

  if (!error) {
    // Successful insert — this is a new message
    return false
  }

  if (error.code === '23505') {
    // Unique violation — MessageSid already exists → duplicate
    console.info(`[idempotency] Duplicate message ${messageSid} — skipping`)
    return true
  }

  // Unexpected error — log and allow through to avoid silently dropping bookings
  console.error(`[idempotency] Failed to insert MessageSid ${messageSid}:`, error.message)
  return false
}
