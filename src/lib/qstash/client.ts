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
import { logger } from '@/lib/logger'

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Returns true when QStash async processing is enabled (QSTASH_TOKEN is set).
 * Used by the webhook to decide between async and sync paths.
 */
export function isQStashEnabled(): boolean {
  return !!process.env.QSTASH_TOKEN
}

/**
 * Resolve the base URL QStash should deliver worker jobs to.
 *
 * Priority:
 *   1. APP_BASE_URL                   (explicit override — use for custom domains)
 *   2. VERCEL_PROJECT_PRODUCTION_URL  (stable domain, production-target deploys only)
 *   3. VERCEL_URL                     (per-deployment URL — last resort; Vercel
 *                                      Deployment Protection usually blocks it, PRT-76)
 *   4. http://localhost:3000          (only reached if QSTASH_TOKEN is set locally)
 */
export function resolveWorkerBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, '')

  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }

  if (process.env.VERCEL_URL) {
    logger.warn('APP_BASE_URL not set — QStash will call the per-deployment VERCEL_URL, which Deployment Protection may block')
    return `https://${process.env.VERCEL_URL}`
  }

  return 'http://localhost:3000'
}

/**
 * QStash flow-control key for a sender. Jobs sharing a key run one at a time,
 * so a customer's messages are processed in order instead of racing on the
 * conversation_state optimistic lock (PRT-46). Keys are restricted to
 * alphanumerics, hyphen, underscore, and period.
 */
export function flowControlKeyFor(from: string): string {
  return `sender-${from.replace(/[^A-Za-z0-9._-]/g, '')}`
}

/**
 * Publish a parsed Twilio webhook payload to QStash.
 * QStash will POST it to /api/worker (see resolveWorkerBaseUrl).
 * Throws on failure — the caller is expected to fall back to inline processing.
 */
export async function enqueueWebhookJob(
  params: Record<string, string>
): Promise<void> {
  const token = process.env.QSTASH_TOKEN
  if (!token) throw new Error('[qstash] QSTASH_TOKEN is not set')

  const workerUrl = `${resolveWorkerBaseUrl()}/api/worker`

  const client = new Client({ token })
  await client.publishJSON({
    url: workerUrl,
    body: params,
    flowControl: { key: flowControlKeyFor(params['From'] ?? 'unknown'), parallelism: 1 },
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
    logger.warn('QStash signing keys not set — rejecting worker request')
    return false
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey })

  try {
    return await receiver.verify({ signature, body: rawBody })
  } catch (err) {
    logger.warn('QStash signature verification failed', {}, err)
    return false
  }
}
