/**
 * Pronto — Customer message handler
 *
 * Handles all inbound WhatsApp messages from customers.
 * Manages the per-customer conversation state machine persisted in Supabase.
 *
 * Conversation stages:
 *   idle → awaiting_service → awaiting_pickup → awaiting_dropoff
 *     → awaiting_pax (ride) | awaiting_pkg_size → awaiting_recipient (pkg)
 *     → awaiting_payment → awaiting_confirm → confirmed
 *
 * PRT-18: Greeting + service selection
 * PRT-19: Full booking detail collection, fare calculation, booking creation
 */

import { getDispatcherState } from '@/lib/supabase/dispatcher'
import { getCustomer, upsertCustomer } from '@/lib/supabase/customers'
import {
  getConversationState,
  upsertConversationState,
  resetConversation,
} from '@/lib/supabase/conversations'
import { createBooking, getPendingBookings } from '@/lib/supabase/bookings'
import { geocodeAddress, reverseGeocode, getRoute } from '@/lib/maps/client'
import { validateGTALocation } from '@/lib/geofence/gta'
import { calculateFare, formatFareForCustomer } from '@/lib/fare/calculator'
import { sendWhatsApp } from '@/lib/twilio/client'
import type { ConversationState, ServiceType, PackageSize, PaymentMethod, TimeOfDay } from '@/types'

const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE!

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Handle an inbound message from a customer.
 * @param from  Customer WhatsApp number (e.g. "whatsapp:+14165550123")
 * @param body  Raw message text (may be empty if location pin was shared)
 * @param lat   Latitude if customer shared a location pin
 * @param lng   Longitude if customer shared a location pin
 * @returns     Reply text to send back, or null to stay silent
 */
export async function handleCustomerMessage(
  from: string,
  body: string,
  lat?: number,
  lng?: number
): Promise<string | null> {
  const phone = normalisePhone(from)
  const text = body.trim()
  const isPin = lat !== undefined && lng !== undefined

  // ── 1. Check dispatcher duty status ────────────────────────────────────────
  const dispatcher = await getDispatcherState()
  if (!dispatcher || dispatcher.dutyStatus === 'off') {
    return offDutyMessage()
  }

  // ── 2. Ensure customer record exists ───────────────────────────────────────
  const customer = await upsertCustomer(phone)

  // ── 3. Load or initialise conversation state ───────────────────────────────
  let convo = await getConversationState(phone)

  if (!convo || convo.stage === 'idle') {
    convo = await upsertConversationState({
      customerPhone: phone,
      stage: 'awaiting_service',
    })
    return greetingMessage(customer.name)
  }

  // ── 4. Route to stage handler ──────────────────────────────────────────────
  switch (convo.stage) {
    case 'awaiting_service':
      return handleServiceSelection(phone, text, convo)

    case 'awaiting_pickup':
      return handlePickup(phone, text, convo, isPin, lat, lng)

    case 'awaiting_dropoff':
      return handleDropoff(phone, text, convo, isPin, lat, lng)

    case 'awaiting_pax':
      return handlePassengerCount(phone, text, convo)

    case 'awaiting_pkg_size':
      return handlePackageSize(phone, text, convo)

    case 'awaiting_recipient':
      return handleRecipient(phone, text, convo)

    case 'awaiting_payment':
      return handlePayment(phone, text, convo)

    case 'awaiting_confirm':
      return handleConfirm(phone, text, convo)

    case 'confirmed':
      // Booking already submitted — gentle nudge
      return `Your booking is already confirmed and waiting for the driver. We'll message you as soon as it's accepted! 🙏`

    default:
      await resetConversation(phone)
      return greetingMessage(customer.name)
  }
}

// ─── Stage handlers ───────────────────────────────────────────────────────────

async function handleServiceSelection(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const lower = text.toLowerCase()
  let serviceType: ServiceType | null = null

  if (lower === '1' || lower === 'ride') serviceType = 'ride'
  else if (lower === '2' || lower === 'delivery' || lower === 'package' || lower === 'package delivery') serviceType = 'package'

  if (!serviceType) return serviceMenuMessage()

  await upsertConversationState({ ...convo, stage: 'awaiting_pickup', serviceType })

  return serviceType === 'ride'
    ? `🚗 Great, let's get your ride booked!\n\nWhat's the *pickup address*? You can type the address or 📍 *share your location*.`
    : `📦 Package delivery — got it!\n\nWhat's the *pickup address* (where we're collecting from)? Type the address or 📍 *share your location*.`
}

async function handlePickup(
  phone: string,
  text: string,
  convo: ConversationState,
  isPin: boolean,
  lat?: number,
  lng?: number
): Promise<string> {
  let pickupAddress: string
  let pickupLat: number | undefined
  let pickupLng: number | undefined

  if (isPin) {
    // Location pin shared
    pickupLat = lat
    pickupLng = lng
    pickupAddress = await reverseGeocode(lat!, lng!)
  } else {
    if (!text) return `Please type a pickup address or share your 📍 location.`
    const geo = await geocodeAddress(text)
    if (!geo) {
      return `I couldn't find that address. Could you try again with a more specific address? (e.g. *123 Main St, Toronto*)`
    }
    pickupAddress = geo.formattedAddress
    pickupLat = geo.lat
    pickupLng = geo.lng
  }

  // ── Geofence check ─────────────────────────────────────────────────────────
  if (pickupLat !== undefined && pickupLng !== undefined) {
    const fence = validateGTALocation(pickupLat, pickupLng)
    if (!fence.withinGTA) {
      return (
        `📍 *${pickupAddress}*\n\n` +
        `${fence.reason} We currently serve Toronto and the surrounding GTA.\n\n` +
        `Please provide a pickup address within the GTA.`
      )
    }
  }

  await upsertConversationState({
    ...convo,
    stage: 'awaiting_dropoff',
    pickupAddress,
    pickupLat,
    pickupLng,
  })

  return (
    `📍 Pickup: *${pickupAddress}*\n\n` +
    `Now, what's the *drop-off address*? Type the address or 📍 *share a location pin*.`
  )
}

async function handleDropoff(
  phone: string,
  text: string,
  convo: ConversationState,
  isPin: boolean,
  lat?: number,
  lng?: number
): Promise<string> {
  let dropoffAddress: string
  let dropoffLat: number | undefined
  let dropoffLng: number | undefined

  if (isPin) {
    dropoffLat = lat
    dropoffLng = lng
    dropoffAddress = await reverseGeocode(lat!, lng!)
  } else {
    if (!text) return `Please type a drop-off address or share your 📍 location.`
    const geo = await geocodeAddress(text)
    if (!geo) {
      return `I couldn't find that address. Try again with a specific address (e.g. *456 Queen St W, Toronto*)`
    }
    dropoffAddress = geo.formattedAddress
    dropoffLat = geo.lat
    dropoffLng = geo.lng
  }

  // ── Geofence check ─────────────────────────────────────────────────────────
  if (dropoffLat !== undefined && dropoffLng !== undefined) {
    const fence = validateGTALocation(dropoffLat, dropoffLng)
    if (!fence.withinGTA) {
      return (
        `📍 *${dropoffAddress}*\n\n` +
        `${fence.reason} We currently serve Toronto and the surrounding GTA.\n\n` +
        `Please provide a drop-off address within the GTA.`
      )
    }
  }

  const updated: Omit<ConversationState, 'updatedAt'> = {
    ...convo,
    dropoffAddress,
    dropoffLat,
    dropoffLng,
  }

  // Advance to next stage depending on service type
  if (convo.serviceType === 'ride') {
    await upsertConversationState({ ...updated, stage: 'awaiting_pax' })
    return (
      `📍 Drop-off: *${dropoffAddress}*\n\n` +
      `How many *passengers*? (including yourself)`
    )
  } else {
    await upsertConversationState({ ...updated, stage: 'awaiting_pkg_size' })
    return (
      `📍 Drop-off: *${dropoffAddress}*\n\n` +
      `What size is the package?\n\n` +
      `1️⃣  *Small* — fits in a backpack\n` +
      `2️⃣  *Large* — needs both hands\n\n` +
      `Reply *1* or *2*.`
    )
  }
}

async function handlePassengerCount(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const n = parseInt(text, 10)
  if (isNaN(n) || n < 1 || n > 6) {
    return `Please enter a number between 1 and 6.`
  }

  await upsertConversationState({
    ...convo,
    stage: 'awaiting_payment',
    passengerCount: n,
  })

  return paymentPrompt()
}

async function handlePackageSize(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const lower = text.toLowerCase()
  let packageSize: PackageSize | null = null

  if (lower === '1' || lower === 'small') packageSize = 'small'
  else if (lower === '2' || lower === 'large') packageSize = 'large'

  if (!packageSize) {
    return `Please reply *1* for Small or *2* for Large.`
  }

  // Ask about fragile
  await upsertConversationState({
    ...convo,
    stage: 'awaiting_recipient',
    packageSize,
  })

  return (
    `Got it — *${packageSize}* package.\n\n` +
    `Is it fragile? Reply *yes* or *no*.\n` +
    `_(Fragile items get extra care, +$3.00)_`
  )
}

async function handleRecipient(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const lower = text.toLowerCase()

  // First message in this stage is fragile answer
  if (convo.fragile === undefined) {
    const fragile = lower === 'yes' || lower === 'y'
    await upsertConversationState({ ...convo, fragile })
    return `What's the *recipient's name*? (Who should the driver ask for at the drop-off?)`
  }

  // Second message is recipient name
  if (!text || text.length < 2) return `Please enter the recipient's name.`

  await upsertConversationState({
    ...convo,
    stage: 'awaiting_payment',
    recipientName: text,
  })

  return paymentPrompt()
}

async function handlePayment(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const lower = text.toLowerCase()
  let paymentMethod: PaymentMethod | null = null

  if (lower === '1' || lower === 'cash') paymentMethod = 'cash'
  else if (lower === '2' || lower === 'etransfer' || lower === 'e-transfer' || lower === 'e transfer') paymentMethod = 'etransfer'

  if (!paymentMethod) {
    return paymentPrompt()
  }

  // ── Resolve coordinates in parallel (PRT-32) ──────────────────────────────
  // If lat/lng weren't captured (text address entry), geocode both in parallel
  // before fetching the route — cuts latency by ~50% vs sequential calls.
  let pickupCoords = convo.pickupLat && convo.pickupLng
    ? { lat: convo.pickupLat, lng: convo.pickupLng }
    : null
  let dropoffCoords = convo.dropoffLat && convo.dropoffLng
    ? { lat: convo.dropoffLat, lng: convo.dropoffLng }
    : null

  if (!pickupCoords || !dropoffCoords) {
    const [pickupGeo, dropoffGeo] = await Promise.all([
      !pickupCoords ? geocodeAddress(convo.pickupAddress!) : Promise.resolve(null),
      !dropoffCoords ? geocodeAddress(convo.dropoffAddress!) : Promise.resolve(null),
    ])
    if (pickupGeo) pickupCoords = { lat: pickupGeo.lat, lng: pickupGeo.lng }
    if (dropoffGeo) dropoffCoords = { lat: dropoffGeo.lat, lng: dropoffGeo.lng }
  }

  const origin = pickupCoords ?? convo.pickupAddress!
  const destination = dropoffCoords ?? convo.dropoffAddress!

  const route = await getRoute(origin, destination)

  if (!route) {
    return `Sorry, I couldn't calculate the route right now. Could you confirm your addresses are correct?\n\n📍 Pickup: ${convo.pickupAddress}\n📍 Drop-off: ${convo.dropoffAddress}\n\nReply *yes* to retry or type a corrected address.`
  }

  const timeOfDay = getTimeOfDay()
  const fareResult = calculateFare({
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    serviceType: convo.serviceType!,
    timeOfDay,
    heavyTraffic: route.heavyTraffic,
    packageSize: convo.packageSize,
    fragile: convo.fragile,
  })

  await upsertConversationState({
    ...convo,
    stage: 'awaiting_confirm',
    paymentMethod,
    fareResult,
  })

  // Build confirmation summary
  const summary = buildSummary({ ...convo, paymentMethod, fareResult })
  return (
    `Here's your booking summary:\n\n${summary}\n\n` +
    `${formatFareForCustomer(fareResult)}\n\n` +
    `Reply *YES* to confirm or *NO* to cancel.`
  )
}

async function handleConfirm(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const lower = text.toLowerCase()

  if (lower === 'no' || lower === 'cancel') {
    await resetConversation(phone)
    return `Booking cancelled. No problem — message us anytime to start a new booking! 🙏`
  }

  if (lower !== 'yes' && lower !== 'confirm') {
    return `Reply *YES* to confirm your booking or *NO* to cancel.`
  }

  // Create the booking
  const booking = await createBooking({
    customerPhone: phone,
    serviceType: convo.serviceType!,
    pickupAddress: convo.pickupAddress!,
    pickupLat: convo.pickupLat,
    pickupLng: convo.pickupLng,
    dropoffAddress: convo.dropoffAddress!,
    dropoffLat: convo.dropoffLat,
    dropoffLng: convo.dropoffLng,
    fare: convo.fareResult!.total,
    fareBreakdown: convo.fareResult!,
    paymentMethod: convo.paymentMethod!,
    passengerCount: convo.passengerCount,
    packageSize: convo.packageSize,
    fragile: convo.fragile,
    recipientName: convo.recipientName,
    notes: convo.notes,
  })

  // Mark conversation confirmed and notify dispatcher in parallel (PRT-32)
  // These are independent after createBooking — no reason to await sequentially.
  await Promise.all([
    upsertConversationState({ ...convo, stage: 'confirmed' }),
    notifyDispatcher(booking.queueNumber),
  ])

  return (
    `✅ Booking *#${booking.queueNumber}* submitted!\n\n` +
    `We're connecting you with a driver. You'll get a message as soon as it's confirmed.\n\n` +
    `_Estimated: ${formatFareForCustomer(convo.fareResult!)}_`
  )
}

// ─── Dispatcher queue notification ───────────────────────────────────────────

/**
 * Send the dispatcher the pending queue with the new booking highlighted.
 */
async function notifyDispatcher(newQueueNumber: number): Promise<void> {
  const pending = await getPendingBookings()

  const lines = pending.map((b, i) => {
    const isNew = b.queueNumber === newQueueNumber ? ' 🆕' : ''
    const emoji = b.serviceType === 'ride' ? '🚗' : '📦'
    const paxOrPkg = b.serviceType === 'ride'
      ? `${b.passengerCount ?? 1} pax`
      : `${b.packageSize ?? 'small'}${b.fragile ? ' · fragile' : ''}`
    const payment = b.paymentMethod === 'cash' ? 'cash' : 'e-transfer'

    return (
      `${i + 1}️⃣  *#${b.queueNumber}* ${emoji} ${paxOrPkg}${isNew}\n` +
      `    📍 ${b.pickupAddress}\n` +
      `       → ${b.dropoffAddress}\n` +
      `    💰 $${b.fare.toFixed(2)} · ${payment}`
    )
  })

  const queueText = lines.join('\n\n')
  const msg =
    `🔔 New booking request!\n\n` +
    `*Pending queue:*\n\n${queueText}\n\n` +
    `Reply *CONFIRM [#]* or *DECLINE [#]* — e.g. CONFIRM ${newQueueNumber}`

  await sendWhatsApp(`whatsapp:${DISPATCHER_PHONE}`, msg)
}

// ─── Message templates ────────────────────────────────────────────────────────

function greetingMessage(name?: string): string {
  const greeting = name
    ? `Welcome back, *${name}*! 👋`
    : `Hi there! Welcome to *Pronto* 👋`
  return `${greeting}\n\nWe offer fast, on-demand rides and package delivery across the GTA.\n\n${serviceMenuMessage()}`
}

function serviceMenuMessage(): string {
  return (
    `What can we help you with today?\n\n` +
    `1️⃣  *Ride* (ASAP)\n` +
    `2️⃣  *Package delivery*\n\n` +
    `Reply *1* or *2* to get started.`
  )
}

function paymentPrompt(): string {
  return (
    `How would you like to pay?\n\n` +
    `1️⃣  *Cash*\n` +
    `2️⃣  *Interac e-Transfer*\n\n` +
    `Reply *1* or *2*.`
  )
}

function offDutyMessage(): string {
  return (
    `Hi! Thanks for reaching out to *Pronto* 🙏\n\n` +
    `We're not available right now, but we'll be back soon.\n\n` +
    `Feel free to message us again later — we'd love to help! 🚗`
  )
}

function buildSummary(convo: Partial<ConversationState>): string {
  const lines: string[] = []
  const type = convo.serviceType === 'ride' ? '🚗 Ride' : '📦 Package delivery'
  lines.push(`*Service:* ${type}`)
  lines.push(`*Pickup:* ${convo.pickupAddress}`)
  lines.push(`*Drop-off:* ${convo.dropoffAddress}`)

  if (convo.serviceType === 'ride') {
    lines.push(`*Passengers:* ${convo.passengerCount ?? 1}`)
  } else {
    lines.push(`*Package:* ${convo.packageSize}${convo.fragile ? ' (fragile)' : ''}`)
    if (convo.recipientName) lines.push(`*Recipient:* ${convo.recipientName}`)
  }

  lines.push(`*Payment:* ${convo.paymentMethod === 'cash' ? 'Cash' : 'Interac e-Transfer'}`)
  return lines.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalisePhone(from: string): string {
  return from.startsWith('whatsapp:') ? from.slice('whatsapp:'.length) : from
}

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours()
  if ((hour >= 7 && hour < 9) || (hour >= 16 && hour < 19)) return 'peak'
  if (hour >= 22) return 'late'
  return 'normal'
}
