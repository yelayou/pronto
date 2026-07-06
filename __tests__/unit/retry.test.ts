import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry } from '@/lib/retry'

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function run<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {}) // prevent unhandled rejection while timers advance
  await vi.runAllTimersAsync()
  return promise
}

describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and succeeds on second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValue('ok')

    const result = await run(withRetry(fn))
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting all attempts', async () => {
    const err = new TypeError('network error')
    const fn = vi.fn().mockRejectedValue(err)

    await expect(run(withRetry(fn, { maxAttempts: 3 }))).rejects.toThrow(
      'network error'
    )
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry 4xx errors', async () => {
    const err = Object.assign(new Error('bad request'), { status: 400 })
    const fn = vi.fn().mockRejectedValue(err)

    await expect(run(withRetry(fn))).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries 5xx errors', async () => {
    const serverErr = Object.assign(new Error('server error'), { status: 503 })
    const fn = vi
      .fn()
      .mockRejectedValueOnce(serverErr)
      .mockResolvedValue('recovered')

    const result = await run(withRetry(fn))
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('respects custom isRetryable predicate', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error('non-retryable by custom rule'))

    await expect(
      run(withRetry(fn, { isRetryable: () => false }))
    ).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('respects custom maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('flaky'))

    await expect(run(withRetry(fn, { maxAttempts: 5 }))).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(5)
  })
})
