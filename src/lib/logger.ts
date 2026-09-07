/**
 * Pronto — structured JSON logger (PRT-39)
 *
 * Thin wrapper around console that emits newline-delimited JSON so Vercel's
 * log viewer can filter/search by field. No external dependencies.
 *
 * PII rules:
 *  - Phone numbers must be masked with maskPhone() before passing as `phone`
 *  - Addresses must never appear in log context
 */

export interface LogContext {
  messageId?: string   // Twilio MessageSid
  phone?: string       // must be pre-masked — use maskPhone()
  stage?: string       // ConversationStage
  [key: string]: unknown
}

/** Mask a raw phone (with or without whatsapp: prefix) to ***XXXX. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/^whatsapp:/, '').replace(/\D/g, '')
  return `***${digits.slice(-4)}`
}

function emit(level: 'info' | 'warn' | 'error', message: string, ctx?: LogContext, err?: unknown): void {
  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...ctx,
  }
  if (err instanceof Error) {
    entry.error = err.message
  } else if (err !== undefined) {
    entry.error = String(err)
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info(message: string, ctx?: LogContext): void { emit('info', message, ctx) },
  warn(message: string, ctx?: LogContext, err?: unknown): void { emit('warn', message, ctx, err) },
  error(message: string, ctx?: LogContext, err?: unknown): void { emit('error', message, ctx, err) },
}
