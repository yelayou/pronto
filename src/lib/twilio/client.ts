import twilio from 'twilio'
import { withRetry } from '@/lib/retry'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER

if (!accountSid || !authToken || !fromNumber) {
  throw new Error(
    'Missing Twilio env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER are required'
  )
}

export const twilioClient = twilio(accountSid, authToken)

/**
 * Send a WhatsApp message via Twilio.
 * @param to   Recipient phone in E.164 format e.g. +14165550123
 * @param body Message text
 */
export async function sendWhatsApp(to: string, body: string): Promise<void> {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
  const fromFormatted = fromNumber!.startsWith('whatsapp:')
    ? fromNumber!
    : `whatsapp:${fromNumber}`

  await withRetry(() =>
    twilioClient.messages.create({ from: fromFormatted, to: toFormatted, body })
  )
}

/**
 * Validate that a webhook request is genuinely from Twilio.
 * Call this at the top of every webhook handler.
 */
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return twilio.validateRequest(authToken!, signature, url, params)
}
