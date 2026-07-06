export type RetryOptions = {
  maxAttempts?: number
  isRetryable?: (err: unknown) => boolean
}

const BASE_DELAY_MS = 200

function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true // network / connection errors
  if (err != null && typeof err === 'object' && 'status' in err) {
    return (err as { status: number }).status >= 500
  }
  return true
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const isRetryable = options.isRetryable ?? defaultIsRetryable

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts || !isRetryable(err)) {
        console.error(`[retry] failed after ${attempt} attempt(s):`, err)
        throw err
      }
      const backoff = BASE_DELAY_MS * 2 ** (attempt - 1)
      const jitter = Math.floor(Math.random() * backoff)
      await sleep(backoff + jitter)
    }
  }
  throw lastErr
}
