/**
 * Unit tests for the QStash client and webhook enqueue fallback (PRT-76)
 *
 * Covers:
 *   - Worker URL resolution priority (APP_BASE_URL → production domain → VERCEL_URL → localhost)
 *   - Flow-control key is per-sender and contains only allowed characters
 *   - enqueueWebhookJob publishes with parallelism 1 keyed on the sender
 *   - Webhook processes inline when enqueue fails
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const publishJSON = vi.fn()
vi.mock('@upstash/qstash', () => ({
  Client: class { publishJSON = publishJSON },
  Receiver: class {},
}))

vi.mock('@/lib/twilio/client', () => ({
  validateTwilioSignature: vi.fn(() => true),
}))

const processWebhookPayload = vi.fn()
vi.mock('@/lib/webhook/processor', () => ({
  processWebhookPayload: (...args: unknown[]) => processWebhookPayload(...args),
}))

import { resolveWorkerBaseUrl, flowControlKeyFor, enqueueWebhookJob } from '@/lib/qstash/client'

const ENV_KEYS = ['APP_BASE_URL', 'VERCEL_ENV', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'QSTASH_TOKEN']
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  ENV_KEYS.forEach(k => delete process.env[k])
  publishJSON.mockReset()
  processWebhookPayload.mockReset()
})

afterEach(() => {
  ENV_KEYS.forEach(k => {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  })
})

describe('resolveWorkerBaseUrl', () => {
  it('prefers APP_BASE_URL and strips trailing slashes', () => {
    process.env.APP_BASE_URL = 'https://pronto.example.com/'
    process.env.VERCEL_URL = 'pronto-abc123.vercel.app'
    expect(resolveWorkerBaseUrl()).toBe('https://pronto.example.com')
  })

  it('uses the stable production domain on production-target deploys', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pronto-nine-gilt.vercel.app'
    process.env.VERCEL_URL = 'pronto-abc123.vercel.app'
    expect(resolveWorkerBaseUrl()).toBe('https://pronto-nine-gilt.vercel.app')
  })

  it('does not use the production domain on preview deploys', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pronto-nine-gilt.vercel.app'
    process.env.VERCEL_URL = 'pronto-abc123.vercel.app'
    expect(resolveWorkerBaseUrl()).toBe('https://pronto-abc123.vercel.app')
  })

  it('falls back to localhost when nothing is set', () => {
    expect(resolveWorkerBaseUrl()).toBe('http://localhost:3000')
  })
})

describe('flowControlKeyFor', () => {
  it('strips characters QStash does not allow', () => {
    expect(flowControlKeyFor('whatsapp:+14165550001')).toBe('sender-whatsapp14165550001')
  })

  it('gives different senders different keys', () => {
    expect(flowControlKeyFor('whatsapp:+14165550001')).not.toBe(flowControlKeyFor('whatsapp:+14165550002'))
  })
})

describe('enqueueWebhookJob', () => {
  it('publishes to the worker with per-sender parallelism of 1', async () => {
    process.env.QSTASH_TOKEN = 'test-token'
    process.env.APP_BASE_URL = 'https://pronto.example.com'
    const params = { From: 'whatsapp:+14165550001', Body: 'hi', MessageSid: 'SM1' }

    await enqueueWebhookJob(params)

    expect(publishJSON).toHaveBeenCalledWith({
      url: 'https://pronto.example.com/api/worker',
      body: params,
      flowControl: { key: 'sender-whatsapp14165550001', parallelism: 1 },
    })
  })

  it('throws when QSTASH_TOKEN is missing', async () => {
    await expect(enqueueWebhookJob({ From: 'x' })).rejects.toThrow('QSTASH_TOKEN')
  })
})

describe('POST /api/webhook — enqueue fallback', () => {
  function twilioRequest() {
    const body = new URLSearchParams({ From: 'whatsapp:+14165550001', Body: 'hi', MessageSid: 'SM1' })
    return new Request('https://pronto.example.com/api/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'sig' },
      body,
    })
  }

  it('enqueues and does not process inline when QStash succeeds', async () => {
    process.env.QSTASH_TOKEN = 'test-token'
    const { POST } = await import('@/app/api/webhook/route')

    const res = await POST(twilioRequest() as never)

    expect(res.status).toBe(200)
    expect(publishJSON).toHaveBeenCalledOnce()
    expect(processWebhookPayload).not.toHaveBeenCalled()
  })

  it('processes inline when enqueue fails', async () => {
    process.env.QSTASH_TOKEN = 'test-token'
    publishJSON.mockRejectedValueOnce(new Error('QStash down'))
    const { POST } = await import('@/app/api/webhook/route')

    const res = await POST(twilioRequest() as never)

    expect(res.status).toBe(200)
    expect(processWebhookPayload).toHaveBeenCalledWith(
      expect.objectContaining({ From: 'whatsapp:+14165550001', MessageSid: 'SM1' })
    )
  })
})
