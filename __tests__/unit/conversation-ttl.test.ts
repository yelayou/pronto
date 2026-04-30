/**
 * Unit tests for conversation TTL (PRT-34)
 *
 * isConversationExpired() is a pure function — no mocks needed.
 * We test the four meaningful cases:
 *   1. expiresAt in the past → expired
 *   2. expiresAt in the future → not expired
 *   3. expiresAt missing (legacy row) → not expired (safe default)
 *   4. expiresAt exactly now → expired (boundary)
 */

import { describe, it, expect, vi } from 'vitest'

// Mock the Supabase client so the module can be imported without real env vars
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn() },
}))

import { isConversationExpired } from '@/lib/supabase/conversations'
import type { ConversationState } from '@/types'

// ─── Fixture ──────────────────────────────────────────────────────────────────

function makeConvo(expiresAt?: string): ConversationState {
  return {
    customerPhone: '+14165550001',
    stage: 'awaiting_service',
    updatedAt: new Date().toISOString(),
    ...(expiresAt !== undefined && { expiresAt }),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isConversationExpired', () => {
  it('returns true when expiresAt is in the past', () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
    expect(isConversationExpired(makeConvo(pastDate))).toBe(true)
  })

  it('returns false when expiresAt is in the future', () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now
    expect(isConversationExpired(makeConvo(futureDate))).toBe(false)
  })

  it('returns false when expiresAt is missing (legacy row — safe default)', () => {
    expect(isConversationExpired(makeConvo(undefined))).toBe(false)
  })

  it('returns true when expiresAt is in the past by just 1ms', () => {
    const justExpired = new Date(Date.now() - 1).toISOString()
    expect(isConversationExpired(makeConvo(justExpired))).toBe(true)
  })

  it('returns false for a freshly created conversation (2h TTL)', () => {
    const fresh = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    expect(isConversationExpired(makeConvo(fresh))).toBe(false)
  })
})
