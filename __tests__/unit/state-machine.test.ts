/**
 * Unit tests for the conversation state machine (PRT-44).
 */

import { describe, it, expect } from 'vitest'
import {
  assertValidTransition,
  InvalidTransitionError,
  ALLOWED_TRANSITIONS,
} from '@/lib/customer/stateMachine'
import type { ConversationStage } from '@/types'

// ─── Transition map completeness ──────────────────────────────────────────────

describe('ALLOWED_TRANSITIONS', () => {
  const allStages: ConversationStage[] = [
    'idle',
    'awaiting_name',
    'awaiting_service',
    'awaiting_pickup',
    'awaiting_dropoff',
    'awaiting_landmark',
    'awaiting_pax',
    'awaiting_pkg_size',
    'awaiting_recipient',
    'awaiting_payment',
    'awaiting_confirm',
    'confirmed',
  ]

  it('has an entry for every ConversationStage', () => {
    for (const stage of allStages) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(stage)
    }
  })

  it('confirmed is terminal — no transitions out', () => {
    expect(ALLOWED_TRANSITIONS['confirmed']).toHaveLength(0)
  })
})

// ─── Valid transitions ────────────────────────────────────────────────────────

describe('assertValidTransition — valid transitions pass', () => {
  const validCases: [ConversationStage, ConversationStage][] = [
    ['idle', 'awaiting_name'],
    ['idle', 'awaiting_service'],
    ['awaiting_name', 'awaiting_service'],
    ['awaiting_service', 'awaiting_pickup'],
    ['awaiting_service', 'awaiting_landmark'],
    ['awaiting_service', 'awaiting_confirm'],   // NLU captured all fields at once
    ['awaiting_pickup', 'awaiting_dropoff'],
    ['awaiting_pickup', 'awaiting_confirm'],    // NLU forward-jump
    ['awaiting_pickup', 'awaiting_landmark'],
    ['awaiting_dropoff', 'awaiting_pax'],
    ['awaiting_dropoff', 'awaiting_pkg_size'],
    ['awaiting_dropoff', 'awaiting_confirm'],
    ['awaiting_landmark', 'awaiting_dropoff'],
    ['awaiting_landmark', 'awaiting_pax'],
    ['awaiting_landmark', 'awaiting_confirm'],
    ['awaiting_pax', 'awaiting_pax'],           // self-transition (no advance)
    ['awaiting_pax', 'awaiting_payment'],
    ['awaiting_pax', 'awaiting_confirm'],
    ['awaiting_pkg_size', 'awaiting_recipient'],
    ['awaiting_pkg_size', 'awaiting_payment'],
    ['awaiting_recipient', 'awaiting_payment'],
    ['awaiting_recipient', 'awaiting_confirm'],
    ['awaiting_payment', 'awaiting_confirm'],
    ['awaiting_payment', 'awaiting_payment'],   // self-transition
    ['awaiting_confirm', 'awaiting_confirm'],   // correction re-shows summary
    ['awaiting_confirm', 'confirmed'],
  ]

  for (const [from, to] of validCases) {
    it(`${from} → ${to}`, () => {
      expect(() => assertValidTransition(from, to)).not.toThrow()
    })
  }
})

// ─── Invalid transitions ──────────────────────────────────────────────────────

describe('assertValidTransition — invalid transitions throw', () => {
  const invalidCases: [ConversationStage, ConversationStage][] = [
    ['confirmed', 'awaiting_service'],          // terminal → anything
    ['confirmed', 'idle'],
    ['awaiting_payment', 'awaiting_pickup'],    // backward
    ['awaiting_payment', 'awaiting_service'],   // backward
    ['awaiting_confirm', 'awaiting_pickup'],    // backward
    ['awaiting_confirm', 'idle'],               // backward
    ['awaiting_pax', 'awaiting_service'],       // backward
    ['awaiting_name', 'awaiting_pickup'],       // skips awaiting_service
    ['idle', 'confirmed'],                      // impossible jump
    ['awaiting_landmark', 'awaiting_service'],  // landmark can't go backward
    ['awaiting_landmark', 'idle'],
  ]

  for (const [from, to] of invalidCases) {
    it(`${from} → ${to} throws InvalidTransitionError`, () => {
      expect(() => assertValidTransition(from, to)).toThrow(InvalidTransitionError)
    })
  }
})

// ─── Error shape ──────────────────────────────────────────────────────────────

describe('InvalidTransitionError', () => {
  it('carries from and to on the error instance', () => {
    const err = new InvalidTransitionError('confirmed', 'awaiting_service')
    expect(err.from).toBe('confirmed')
    expect(err.to).toBe('awaiting_service')
    expect(err.name).toBe('InvalidTransitionError')
    expect(err.message).toContain('confirmed')
    expect(err.message).toContain('awaiting_service')
  })

  it('is an instance of Error', () => {
    expect(new InvalidTransitionError('idle', 'confirmed')).toBeInstanceOf(Error)
  })
})
