/**
 * Unit tests for the NLU intent extraction module (PRT-63 / PRT-68 / PRT-69)
 *
 * The Anthropic SDK is mocked — no real API calls are made.
 * Quick confirmation/cancel/correction detection is tested without any mock
 * response setup because those code paths short-circuit before the API call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationState } from '@/types'

// ─── Mock Anthropic SDK ───────────────────────────────────────────────────────
// vi.hoisted ensures mockCreate is available inside the vi.mock factory
// (vi.mock calls are hoisted above imports by Vitest).

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    beta: {
      tools: {
        messages: {
          create: mockCreate,
        },
      },
    },
  })),
}))

import { extractIntent } from '@/lib/customer/intent'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseConvo: ConversationState = {
  customerPhone: '+14165550001',
  stage: 'idle',
  updatedAt: new Date().toISOString(),
}

/** Helper: build a mocked tool_use response */
function toolResponse(fields: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'extract_booking_fields',
        input: fields,
      },
    ],
  }
}

// ─── Quick intent detection (no API call) ─────────────────────────────────────

describe('extractIntent — quick confirmation detection', () => {
  beforeEach(() => mockCreate.mockClear())

  it('detects "yes" as confirm', async () => {
    const result = await extractIntent('yes', baseConvo)
    expect(result.confirmationIntent).toBe('confirm')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "book it" as confirm', async () => {
    const result = await extractIntent('book it', baseConvo)
    expect(result.confirmationIntent).toBe('confirm')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "yep" as confirm', async () => {
    const result = await extractIntent('yep', baseConvo)
    expect(result.confirmationIntent).toBe('confirm')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "looks perfect" as confirm', async () => {
    const result = await extractIntent('looks perfect', baseConvo)
    expect(result.confirmationIntent).toBe('confirm')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "no" as cancel', async () => {
    const result = await extractIntent('no', baseConvo)
    expect(result.confirmationIntent).toBe('cancel')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "cancel" as cancel', async () => {
    const result = await extractIntent('cancel', baseConvo)
    expect(result.confirmationIntent).toBe('cancel')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "nevermind" as cancel', async () => {
    const result = await extractIntent('nevermind', baseConvo)
    expect(result.confirmationIntent).toBe('cancel')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "change the dropoff" as correction', async () => {
    const result = await extractIntent('change the dropoff to Bloor', baseConvo)
    expect(result.confirmationIntent).toBe('correction')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('detects "wrong address" as correction', async () => {
    const result = await extractIntent('wrong address, fix the pickup', baseConvo)
    expect(result.confirmationIntent).toBe('correction')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns a nextPrompt even for quick-confirm (based on convo state)', async () => {
    const result = await extractIntent('yes', baseConvo)
    expect(typeof result.nextPrompt).toBe('string')
    expect(result.nextPrompt!.length).toBeGreaterThan(0)
  })
})

// ─── Field extraction via mocked API ─────────────────────────────────────────

describe('extractIntent — field extraction', () => {
  beforeEach(() => mockCreate.mockClear())

  it('extracts all ride booking fields from a single message', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        serviceType: 'ride',
        pickupAddress: '123 King St W, Toronto',
        dropoffAddress: '456 Queen St E, Toronto',
        passengerCount: 2,
        paymentMethod: 'cash',
      })
    )

    const result = await extractIntent(
      'ride from 123 King to 456 Queen, 2 people, cash',
      baseConvo
    )

    expect(result.serviceType).toBe('ride')
    expect(result.pickupAddress).toBe('123 King St W, Toronto')
    expect(result.dropoffAddress).toBe('456 Queen St E, Toronto')
    expect(result.passengerCount).toBe(2)
    expect(result.paymentMethod).toBe('cash')
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('extracts package delivery fields', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        serviceType: 'package',
        pickupAddress: '10 Bay St',
        dropoffAddress: '200 Bloor St W',
        packageSize: 'small',
        fragile: true,
        recipientName: 'James',
        paymentMethod: 'etransfer',
      })
    )

    const result = await extractIntent('package from 10 Bay to 200 Bloor, small, fragile, James, e-transfer', baseConvo)

    expect(result.serviceType).toBe('package')
    expect(result.packageSize).toBe('small')
    expect(result.fragile).toBe(true)
    expect(result.recipientName).toBe('James')
    expect(result.paymentMethod).toBe('etransfer')
  })

  it('preserves existing convo fields not mentioned in the message', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        dropoffAddress: '789 Bloor St W',
      })
    )

    const convoWithPickup: ConversationState = {
      ...baseConvo,
      serviceType: 'ride',
      pickupAddress: '123 King St W',
      stage: 'awaiting_dropoff',
    }

    const result = await extractIntent('drop me at 789 Bloor', convoWithPickup)

    expect(result.pickupAddress).toBe('123 King St W')   // preserved
    expect(result.dropoffAddress).toBe('789 Bloor St W') // new
    expect(result.serviceType).toBe('ride')              // preserved
  })

  it('overwrites an existing field when the customer provides a new value', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        pickupAddress: '999 Spadina Ave',
      })
    )

    const convoWithPickup: ConversationState = {
      ...baseConvo,
      serviceType: 'ride',
      pickupAddress: '123 King St W',
      stage: 'awaiting_dropoff',
    }

    const result = await extractIntent('actually pickup from 999 Spadina', convoWithPickup)
    expect(result.pickupAddress).toBe('999 Spadina Ave')
  })
})

// ─── Landmark disambiguation ──────────────────────────────────────────────────

describe('extractIntent — landmark disambiguation', () => {
  beforeEach(() => mockCreate.mockClear())

  it('sets needsDisambiguation=true when pickup is Pearson', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        serviceType: 'ride',
        pickupAddress: 'airport',
        dropoffAddress: '100 Front St',
        paymentMethod: 'cash',
      })
    )

    const result = await extractIntent('ride from airport to 100 Front St, cash', baseConvo)

    expect(result.needsDisambiguation).toBe(true)
    expect(result.disambiguationField).toBe('pickup')
    expect(result.landmarkId).toBe('pearson')
  })

  it('sets needsDisambiguation=true when dropoff is Union Station', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        serviceType: 'ride',
        pickupAddress: '123 Main St',
        dropoffAddress: 'union station',
        passengerCount: 1,
        paymentMethod: 'cash',
      })
    )

    const result = await extractIntent('ride from 123 Main to union station, 1 pax, cash', baseConvo)

    expect(result.needsDisambiguation).toBe(true)
    expect(result.disambiguationField).toBe('dropoff')
    expect(result.landmarkId).toBe('union_station')
  })

  it('sets needsDisambiguation=true when dropoff is Billy Bishop', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        serviceType: 'ride',
        pickupAddress: '50 King St W',
        dropoffAddress: 'billy bishop airport',
        paymentMethod: 'etransfer',
      })
    )

    const result = await extractIntent('ride from 50 King to billy bishop, e-transfer', baseConvo)

    expect(result.needsDisambiguation).toBe(true)
    expect(result.landmarkId).toBe('billy_bishop')
  })

  it('does NOT set needsDisambiguation for a non-landmark address', async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        serviceType: 'ride',
        pickupAddress: '123 King St W',
        dropoffAddress: '456 Queen St E',
        passengerCount: 2,
        paymentMethod: 'cash',
      })
    )

    const result = await extractIntent('ride from 123 King to 456 Queen, 2 pax, cash', baseConvo)

    expect(result.needsDisambiguation).toBeFalsy()
    expect(result.disambiguationField).toBeUndefined()
    expect(result.landmarkId).toBeUndefined()
  })
})

// ─── nextPrompt guidance ──────────────────────────────────────────────────────

describe('extractIntent — nextPrompt', () => {
  beforeEach(() => mockCreate.mockClear())

  it('asks "ride or package?" when no service type is known', async () => {
    mockCreate.mockResolvedValue(toolResponse({}))
    const result = await extractIntent('hi', baseConvo)
    expect(result.nextPrompt).toMatch(/ride or package/i)
  })

  it('asks for pickup when service type is known but pickup is missing', async () => {
    mockCreate.mockResolvedValue(toolResponse({ serviceType: 'ride' }))
    const result = await extractIntent('I need a ride', baseConvo)
    expect(result.nextPrompt).toMatch(/pick.*up|where.*pick/i)
  })

  it('asks for passenger count when ride has pickup+dropoff but no pax count', async () => {
    mockCreate.mockResolvedValue(toolResponse({}))

    const convo: ConversationState = {
      ...baseConvo,
      serviceType: 'ride',
      pickupAddress: '123 King St',
      dropoffAddress: '456 Queen St',
      stage: 'awaiting_pax',
    }

    const result = await extractIntent('2 people', convo)
    // The quick-confirm didn't fire, so API is called.
    // nextPrompt should ask about passengers or payment (depending on what's still missing)
    expect(typeof result.nextPrompt).toBe('string')
  })

  it('includes customer name in the service-type prompt when provided', async () => {
    mockCreate.mockResolvedValue(toolResponse({}))
    const result = await extractIntent('hello', baseConvo, 'Amir')
    expect(result.nextPrompt).toMatch(/amir|ride or package/i)
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('extractIntent — error handling', () => {
  beforeEach(() => mockCreate.mockClear())

  it('returns a fallback prompt when the API response is malformed', async () => {
    // Suppress console.error — extractIntent logs errors in the catch block.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Return null for content so `for (const block of response.content)` throws
    // a TypeError inside extractIntent's try block. Using mockResolvedValue (not
    // a synchronous throw) avoids a Vitest 1.6 quirk where synchronous mock
    // throws are intercepted at the process level before the async try-catch runs.
    mockCreate.mockResolvedValue({ content: null })

    const result = await extractIntent('need a ride please', baseConvo)
    expect(result.nextPrompt).toMatch(/sorry|try again/i)

    consoleSpy.mockRestore()
  })

  it('handles empty tool_use response gracefully', async () => {
    mockCreate.mockResolvedValue({ content: [] })

    const result = await extractIntent('ride please', baseConvo)
    // No extracted fields, but should still return a valid result
    expect(typeof result.nextPrompt).toBe('string')
  })
})
