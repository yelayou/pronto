/**
 * Unit tests for NOSHOW incident logging and repeat offender flagging (PRT-25).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const {
  mockGetActiveBooking,
  mockUpdateBookingStatus,
  mockLogIncident,
  mockIncrementIncidentCount,
  mockResetConversation,
  mockSendWhatsApp,
} = vi.hoisted(() => ({
  mockGetActiveBooking: vi.fn(),
  mockUpdateBookingStatus: vi.fn().mockResolvedValue(undefined),
  mockLogIncident: vi.fn().mockResolvedValue(undefined),
  mockIncrementIncidentCount: vi.fn().mockResolvedValue(undefined),
  mockResetConversation: vi.fn().mockResolvedValue(undefined),
  mockSendWhatsApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase/bookings', () => ({
  getActiveBooking: mockGetActiveBooking,
  updateBookingStatus: mockUpdateBookingStatus,
  logIncident: mockLogIncident,
  getPendingBookings: vi.fn().mockResolvedValue([]),
  markAllUnnotifiedAsNotified: vi.fn(),
}))

vi.mock('@/lib/supabase/customers', () => ({
  incrementIncidentCount: mockIncrementIncidentCount,
  isRepeatOffender: vi.fn().mockResolvedValue(false),
  getCustomer: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/conversations', () => ({
  resetConversation: mockResetConversation,
}))

vi.mock('@/lib/supabase/dispatcher', () => ({
  setOnDuty: vi.fn(),
  setOffDuty: vi.fn(),
}))

vi.mock('@/lib/twilio/client', () => ({
  sendWhatsApp: mockSendWhatsApp,
}))

vi.mock('@/lib/config', () => ({
  ETRANSFER_LINK: 'payments@pronto.ca',
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

import { handleDispatcherMessage } from '@/lib/dispatcher/handler'

const mockBooking = {
  id: 'booking-uuid-noshow',
  queueNumber: 3,
  customerPhone: '+14165550001',
  serviceType: 'ride',
  pickupAddress: '123 Main St',
  dropoffAddress: '456 Elm St',
  fare: 25.09,
  fareBreakdown: {},
  status: 'confirmed',
  paymentMethod: 'cash',
  dispatcherNotified: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('NOSHOW handler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('increments incident count after logging the incident', async () => {
    mockGetActiveBooking.mockResolvedValue(mockBooking)

    await handleDispatcherMessage('NOSHOW')

    expect(mockLogIncident).toHaveBeenCalledWith(
      mockBooking.customerPhone,
      mockBooking.id,
      'noshow',
      5.00
    )
    expect(mockIncrementIncidentCount).toHaveBeenCalledWith(mockBooking.customerPhone)
  })

  it('sends fee notice containing the e-Transfer link', async () => {
    mockGetActiveBooking.mockResolvedValue(mockBooking)

    await handleDispatcherMessage('NOSHOW')

    const [, message] = mockSendWhatsApp.mock.calls[0]
    expect(message).toContain('payments@pronto.ca')
    expect(message).toContain('5.00')
  })

  it('returns error when no active booking exists', async () => {
    mockGetActiveBooking.mockResolvedValue(null)

    const reply = await handleDispatcherMessage('NOSHOW')

    expect(reply).toContain('No active booking found')
    expect(mockIncrementIncidentCount).not.toHaveBeenCalled()
  })

  it('resets conversation after NOSHOW', async () => {
    mockGetActiveBooking.mockResolvedValue(mockBooking)

    await handleDispatcherMessage('NOSHOW')

    expect(mockResetConversation).toHaveBeenCalledWith(mockBooking.customerPhone)
  })
})
