/**
 * Pronto — Customer message handler
 *
 * Handles all inbound WhatsApp messages from customers.
 * Manages the per-customer conversation state machine persisted in Supabase.
 *
 * PRT-18: Greeting + service selection (idle → awaiting_service → service chosen)
 * PRT-19: Full booking detail collection (pickup, dropoff, pax/package, payment, confirm)
 */

import { getDispatcherState } from '@/lib/supabase/dispatcher'
import { getCustomer, upsertCustomer } from '@/lib/supabase/customers'
import {
  getConversationState,
  upsertConversationState,
  resetConversation,
} from '@/lib/supabase/conversations'
import type { ConversationState, ServiceType } from '@/types'

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Handle an inbound message from a customer.
 * @param from  Customer's WhatsApp number (e.g. "whatsapp:+14165550123")
 * @param body  Raw message text
 * @returns     Reply text to send back to the customer, or null to stay silent
 */
export async function handleCustomerMessage(
  from: string,
  body: string
): Promise<string | null> {
  const phone = normalisePhone(from)
  const text = body.trim()

  // ── 1. Check dispatcher duty status ────────────────────────────────────────
  const dispatcher = await getDispatcherState()
  if (!dispatcher || dispatcher.dutyStatus === 'off') {
    return offDutyMessage()
  }

  // ── 2. Ensure customer record exists ───────────────────────────────────────
  const [customer] = await Promise.all([
    upsertCustomer(phone),
  ])

  // ── 3. Load or initialise conversation state ───────────────────────────────
  let convo = await getConversationState(phone)

  if (!convo || convo.stage === 'idle') {
    // Fresh start — greet and show service menu
    convo = await upsertConversationState({
      customerPhone: phone,
      stage: 'awaiting_service',
    })
    return greetingMessage(customer?.name)
  }

  // ── 4. Route to the appropriate stage handler ──────────────────────────────
  switch (convo.stage) {
    case 'awaiting_service':
      return handleServiceSelection(phone, text, convo)

    // PRT-19 stages — stubs that re-display the prompt until implemented
    case 'awaiting_pickup':
    case 'awaiting_dropoff':
    case 'awaiting_pax':
    case 'awaiting_pkg_size':
    case 'awaiting_recipient':
    case 'awaiting_payment':
    case 'awaiting_confirm':
    case 'confirmed':
      // TODO (PRT-19): full booking detail collection
      return null

    default:
      // Unknown stage — reset and start over
      await resetConversation(phone)
      return greetingMessage(customer?.name)
  }
}

// ─── Stage: service selection ─────────────────────────────────────────────────

/**
 * Parse the customer's service selection from the awaiting_service stage.
 * Accepts: "1", "ride", "2", "delivery", "package", "package delivery"
 */
async function handleServiceSelection(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const lower = text.toLowerCase()

  let serviceType: ServiceType | null = null

  if (lower === '1' || lower === 'ride') {
    serviceType = 'ride'
  } else if (
    lower === '2' ||
    lower === 'delivery' ||
    lower === 'package' ||
    lower === 'package delivery'
  ) {
    serviceType = 'package'
  }

  if (!serviceType) {
    // Unrecognised input — re-prompt
    return serviceMenuMessage()
  }

  // Advance conversation to pickup stage
  await upsertConversationState({
    ...convo,
    stage: 'awaiting_pickup',
    serviceType,
  })

  if (serviceType === 'ride') {
    return `🚗 Great! Let's get your ride booked.\n\nWhat's the *pickup address*?`
  } else {
    return `📦 Package delivery — got it!\n\nWhat's the *pickup address* (where we're collecting the package from)?`
  }
}

// ─── Message templates ────────────────────────────────────────────────────────

function greetingMessage(name?: string): string {
  const greeting = name
    ? `Welcome back, *${name}*! 👋`
    : `Hi there! Welcome to *Pronto* 👋`

  return (
    `${greeting}\n\n` +
    `We offer fast, on-demand rides and package delivery across the GTA.\n\n` +
    serviceMenuMessage()
  )
}

function serviceMenuMessage(): string {
  return (
    `What can we help you with today?\n\n` +
    `1️⃣  *Ride* (ASAP)\n` +
    `2️⃣  *Package delivery*\n\n` +
    `Reply *1* or *2* to get started.`
  )
}

function offDutyMessage(): string {
  return (
    `Hi! Thanks for reaching out to *Pronto* 🙏\n\n` +
    `We're not available right now, but we'll be back soon.\n\n` +
    `Feel free to message us again later and we'll get you sorted! 🚗`
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip the "whatsapp:" prefix Twilio prepends to phone numbers.
 */
function normalisePhone(from: string): string {
  return from.startsWith('whatsapp:') ? from.slice('whatsapp:'.length) : from
}
