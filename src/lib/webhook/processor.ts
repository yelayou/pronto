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

/**
 * Process a single inbound WhatsApp message.
 *
 * @param params  Parsed Twilio form fields (From, Body, Latitude, Longitude, …)
 */
export async function processWebhookPayload(
  params: Record<string, string>
): Promise<void> {
  const from = params['From']
  const body = params['Body'] ?? ''
  const lat = params['Latitude'] ? parseFloat(params['Latitude']) : undefined
  const lng = params['Longitude'] ? parseFloat(params['Longitude']) : undefined

  // Require at least a sender; body may be empty for location pins
  if (!from) {
    console.warn('[processor] Missing From field — skipping')
    return
  }

  const dispatcherPhone = process.env.DISPATCHER_PHONE
  const isDispatcher =
    from === `whatsapp:${dispatcherPhone}` || from === dispatcherPhone

  if (isDispatcher) {
    const reply = await handleDispatcherMessage(body)
    await sendWhatsApp(from, reply)
  } else {
    const reply = await handleCustomerMessage(from, body, lat, lng)
    if (reply) {
      await sendWhatsApp(from, reply)
    }
  }
}
