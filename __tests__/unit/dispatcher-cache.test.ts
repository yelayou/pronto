/**
 * Unit tests for dispatcher state in-memory cache (PRT-37).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSingle = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      single: mockSingle,
    }),
  },
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const onDutyRow = {
  duty_status: 'on',
  current_zone: 'Islington',
  current_lat: 43.65,
  current_lng: -79.52,
  updated_at: new Date().toISOString(),
}

const offDutyRow = {
  duty_status: 'off',
  current_zone: null,
  current_lat: null,
  current_lng: null,
  updated_at: new Date().toISOString(),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Re-import fresh module for each test to reset module-level cache
describe('dispatcher state cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('hits the DB on first call', async () => {
    mockSingle.mockResolvedValueOnce({ data: onDutyRow, error: null })
    const { getDispatcherState } = await import('@/lib/supabase/dispatcher')

    await getDispatcherState()

    expect(mockSingle).toHaveBeenCalledTimes(1)
  })

  it('returns cached value on second call without hitting DB', async () => {
    mockSingle.mockResolvedValueOnce({ data: onDutyRow, error: null })
    const { getDispatcherState } = await import('@/lib/supabase/dispatcher')

    await getDispatcherState()
    await getDispatcherState()

    expect(mockSingle).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after TTL expires', async () => {
    vi.useFakeTimers()
    mockSingle
      .mockResolvedValueOnce({ data: onDutyRow, error: null })
      .mockResolvedValueOnce({ data: onDutyRow, error: null })
    const { getDispatcherState } = await import('@/lib/supabase/dispatcher')

    await getDispatcherState()
    vi.advanceTimersByTime(31_000) // past default 30s TTL
    await getDispatcherState()

    expect(mockSingle).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('warms cache after setOnDuty — next read skips DB', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: onDutyRow, error: null }) // setOnDuty upsert
    const { getDispatcherState, setOnDuty } = await import('@/lib/supabase/dispatcher')

    await setOnDuty('Islington')
    await getDispatcherState()

    expect(mockSingle).toHaveBeenCalledTimes(1)
  })

  it('warms cache after setOffDuty — next read skips DB', async () => {
    mockSingle
      .mockResolvedValueOnce({ data: offDutyRow, error: null }) // setOffDuty upsert
    const { getDispatcherState, setOffDuty } = await import('@/lib/supabase/dispatcher')

    await setOffDuty()
    await getDispatcherState()

    expect(mockSingle).toHaveBeenCalledTimes(1)
  })
})
