import { describe, it, expect } from 'vitest'
import { sanitizeInput } from '@/lib/sanitize'

describe('sanitizeInput', () => {
  // --- edge cases ---

  it('returns empty string for undefined', () => {
    expect(sanitizeInput(undefined)).toBe('')
  })

  it('returns empty string for null', () => {
    expect(sanitizeInput(null)).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeInput('   \t\n  ')).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(sanitizeInput('')).toBe('')
  })

  // --- null bytes and control characters ---

  it('strips null bytes', () => {
    expect(sanitizeInput('hello\x00world')).toBe('hello world')
  })

  it('strips ASCII control characters (except tab/LF/CR)', () => {
    expect(sanitizeInput('hello\x01\x02\x1Fworld')).toBe('hello world')
  })

  it('strips DEL character', () => {
    expect(sanitizeInput('hello\x7Fworld')).toBe('hello world')
  })

  // --- HTML stripping ---

  it('strips HTML tags, leaving inner text', () => {
    // Tags (<script>...</script>) are removed; the content between them is plain text
    expect(sanitizeInput('<script>alert(1)</script>hello')).toBe('alert(1) hello')
  })

  it('strips nested HTML tags', () => {
    expect(sanitizeInput('<b><i>bold italic</i></b>')).toBe('bold italic')
  })

  it('strips self-closing tags', () => {
    expect(sanitizeInput('line1<br/>line2')).toBe('line1 line2')
  })

  it('strips HTML attributes', () => {
    expect(sanitizeInput('<a href="http://evil.com">click</a>')).toBe('click')
  })

  // --- whitespace normalisation ---

  it('collapses multiple spaces to one', () => {
    expect(sanitizeInput('hello   world')).toBe('hello world')
  })

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeInput('  hello world  ')).toBe('hello world')
  })

  it('normalises mixed whitespace', () => {
    expect(sanitizeInput('  hello \t\n world  ')).toBe('hello world')
  })

  // --- truncation ---

  it('truncates to 1000 characters', () => {
    const long = 'a'.repeat(1500)
    expect(sanitizeInput(long)).toHaveLength(1000)
  })

  it('does not truncate strings at or under 1000 characters', () => {
    const exact = 'a'.repeat(1000)
    expect(sanitizeInput(exact)).toHaveLength(1000)
  })

  // --- injection patterns ---

  it('strips a basic XSS payload', () => {
    const xss = '<img src=x onerror=alert(1)>'
    expect(sanitizeInput(xss)).toBe('')
  })

  it('handles SQL injection attempt safely (text preserved, no tags to strip)', () => {
    const sql = "'; DROP TABLE bookings; --"
    expect(sanitizeInput(sql)).toBe("'; DROP TABLE bookings; --")
  })

  // --- normal content passes through ---

  it('passes through a normal address', () => {
    expect(sanitizeInput('123 King St W, Toronto, ON')).toBe(
      '123 King St W, Toronto, ON'
    )
  })

  it('passes through a normal booking message', () => {
    const msg = 'I need a ride from Union Station to Pearson T1, 2 passengers, cash'
    expect(sanitizeInput(msg)).toBe(msg)
  })
})
