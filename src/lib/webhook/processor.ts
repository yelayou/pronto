/**
 * Pronto — Webhook payload processor
 *
 * Shared dispatch logic called by both:
 *   POST /api/worker   — async path (QStash-delivered)
 *   POST /api/webhook  — sync fallback (local dev, QSTASH_TOKEN not set)
 *
 * Receives a parsed Twilio form payload, routes to the correct handler,
 * and sends the reply via WhatsApp.
 */

import { handleDispatcherMessage } from '@/lib/dispatcher/handler'
import { handleCustomerMessage } from '@/lib/customer/handler'
import { sendWhatsApp } from '@/lib/twilio/client'
import { deduplicateMessage } from '@/lib/supabase/idempotency'
import { checkRateLimit } from '@/lib/ratelimit'
import { TwilioWebhookSchema, sanitizePhone } from '@/lib/validation/schemas'
import { ConversationVersionError } from '@/lib/supabase/conversations'

/**
 * Process a single inbound WhatsApp message.
 *
 * @param params  Parsed Twilio form fields (From, Body, Latitude, Longitude, …)
 */
export async function processWebhookPayload(
  params: Record<string, string>
): Promise<void> {
  const parsed = TwilioWebhookSchema.safeParse(params)
  if (!parsed.success) {
    console.warn('[processor] Invalid webhook payload — skipping', {
      issues: parsed.error.issues.map(i => i.message),
      from: sanitizePhone(params['From'] ?? ''),
    })
    return
  }

  const { From: from, Body: body, MessageSid: messageSid, Latitude, Longitude } = parsed.data
  const lat = Latitude ? parseFloat(Latitude) : undefined
  const lng = Longitude ? parseFloat(Longitude) : undefined

  const dispatcherPhone = process.env.DISPATCHER_PHONE
  const isDispatcher =
    from === `whatsapp:${dispatcherPhone}` || from === dispatcherPhone

  // Rate-limit customer messages (PRT-42). Dispatcher is exempt.
  if (!isDispatcher) {
    const { limited, shouldNotify } = await checkRateLimit(from)
    if (limited) {
      if (shouldNotify) {
        await sendWhatsApp(from, 'Please slow down — send one message at a time 🙏')
      }
      console.info(`[processor] Rate limit hit for ${from.slice(-4)}`)
      return
    }
  }

  // Deduplicate customer messages using Twilio MessageSid (PRT-33).
  // Dispatcher commands are short, idempotent by nature, and not at risk of
  // creating duplicate bookings — no dedup needed on that path.
  if (!isDispatcher && messageSid) {
    const isDuplicate = await deduplicateMessage(messageSid)
    if (isDuplicate) return
  }

  if (isDispatcher) {
    const reply = await handleDispatcherMessage(body)
    await sendWhatsApp(from, reply)
  } else {
    try {
      const reply = await handleCustomerMessage(from, body, lat, lng)
      if (reply) {
        await sendWhatsApp(from, reply)
      }
    } catch (err) {
      if (err instanceof ConversationVersionError) {
        console.warn('[processor] Concurrent write detected — dropping duplicate message', {
          phone: sanitizePhone(from),
          error: err.message,
        })
        return
      }
      throw err
    }
  }
}
