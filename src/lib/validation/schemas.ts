/**
 * Pronto — Zod schemas for all inbound payloads (PRT-48)
 *
 * Single source of truth for payload shapes. TypeScript types are inferred
 * from the schemas so call-sites never drift from the validation rules.
 */

import { z } from 'zod'

// ── Sanitisation helper ───────────────────────────────────────────────────────

/** Redact a phone number to its last 4 digits for safe logging. */
export function sanitizePhone(phone: string): string {
  if (phone.length <= 4) return phone
  return phone.slice(-4).padStart(phone.length, '*')
}

// ── Twilio webhook payload ────────────────────────────────────────────────────

export const TwilioWebhookSchema = z.object({
  From:       z.string().min(1),
  To:         z.string().min(1),
  Body:       z.string().default(''),  // empty for location-pin messages
  MessageSid: z.string().min(1),
  AccountSid: z.string().min(1),
  NumMedia:   z.string().optional(),
  Latitude:   z.string().optional(),
  Longitude:  z.string().optional(),
})

export type TwilioWebhookPayload = z.infer<typeof TwilioWebhookSchema>

// ── Fare API input ────────────────────────────────────────────────────────────

export const FareInputSchema = z.object({
  distanceKm:  z.number().positive(),
  durationMin: z.number().positive(),
  serviceType: z.enum(['ride', 'package']),
  timeOfDay:   z.enum(['normal', 'peak', 'late']),
  heavyTraffic: z.boolean(),
  packageSize:  z.enum(['small', 'large']).optional(),
  fragile:      z.boolean().optional(),
})

export type FareInputPayload = z.infer<typeof FareInputSchema>
