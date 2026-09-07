/**
 * Unit tests for the structured JSON logger (PRT-39).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { logger, maskPhone } from '@/lib/logger'

// ─── maskPhone ────────────────────────────────────────────────────────────────

describe('maskPhone', () => {
  it('masks a full E.164 phone number to ***XXXX', () => {
    expect(maskPhone('+14165551234')).toBe('***1234')
  })

  it('strips whatsapp: prefix before masking', () => {
    expect(maskPhone('whatsapp:+14165559999')).toBe('***9999')
  })

  it('handles a bare 10-digit number', () => {
    expect(maskPhone('4165550000')).toBe('***0000')
  })
})

// ─── logger output ────────────────────────────────────────────────────────────

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logger.info emits JSON on console.log with level=info', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('test message', { stage: 'awaiting_pickup' })
    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('test message')
    expect(parsed.stage).toBe('awaiting_pickup')
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('logger.warn emits JSON on console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('something suspicious')
    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('warn')
  })

  it('logger.error emits JSON on console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('something broke')
    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('error')
  })

  it('serialises Error.message into the error field', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('oops', {}, new Error('db connection refused'))
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.error).toBe('db connection refused')
  })

  it('serialises non-Error thrown values as strings', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('oops', {}, 'raw string error')
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.error).toBe('raw string error')
  })

  it('includes all context fields in the output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('msg', { messageId: 'SM123', phone: '***4321', stage: 'confirmed' })
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.messageId).toBe('SM123')
    expect(parsed.phone).toBe('***4321')
    expect(parsed.stage).toBe('confirmed')
  })

  it('omits error field when no error is passed', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('clean message')
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect('error' in parsed).toBe(false)
  })
})
