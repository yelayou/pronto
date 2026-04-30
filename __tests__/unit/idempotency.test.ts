/**
 * Unit tests for message idempotency (PRT-33)
 *
 * Supabase client is mocked — no real DB calls are made.
 * We exercise the three branches of deduplicateMessage:
 *   1. Successful INSERT   → new message (returns false)
 *   2. Unique violation    → duplicate   (returns true)
 *   3. Unexpected DB error → allow through (returns false, logs error)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Supabase client ─────────────────────────────────────────────────────

const mockInsert = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: mockInsert,
    }),
  },
}))

import { deduplicateMessage } from '@/lib/supabase/idempotency'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_SID = 'SM1234567890abcdef1234567890abcdef'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deduplicateMessage', () => {
  it('returns false for a new MessageSid (successful insert)', async () => {
    mockInsert.mockResolvedValue({ error: null })

    const result = await deduplicateMessage(TEST_SID)

    expect(result).toBe(false)
    expect(mockInsert).toHaveBeenCalledOnce()
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ message_sid: TEST_SID })
    )
  })

  it('returns true for a duplicate MessageSid (unique violation)', async () => {
    mockInsert.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })

    const result = await deduplicateMessage(TEST_SID)

    expect(result).toBe(true)
  })

  it('returns false on unexpected DB error (fail open to avoid dropping bookings)', async () => {
    mockInsert.mockResolvedValue({
      error: { code: 'PGRST301', message: 'connection timeout' },
    })

    const result = await deduplicateMessage(TEST_SID)

    expect(result).toBe(false)
  })

  it('sets expires_at ~24 hours in the future', async () => {
    mockInsert.mockResolvedValue({ error: null })

    const before = Date.now()
    await deduplicateMessage(TEST_SID)
    const after = Date.now()

    const insertArg = mockInsert.mock.calls[0][0] as { expires_at: string }
    const expiresAt = new Date(insertArg.expires_at).getTime()

    const expectedMin = before + 23.9 * 60 * 60 * 1000
    const expectedMax = after  + 24.1 * 60 * 60 * 1000

    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin)
    expect(expiresAt).toBeLessThanOrEqual(expectedMax)
  })

  it('passes message_sid, processed_at, and expires_at to insert', async () => {
    mockInsert.mockResolvedValue({ error: null })

    await deduplicateMessage(TEST_SID)

    const insertArg = mockInsert.mock.calls[0][0] as Record<string, string>
    expect(insertArg).toHaveProperty('message_sid', TEST_SID)
    expect(insertArg).toHaveProperty('processed_at')
    expect(insertArg).toHaveProperty('expires_at')
  })
})
