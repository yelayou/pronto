import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioSignature } from '@/lib/twilio/client'
import { isQStashEnabled, enqueueWebhookJob } from '@/lib/qstash/client'
import { processWebhookPayload } from '@/lib/webhook/processor'
import { logger } from '@/lib/logger'

/**
 * POST /api/webhook
 *
 * Receives all inbound WhatsApp messages from Twilio.
 *
 * Fast path (QSTASH_TOKEN set — staging/production):
 *   1. Validate Twilio signature
 *   2. Serialise form payload
 *   3. Enqueue job to QStash → returns 200 in <200ms
 *   4. Processing happens asynchronously in POST /api/worker
 *   If enqueue fails, falls back to inline processing (PRT-76)
 *
 * Sync fallback (QSTASH_TOKEN not set — local dev):
 *   1–2 same, then process inline before returning 200
 *
 * PRT-36: async webhook via QStash
 * PRT-59: use request.url directly (avoids fragile host-header reconstruction)
 * PRT-76: inline fallback when enqueue fails
 */
export async function POST(request: NextRequest) {
  // ── Validate Twilio signature ────────────────────────────────────────────────
  const signature = request.headers.get('x-twilio-signature') ?? ''

  // Use request.url directly — reconstructing from host header is fragile (PRT-59)
  const url = request.url

  const formData = await request.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => { params[key] = value.toString() })

  if (!validateTwilioSignature(signature, url, params)) {
    logger.warn('Invalid Twilio signature — request rejected', { url })
    return new NextResponse('Forbidden', { status: 403 })
  }

  // ── Enqueue or process synchronously ────────────────────────────────────────
  if (isQStashEnabled()) {
    // Async path: publish to QStash and return 200 immediately.
    // Processing will happen in POST /api/worker once QStash delivers the job.
    try {
      await enqueueWebhookJob(params)
    } catch (err) {
      // Enqueue failed (QStash outage, bad token) — process inline rather than
      // dropping the message. Risks Twilio's timeout, but beats silence (PRT-76).
      logger.error('Failed to enqueue job — processing inline', {}, err)
      try {
        await processWebhookPayload(params)
      } catch (inlineErr) {
        logger.error('Error processing message', {}, inlineErr)
      }
    }
  } else {
    // Sync fallback for local dev (QSTASH_TOKEN not set).
    // Mirrors the old inline behaviour — safe for low-latency calls but risks
    // hitting Twilio's 15s timeout on slow Maps API responses in production.
    try {
      await processWebhookPayload(params)
    } catch (err) {
      logger.error('Error processing message', {}, err)
    }
  }

  // Twilio expects a 200 with TwiML (even if empty)
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    }
  )
}
