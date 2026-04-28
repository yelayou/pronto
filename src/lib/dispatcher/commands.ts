/**
 * Pronto — Dispatcher command parser
 *
 * Parses raw WhatsApp message text from the dispatcher into structured commands.
 * All matching is case-insensitive and whitespace-tolerant.
 *
 * CONFIRM / DECLINE accept a queue number (e.g. CONFIRM 3) or a prefixed short ID (CONFIRM #3).
 */

export type DispatcherCommand =
  | { type: 'ON_DUTY'; zone: string }
  | { type: 'OFF_DUTY' }
  | { type: 'CONFIRM'; queueNumber: number }
  | { type: 'DECLINE'; queueNumber: number }
  | { type: 'ARRIVED' }
  | { type: 'COMPLETE' }
  | { type: 'NOSHOW' }
  | { type: 'QUEUE' }
  | { type: 'UNKNOWN'; raw: string }

/**
 * Parse a raw message body into a typed DispatcherCommand.
 */
export function parseDispatcherCommand(body: string): DispatcherCommand {
  const text = body.trim()

  // ON DUTY <zone>  e.g. "ON DUTY Islington"
  const onDutyMatch = text.match(/^on\s+duty\s+(.+)$/i)
  if (onDutyMatch) {
    return { type: 'ON_DUTY', zone: onDutyMatch[1].trim() }
  }

  // OFF DUTY
  if (/^off\s+duty$/i.test(text)) {
    return { type: 'OFF_DUTY' }
  }

  // CONFIRM <number> or CONFIRM #<number>  e.g. "CONFIRM 3" or "CONFIRM #3"
  const confirmMatch = text.match(/^confirm\s+#?(\d+)$/i)
  if (confirmMatch) {
    return { type: 'CONFIRM', queueNumber: parseInt(confirmMatch[1], 10) }
  }

  // DECLINE <number> or DECLINE #<number>  e.g. "DECLINE 3" or "DECLINE #3"
  const declineMatch = text.match(/^decline\s+#?(\d+)$/i)
  if (declineMatch) {
    return { type: 'DECLINE', queueNumber: parseInt(declineMatch[1], 10) }
  }

  if (/^arrived$/i.test(text)) return { type: 'ARRIVED' }
  if (/^complete$/i.test(text)) return { type: 'COMPLETE' }
  if (/^noshow$/i.test(text)) return { type: 'NOSHOW' }
  if (/^queue$/i.test(text)) return { type: 'QUEUE' }

  return { type: 'UNKNOWN', raw: text }
}
