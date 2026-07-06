/**
 * Unit tests for optimistic locking on conversation_state (PRT-46).
 *
 * All tests mock the Supabase client — this is a unit test for the
 * version-conflict logic, not a DB integration test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Supabase client ─────────────────────────────────────────────────────

const { mockSelect, mockUpdate, mockEq, mockSingle, mockUpsert } = vi.hoisted(() => {
  const mockSelect = vi.fn()
  const mockUpdate = vi.fn()
  const mockUpsert = vi.fn()
  const mockEq = vi.fn()
  const mockSingle = vi.fn()

  const chain = { select: mockSelect, update: mockUpdate, upsert: mockUpsert, eq: mockEq, single: mockSingle }
  Object.values(chain).forEach(m => m.mockReturnValue(chain))

  return { mockSelect, mockUpdate, mockEq, mockSingle, mockUpsert }
})

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
      upsert: mockUpsert,
      eq: mockEq,
      single: mockSingle,
    }),
  },
}))

import { upsertConversationState, ConversationVersionError } from '@/lib/supabase/conversations'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const chain = { select: mockSelect, update: mockUpdate, upsert: mockUpsert, eq: mockEq, single: mockSingle }

const baseState = {
  customerPhone: 'whatsapp:+14165550001',
  stage: 'awaiting_service' as const,
  version: 3,
}

const dbRow = (overrides = {}) => ({
  customer_phone: 'whatsapp:+14165550001',
  stage: 'awaiting_service',
  version: 4,
  updated_at: new Date().toISOString(),
  expires_at: new Date().toISOString(),
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.values(chain).forEach(m => (m as ReturnType<typeof vi.fn>).mockReturnValue(chain))
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('upsertConversationState — versioned update', () => {
  it('succeeds when version matches and returns incremented version', async () => {
    mockSelect.mockResolvedValueOnce({ data: [dbRow()], error: null })

    const result = await upsertConversationState(baseState)
    expect(result.version).toBe(4)
  })

  it('throws ConversationVersionError when 0 rows updated (version mismatch)', async () => {
    mockSelect.mockResolvedValueOnce({ data: [], error: null })

    await expect(upsertConversationState(baseState)).rejects.toThrow(ConversationVersionError)
  })

  it('throws ConversationVersionError when data is null', async () => {
    mockSelect.mockResolvedValueOnce({ data: null, error: null })

    await expect(upsertConversationState(baseState)).rejects.toThrow(ConversationVersionError)
  })

  it('throws on DB error', async () => {
    mockSelect.mockResolvedValueOnce({ data: null, error: { message: 'connection timeout' } })

    await expect(upsertConversationState(baseState)).rejects.toThrow('connection timeout')
  })
})

describe('upsertConversationState — new conversation (no version)', () => {
  it('upserts with version=1 when no version is provided', async () => {
    const { version: _v, ...newState } = baseState
    mockSingle.mockResolvedValueOnce({ data: dbRow({ version: 1 }), error: null })

    const result = await upsertConversationState(newState)
    expect(result.version).toBe(1)
  })
})

describe('ConversationVersionError', () => {
  it('has the correct name, message, and is an Error', () => {
    const err = new ConversationVersionError('+14165550001')
    expect(err.name).toBe('ConversationVersionError')
    expect(err.message).toContain('+14165550001')
    expect(err).toBeInstanceOf(Error)
  })
})
