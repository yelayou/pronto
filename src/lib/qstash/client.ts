/**
 * Pronto — Upstash QStash client
 *
 * Provides two operations:
 *   enqueueWebhookJob()      — publish a parsed Twilio payload to QStash for async processing
 *   verifyQStashSignature()  — validate the `upstash-signature` header on incoming worker requests
 *
 * When QSTASH_TOKEN is not set (local dev), the webhook falls back to synchronous processing
 * and these functions are never called.
 */

import { Client, Receiver } from '@upstash/qstash'

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Returns true when QStash async processing is enabled (QSTASH_TOKEN is set).
 * Used by the webhook to decide between async and sync paths.
 */
export function isQStashEnabled(): boolean {
  return !!process.env.QSTASH_TOKEN
}

/**
 * Publish a parsed Twilio webhook payload to QStash.
 * QStash will POST it to /api/worker on the same deployment.
 *
 * Worker URL priority:
 *   1. APP_BASE_URL env var  (explicit override — use for custom domains)
 *   2. VERCEL_URL env var    (set automatically on every Vercel deployment)
 *   3. http://localhost:3000 (fallback — only reached if QSTASH_TOKEN is set locally)
 */
export async function enqueueWebhookJob(
  params: Record<string, string>
): Promise<void> {
  const token = process.env.QSTASH_TOKEN
  if (!token) throw new Error('[qstash] QSTASH_TOKEN is not set')

  const baseUrl =
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  const workerUrl = `${baseUrl}/api/worker`

  const client = new Client({ token })
  await client.publishJSON({
    url: workerUrl,
    body: params,
  })
}

// ─── Verify QStash signature ──────────────────────────────────────────────────

/**
 * Verify the `upstash-signature` header on an incoming worker request.
 *
 * Returns false (and logs a warning) if signing keys are not configured —
 * this prevents accidental open endpoints in environments where QStash is
 * enabled but keys were not set.
 */
export async function verifyQStashSignature(
  signature: string,
  rawBody: string
): Promise<boolean> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

  if (!currentSigningKey || !nextSigningKey) {
    console.warn('[qstash] QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY not set — rejecting worker request')
    return false
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey })

  try {
    return await receiver.verify({ signature, body: rawBody })
  } catch (err) {
    console.warn('[qstash] Signature verification failed:', err)
    return false
  }
}
