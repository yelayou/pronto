/**
 * Unit tests for Zod schema validation (PRT-48)
 *
 * Covers TwilioWebhookSchema, FareInputSchema, and the sanitizePhone helper.
 */

import { describe, it, expect } from 'vitest'
import {
  TwilioWebhookSchema,
  FareInputSchema,
  sanitizePhone,
} from '@/lib/validation/schemas'

// ── TwilioWebhookSchema ───────────────────────────────────────────────────────

const VALID_TWILIO: Record<string, string> = {
  From:       'whatsapp:+14165550001',
  To:         'whatsapp:+14165550000',
  Body:       'Hello',
  MessageSid: 'SM1234567890abcdef1234567890abcdef',
  AccountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
}

describe('TwilioWebhookSchema', () => {
  it('accepts a complete valid payload', () => {
    const result = TwilioWebhookSchema.safeParse(VALID_TWILIO)
    expect(result.success).toBe(true)
  })

  it('accepts a location-pin payload with no Body field', () => {
    const { Body: _, ...noBody } = VALID_TWILIO
    const result = TwilioWebhookSchema.safeParse({
      ...noBody,
      Latitude: '43.6532',
      Longitude: '-79.3832',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.Body).toBe('')
  })

  it('defaults Body to empty string when absent', () => {
    const { Body: _, ...noBody } = VALID_TWILIO
    const result = TwilioWebhookSchema.safeParse(noBody)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.Body).toBe('')
  })

  it('accepts optional Latitude and Longitude', () => {
    const result = TwilioWebhookSchema.safeParse({
      ...VALID_TWILIO,
      Latitude: '43.6532',
      Longitude: '-79.3832',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.Latitude).toBe('43.6532')
      expect(result.data.Longitude).toBe('-79.3832')
    }
  })

  it('rejects a payload missing From', () => {
    const { From: _, ...noFrom } = VALID_TWILIO
    const result = TwilioWebhookSchema.safeParse(noFrom)
    expect(result.success).toBe(false)
  })

  it('rejects a payload with an empty From', () => {
    const result = TwilioWebhookSchema.safeParse({ ...VALID_TWILIO, From: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a payload missing MessageSid', () => {
    const { MessageSid: _, ...noSid } = VALID_TWILIO
    const result = TwilioWebhookSchema.safeParse(noSid)
    expect(result.success).toBe(false)
  })

  it('rejects a payload missing AccountSid', () => {
    const { AccountSid: _, ...noAccount } = VALID_TWILIO
    const result = TwilioWebhookSchema.safeParse(noAccount)
    expect(result.success).toBe(false)
  })

  it('rejects a completely empty object', () => {
    const result = TwilioWebhookSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── FareInputSchema ───────────────────────────────────────────────────────────

const VALID_FARE = {
  distanceKm:  25,
  durationMin: 30,
  serviceType: 'ride' as const,
  timeOfDay:   'normal' as const,
  heavyTraffic: false,
}

describe('FareInputSchema', () => {
  it('accepts a minimal valid fare input', () => {
    const result = FareInputSchema.safeParse(VALID_FARE)
    expect(result.success).toBe(true)
  })

  it('accepts a package fare with all optional fields', () => {
    const result = FareInputSchema.safeParse({
      ...VALID_FARE,
      serviceType: 'package',
      packageSize: 'large',
      fragile: true,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a negative distanceKm', () => {
    const result = FareInputSchema.safeParse({ ...VALID_FARE, distanceKm: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects zero durationMin', () => {
    const result = FareInputSchema.safeParse({ ...VALID_FARE, durationMin: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid serviceType', () => {
    const result = FareInputSchema.safeParse({ ...VALID_FARE, serviceType: 'taxi' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid timeOfDay', () => {
    const result = FareInputSchema.safeParse({ ...VALID_FARE, timeOfDay: 'rush' })
    expect(result.success).toBe(false)
  })

  it('rejects heavyTraffic as a string instead of boolean', () => {
    const result = FareInputSchema.safeParse({ ...VALID_FARE, heavyTraffic: 'true' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid packageSize', () => {
    const result = FareInputSchema.safeParse({
      ...VALID_FARE,
      serviceType: 'package',
      packageSize: 'huge',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing distanceKm', () => {
    const { distanceKm: _, ...rest } = VALID_FARE
    const result = FareInputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})

// ── sanitizePhone ─────────────────────────────────────────────────────────────

describe('sanitizePhone', () => {
  it('redacts all but the last 4 digits', () => {
    expect(sanitizePhone('whatsapp:+14165550001')).toBe('*****************0001')
  })

  it('handles a plain E.164 number', () => {
    expect(sanitizePhone('+14165550001')).toBe('********0001')
  })

  it('returns the input unchanged when 4 chars or fewer', () => {
    expect(sanitizePhone('1234')).toBe('1234')
    expect(sanitizePhone('12')).toBe('12')
  })
})
