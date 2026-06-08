/**
 * Pronto — Per-phone rate limiting (PRT-42)
 *
 * Enforces two limits on inbound customer messages:
 *   - Throttle : max 1 message per 2 seconds  (prevents rapid-fire spam)
 *   - Burst    : max 20 messages per 10 minutes (prevents sustained flooding)
 *
 * When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set the limits
 * are backed by Upstash Redis and coordinate across all serverless instances.
 * Without those vars (local dev / CI) an in-process Map is used instead.
 *
 * A throttle reply ("Please slow down…") is sent at most once per 60 seconds
 * per phone to avoid reply-spamming a misbehaving client.
 *
 * The dispatcher phone is exempt — callers must check before calling this.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export type RateLimitResult = {
  limited: boolean
  shouldNotify: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const THROTTLE_MAX = 1
const THROTTLE_WINDOW_MS = 2_000
const BURST_MAX = 20
const BURST_WINDOW_MS = 10 * 60_000
const NOTIFY_COOLDOWN_MS = 60_000

// ── In-memory store (local dev / test) ───────────────────────────────────────

type PhoneState = {
  throttleTs: number[]
  burstTs: number[]
  lastNotifyAt: number
}

const memStore = new Map<string, PhoneState>()

export function _clearMemStoreForTesting(): void {
  memStore.clear()
}

function checkInMemory(phone: string, now = Date.now()): RateLimitResult {
  const s: PhoneState = memStore.get(phone) ?? {
    throttleTs: [],
    burstTs: [],
    lastNotifyAt: 0,
  }

  s.throttleTs = s.throttleTs.filter(t => now - t < THROTTLE_WINDOW_MS)
  s.burstTs = s.burstTs.filter(t => now - t < BURST_WINDOW_MS)

  const limited =
    s.throttleTs.length >= THROTTLE_MAX || s.burstTs.length >= BURST_MAX

  if (limited) {
    const shouldNotify = now - s.lastNotifyAt >= NOTIFY_COOLDOWN_MS
    if (shouldNotify) s.lastNotifyAt = now
    memStore.set(phone, s)
    return { limited: true, shouldNotify }
  }

  s.throttleTs.push(now)
  s.burstTs.push(now)
  memStore.set(phone, s)
  return { limited: false, shouldNotify: false }
}

// ── Redis-backed implementation ───────────────────────────────────────────────

let _redisCheck: ((phone: string) => Promise<RateLimitResult>) | null = null

function buildRedisCheck(): (phone: string) => Promise<RateLimitResult> {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })

  const throttler = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(THROTTLE_MAX, '2 s'),
    prefix: 'pronto:rl:throttle',
  })

  const burster = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(BURST_MAX, '10 m'),
    prefix: 'pronto:rl:burst',
  })

  const NOTIFY_PREFIX = 'pronto:rl:notify:'

  return async (phone: string): Promise<RateLimitResult> => {
    const { success: throttleOk } = await throttler.limit(phone)
    if (!throttleOk) {
      const set = await redis.set(`${NOTIFY_PREFIX}${phone}`, '1', {
        ex: NOTIFY_COOLDOWN_MS / 1000,
        nx: true,
      })
      return { limited: true, shouldNotify: set === 'OK' }
    }

    const { success: burstOk } = await burster.limit(phone)
    if (!burstOk) {
      const set = await redis.set(`${NOTIFY_PREFIX}${phone}`, '1', {
        ex: NOTIFY_COOLDOWN_MS / 1000,
        nx: true,
      })
      return { limited: true, shouldNotify: set === 'OK' }
    }

    return { limited: false, shouldNotify: false }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function checkRateLimit(phone: string): Promise<RateLimitResult> {
  const redisConfigured =
    !!process.env.UPSTASH_REDIS_REST_URL &&
    !!process.env.UPSTASH_REDIS_REST_TOKEN

  if (redisConfigured) {
    if (!_redisCheck) _redisCheck = buildRedisCheck()
    return _redisCheck(phone)
  }

  return checkInMemory(phone)
}
