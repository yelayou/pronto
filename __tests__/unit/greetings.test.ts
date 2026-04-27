/**
 * Unit tests for the smart greeting system (PRT-62 / PRT-68)
 *
 * Uses fake timers to control the current date so tests are deterministic
 * regardless of when they run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildGreeting } from '@/lib/customer/greetings'

describe('buildGreeting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── Returning vs. new customer ─────────────────────────────────────────────

  describe('returning vs. new customer', () => {
    it('includes the customer name for a returning customer', () => {
      vi.setSystemTime(new Date('2026-04-14T10:00:00')) // Tuesday morning, spring
      const greeting = buildGreeting('Marcus', '+14165550001')
      expect(greeting).toContain('Marcus')
    })

    it('does not literally include "undefined" for a new customer', () => {
      vi.setSystemTime(new Date('2026-04-14T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).not.toContain('undefined')
    })

    it('new customer greeting mentions Pronto or Welcome', () => {
      vi.setSystemTime(new Date('2026-04-14T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/pronto|welcome/i)
    })

    it('returning customer greeting does NOT say "Welcome to Pronto"', () => {
      vi.setSystemTime(new Date('2026-04-14T10:00:00'))
      const greeting = buildGreeting('Lena', '+14165550001')
      expect(greeting).not.toMatch(/welcome to pronto/i)
    })
  })

  // ─── Canadian holidays ───────────────────────────────────────────────────────

  describe('Canadian holiday greetings', () => {
    it('returns a Christmas greeting on December 25', () => {
      vi.setSystemTime(new Date('2026-12-25T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/christmas/i)
    })

    it('returns a Canada Day greeting on July 1', () => {
      vi.setSystemTime(new Date('2026-07-01T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/canada day/i)
    })

    it('returns a Boxing Day greeting on December 26', () => {
      vi.setSystemTime(new Date('2026-12-26T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/boxing day/i)
    })

    it('returns a Thanksgiving greeting on the 2nd Monday of October 2026 (Oct 12)', () => {
      vi.setSystemTime(new Date('2026-10-12T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/thanksgiving/i)
    })

    it('includes customer name in holiday greeting for returning customer', () => {
      vi.setSystemTime(new Date('2026-12-25T10:00:00'))
      const greeting = buildGreeting('Sofia', '+14165550001')
      expect(greeting).toContain('Sofia')
      expect(greeting).toMatch(/christmas/i)
    })

    it('does not produce a holiday greeting on a normal weekday', () => {
      vi.setSystemTime(new Date('2026-04-14T10:00:00')) // Tuesday, no holiday
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).not.toMatch(/christmas|canada day|thanksgiving|boxing day/i)
    })
  })

  // ─── Seasonal greetings ──────────────────────────────────────────────────────

  describe('seasonal greetings', () => {
    it('returns a winter-flavoured greeting in January (non-holiday)', () => {
      vi.setSystemTime(new Date('2026-01-15T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/winter|❄️|🌨️|frosty|chilly/i)
    })

    it('returns a spring-flavoured greeting in April (non-holiday)', () => {
      vi.setSystemTime(new Date('2026-04-07T10:00:00')) // after Good Friday
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/spring|🌱|🌸|🦋/i)
    })

    it('returns a summer-flavoured greeting in July (non-holiday, non-Friday)', () => {
      vi.setSystemTime(new Date('2026-07-08T10:00:00')) // Wednesday in July, not Jul 1
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/summer|☀️|🏖️|🌊/i)
    })

    it('returns a fall-flavoured greeting in October after Thanksgiving', () => {
      vi.setSystemTime(new Date('2026-10-20T10:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/fall|autumn|🍂|🌰|🎨/i)
    })
  })

  // ─── Time of day ─────────────────────────────────────────────────────────────

  describe('time of day', () => {
    it('returns a late-night greeting after 22:00', () => {
      vi.setSystemTime(new Date('2026-04-14T23:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/late|night|🌙|💤/i)
    })

    it('returns a morning greeting at 07:00', () => {
      vi.setSystemTime(new Date('2026-01-15T07:00:00'))
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/morning|rise|shine|☀️|❄️/i)
    })
  })

  // ─── Day-of-week greetings ────────────────────────────────────────────────────

  describe('day-of-week greetings', () => {
    it('returns a Friday greeting on Friday (non-holiday)', () => {
      vi.setSystemTime(new Date('2026-04-17T10:00:00')) // Friday
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/friday/i)
    })

    it('returns a Monday greeting on Monday (non-holiday)', () => {
      vi.setSystemTime(new Date('2026-04-13T10:00:00')) // Monday
      const greeting = buildGreeting(undefined, '+14165550001')
      expect(greeting).toMatch(/monday/i)
    })
  })

  // ─── Determinism ──────────────────────────────────────────────────────────────

  describe('determinism', () => {
    it('returns the same greeting for the same phone + date across multiple calls', () => {
      vi.setSystemTime(new Date('2026-04-14T09:00:00'))
      const a = buildGreeting('Alice', '+14165550100')
      const b = buildGreeting('Alice', '+14165550100')
      expect(a).toBe(b)
    })

    it('different phones on the same day can get different variants', () => {
      vi.setSystemTime(new Date('2026-04-14T09:00:00'))
      // Six distinct phones — should spread across the 3-variant pool
      const greetings = new Set(
        [
          '+14165550001',
          '+14165550002',
          '+14165550003',
          '+14165550004',
          '+14165550005',
          '+14165550006',
        ].map((phone) => buildGreeting('Sam', phone))
      )
      expect(greetings.size).toBeGreaterThan(1)
    })

    it('same phone on different dates can get different variants', () => {
      const phone = '+14165550007'
      // Compare greetings across 6 different spring weekday mornings
      const greetings = new Set(
        ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-13', '2026-04-14'].map(
          (date) => {
            vi.setSystemTime(new Date(`${date}T10:00:00`))
            return buildGreeting('Sam', phone)
          }
        )
      )
      expect(greetings.size).toBeGreaterThan(1)
    })
  })
})
