import { NextRequest, NextResponse } from 'next/server'
import { verifyQStashSignature } from '@/lib/qstash/client'
import { processWebhookPayload } from '@/lib/webhook/processor'

/**
 * POST /api/worker
 *
 * Receives async webhook jobs delivered by Upstash QStash.
 * This route does the heavy lifting that used to happen inline in /api/webhook —
 * geocoding, route calculation, Supabase reads/writes, and Twilio replies.
 *
 * Security: QStash signs every delivery with a JWT. We verify it before processing.
 *
 * Retry behaviour:
 *   - Return 200 → QStash considers the job delivered (no retry)
 *   - Return 5xx → QStash retries with exponential back-off
 *   We return 200 in all cases for now (matching the original inline behaviour).
 *   Retriable errors (e.g. transient Supabase failures) can be opted in later.
 *
 * PRT-36: async webhook processing via QStash
 */
export async function POST(request: NextRequest) {
  // ── Verify QStash signature ──────────────────────────────────────────────────
  const signature = request.headers.get('upstash-signature') ?? ''
  const rawBody = await request.text()

  const isValid = await verifyQStashSignature(signature, rawBody)
  if (!isValid) {
    console.warn('[worker] Invalid QStash signature — request rejected')
    return new NextResponse('Forbidden', { status: 403 })
  }

  // ── Process the job ──────────────────────────────────────────────────────────
  try {
    const params = JSON.parse(rawBody) as Record<string, string>
    await processWebhookPayload(params)
  } catch (err) {
    // Log but return 200 — we don't want QStash to retry malformed payloads
    // or errors that are unlikely to resolve on retry (e.g. bad Twilio sends).
    console.error('[worker] Error processing job:', err)
  }

  return new NextResponse('OK', { status: 200 })
}
