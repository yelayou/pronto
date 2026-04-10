/**
 * Pronto — Dispatcher command parser
 *
 * Parses raw WhatsApp message text from the dispatcher into structured commands.
 * All matching is case-insensitive and whitespace-tolerant.
 */

export type DispatcherCommand =
  | { type: 'ON_DUTY'; zone: string }
  | { type: 'OFF_DUTY' }
  | { type: 'CONFIRM'; bookingId: string }
  | { type: 'DECLINE'; bookingId: string }
  | { type: 'ARRIVED' }
  | { type: 'COMPLETE' }
  | { type: 'NOSHOW' }
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

  // CONFIRM <id>  e.g. "CONFIRM abc-123"
  const confirmMatch = text.match(/^confirm\s+(\S+)$/i)
  if (confirmMatch) {
    return { type: 'CONFIRM', bookingId: confirmMatch[1] }
  }

  // DECLINE <id>  e.g. "DECLINE abc-123"
  const declineMatch = text.match(/^decline\s+(\S+)$/i)
  if (declineMatch) {
    return { type: 'DECLINE', bookingId: declineMatch[1] }
  }

  if (/^arrived$/i.test(text)) return { type: 'ARRIVED' }
  if (/^complete$/i.test(text)) return { type: 'COMPLETE' }
  if (/^noshow$/i.test(text)) return { type: 'NOSHOW' }

  return { type: 'UNKNOWN', raw: text }
}
