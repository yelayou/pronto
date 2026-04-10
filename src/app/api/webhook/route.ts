import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioSignature, sendWhatsApp } from '@/lib/twilio/client'
import { handleDispatcherMessage } from '@/lib/dispatcher/handler'

/**
 * POST /api/webhook
 *
 * Receives all inbound WhatsApp messages from Twilio.
 * Routes to either:
 *   - Dispatcher handler  (message from DISPATCHER_PHONE)
 *   - Customer handler    (any other number)
 *
 * PRT-16: ON DUTY / OFF DUTY dispatcher commands
 * PRT-17: Full dispatcher command set
 * PRT-18/19: Customer conversation handler (coming soon)
 */
export async function POST(request: NextRequest) {
  // ── Validate Twilio signature ──────────────────────────────────────────────
  const signature = request.headers.get('x-twilio-signature') ?? ''
  const url = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
    : request.url

  const formData = await request.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => { params[key] = value.toString() })

  if (!validateTwilioSignature(signature, url, params)) {
    console.warn('[webhook] Invalid Twilio signature — request rejected')
    return new NextResponse('Forbidden', { status: 403 })
  }

  // ── Parse payload ──────────────────────────────────────────────────────────
  const from = params['From']
  const body = params['Body']

  if (!from || !body) {
    return new NextResponse('Bad request', { status: 400 })
  }

  const dispatcherPhone = process.env.DISPATCHER_PHONE
  const isDispatcher =
    from === `whatsapp:${dispatcherPhone}` || from === dispatcherPhone

  // ── Route message ──────────────────────────────────────────────────────────
  try {
    if (isDispatcher) {
      const reply = await handleDispatcherMessage(body)
      await sendWhatsApp(from, reply)
    } else {
      // TODO (PRT-18/19): Customer conversation handler
      console.log(`[webhook] Customer message from ${from}: "${body}"`)
    }
  } catch (err) {
    console.error('[webhook] Error handling message:', err)
    // Don't surface errors to Twilio — always return 200
  }

  // Twilio expects a 200 with TwiML (even if empty)
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    }
  )
}
