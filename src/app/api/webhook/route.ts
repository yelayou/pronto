import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/webhook
 *
 * Receives all inbound WhatsApp messages from Twilio.
 * Routes to either:
 *   - Dispatcher handler  (message from DISPATCHER_PHONE)
 *   - Customer handler    (any other number)
 *
 * Full implementation: SCRUM-16, SCRUM-17, SCRUM-18, SCRUM-19
 */
export async function POST(request: NextRequest) {
  // Parse form-encoded Twilio payload
  const formData = await request.formData()
  const from = formData.get('From') as string
  const body = formData.get('Body') as string

  if (!from || !body) {
    return new NextResponse('Bad request', { status: 400 })
  }

  const dispatcherPhone = process.env.DISPATCHER_PHONE
  const isDispatcher =
    from === `whatsapp:${dispatcherPhone}` || from === dispatcherPhone

  // TODO (SCRUM-16/17): Route to dispatcher command handler
  // TODO (SCRUM-18/19): Route to customer conversation handler
  console.log(`[webhook] from=${from} isDispatcher=${isDispatcher} body="${body}"`)

  // Twilio expects a 200 response with TwiML or empty body
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    }
  )
}
