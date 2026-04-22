/**
 * Pronto — Customer message handler (PRT-66)
 *
 * Refactored from a rigid keyword state machine to a Claude NLU-driven
 * conversational handler. Key changes:
 *
 *  - Every message goes through extractIntent() — fields are captured
 *    opportunistically rather than one-per-prompt
 *  - Greetings are dynamic via buildGreeting() (holiday/season/time aware)
 *  - Ambiguous landmarks (Pearson, Union Station, Billy Bishop) trigger a
 *    sub-location prompt via the awaiting_landmark stage
 *  - Booking confirmation is a single prose summary with ±5% fare range
 *
 * PRT-62: greeting system
 * PRT-63: NLU intent extraction
 * PRT-64: landmark lookup table
 * PRT-65: pendingLandmark type + Supabase schema
 * PRT-66: this handler refactor
 * PRT-67: prose confirmation summary (implemented here)
 */

import { getDispatcherState } from '@/lib/supabase/dispatcher'
import { getCustomer, upsertCustomer, updateCustomerName } from '@/lib/supabase/customers'
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
import { buildGreeting } from '@/lib/customer/greetings'
import { extractIntent } from '@/lib/customer/intent'
import { findLandmark, getLandmarkOption } from '@/lib/landmarks'
import type {
  ConversationState,
  ConversationStage,
  TimeOfDay,
  PendingLandmark,
} from '@/types'

const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE!

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Handle an inbound message from a customer.
 * @param from  Customer WhatsApp number (e.g. "whatsapp:+14165550123")
 * @param body  Raw message text
 * @param lat   Latitude if customer shared a location pin
 * @param lng   Longitude if customer shared a location pin
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

  // ── 1. Dispatcher duty check ───────────────────────────────────────────────
  const dispatcher = await getDispatcherState()
  if (!dispatcher || dispatcher.dutyStatus === 'off') {
    return offDutyMessage()
  }

  // ── 2. Customer record ─────────────────────────────────────────────────────
  const customer = await upsertCustomer(phone)

  // ── 3. Conversation state ──────────────────────────────────────────────────
  const convo = await getConversationState(phone)

  // ── 4. Fresh / idle start ─────────────────────────────────────────────────
  if (!convo || convo.stage === 'idle') {
    if (!customer.name) {
      await upsertConversationState({ customerPhone: phone, stage: 'awaiting_name' })
      const greeting = buildGreeting(undefined, phone)
      return `${greeting}\n\nBefore we get started, what's your name?`
    }
    await upsertConversationState({ customerPhone: phone, stage: 'awaiting_service' })
    return `${buildGreeting(customer.name, phone)}\n\n${serviceMenuMessage()}`
  }

  // ── 5. First-time name collection ──────────────────────────────────────────
  if (convo.stage === 'awaiting_name') {
    return handleNameCollection(phone, text, convo)
  }

  // ── 6. Already confirmed — gentle nudge ───────────────────────────────────
  if (convo.stage === 'confirmed') {
    return `Your booking is confirmed and waiting for the driver. We'll message you as soon as it's accepted! 🙏`
  }

  // ── 7. Landmark disambiguation — waiting for sub-location choice ───────────
  if (convo.stage === 'awaiting_landmark' && convo.pendingLandmark) {
    return handleLandmarkResolution(phone, text, convo, isPin, lat, lng)
  }

  // ── 8. Awaiting booking confirmation ──────────────────────────────────────
  if (convo.stage === 'awaiting_confirm') {
    return handleConfirmation(phone, text, convo, customer.name)
  }

  // ── 9. All other stages — run NLU extraction ──────────────────────────────
  return handleWithNLU(phone, text, convo, customer.name, isPin, lat, lng)
}

// ─── Stage handlers ───────────────────────────────────────────────────────────

async function handleNameCollection(
  phone: string,
  text: string,
  convo: ConversationState
): Promise<string> {
  const name = text.trim()
  if (!name || name.length < 2) {
    return `Sorry, I didn't catch that! What's your name?`
  }

  await Promise.all([
    updateCustomerName(phone, name),
    upsertConversationState({ ...convo, stage: 'awaiting_service' }),
  ])

  return (
    `Nice to meet you, *${name}*! 🙌\n\n` +
    `We offer fast, on-demand rides and package delivery across the GTA.\n\n` +
    serviceMenuMessage()
  )
}

/**
 * Resolve the customer's sub-location choice for an ambiguous landmark.
 * Handles both numbered options ("1", "2") and location pin sharing.
 */
async function handleLandmarkResolution(
  phone: string,
  text: string,
  convo: ConversationState,
  isPin: boolean,
  lat?: number,
  lng?: number
): Promise<string> {
  const pending = convo.pendingLandmark!

  // Customer shared a location pin — use it directly
  if (isPin && lat !== undefined && lng !== undefined) {
    const address = await reverseGeocode(lat, lng)
    const updated =
      pending.field === 'pickup'
        ? { ...convo, pickupAddress: address, pickupLat: lat, pickupLng: lng }
        : { ...convo, dropoffAddress: address, dropoffLat: lat, dropoffLng: lng }

    const nextStage = computeNextStage({ ...updated, pendingLandmark: undefined })
    await upsertConversationState({ ...updated, stage: nextStage, pendingLandmark: undefined })
    return nextPromptForStage(nextStage, updated)
  }

  // Parse numbered option ("1", "2", "3")
  const optionIndex = parseInt(text.trim(), 10) - 1
  const option = getLandmarkOption(pending.landmarkId, optionIndex)

  if (!option) {
    const landmark = findLandmark(pending.landmarkId)
    const optionCount = landmark?.options.length ?? 2
    return `Please reply with a number (1–${optionCount}) to choose a spot, or share your 📍 location pin.`
  }

  const updated =
    pending.field === 'pickup'
      ? { ...convo, pickupAddress: option.label, pickupLat: option.lat, pickupLng: option.lng }
      : { ...convo, dropoffAddress: option.label, dropoffLat: option.lat, dropoffLng: option.lng }

  const nextStage = computeNextStage({ ...updated, pendingLandmark: undefined })
  await upsertConversationState({ ...updated, stage: nextStage, pendingLandmark: undefined })

  const pinLabel = pending.field === 'pickup'
    ? `📍 Pickup set to *${option.label}*`
    : `📍 Drop-off set to *${option.label}*`

  return `${pinLabel}\n\n${nextPromptForStage(nextStage, updated)}`
}

/**
 * NLU-driven handler for all non-special stages.
 * Extracts fields from the message, merges into conversation state,
 * checks for landmark disambiguation, and advances to the furthest possible stage.
 */
async function handleWithNLU(
  phone: string,
  text: string,
  convo: ConversationState,
  customerName: string | undefined,
  isPin: boolean,
  lat?: number,
  lng?: number
): Promise<string> {
  // Location pin — handle directly without NLU
  if (isPin && lat !== undefined && lng !== undefined) {
    return handleLocationPin(phone, lat, lng, convo)
  }

  // Run Claude NLU extraction
  const intent = await extractIntent(text, convo, customerName)

  // Merge extracted fields into conversation state
  const merged: Omit<ConversationState, 'updatedAt'> = {
    ...convo,
    ...(intent.serviceType && { serviceType: intent.serviceType }),
    ...(intent.pickupAddress && { pickupAddress: intent.pickupAddress, pickupLat: undefined, pickupLng: undefined }),
    ...(intent.dropoffAddress && { dropoffAddress: intent.dropoffAddress, dropoffLat: undefined, dropoffLng: undefined }),
    ...(intent.passengerCount !== undefined && { passengerCount: intent.passengerCount }),
    ...(intent.packageSize && { packageSize: intent.packageSize }),
    ...(intent.fragile !== undefined && { fragile: intent.fragile }),
    ...(intent.recipientName && { recipientName: intent.recipientName }),
    ...(intent.paymentMethod && { paymentMethod: intent.paymentMethod }),
  }

  // Landmark disambiguation
  if (intent.needsDisambiguation && intent.disambiguationField && intent.landmarkId) {
    const landmark = findLandmark(intent.landmarkId)
    if (landmark) {
      const pendingLandmark: PendingLandmark = {
        field: intent.disambiguationField,
        landmarkId: intent.landmarkId,
      }
      await upsertConversationState({ ...merged, stage: 'awaiting_landmark', pendingLandmark })
      return landmark.prompt
    }
  }

  // Advance to furthest possible stage
  const nextStage = computeNextStage(merged)

  if (nextStage === 'awaiting_confirm') {
    return buildAndShowConfirmation(phone, merged)
  }

  await upsertConversationState({ ...merged, stage: nextStage })
  return nextPromptForStage(nextStage, merged)
}

/**
 * Handle a WhatsApp location pin at any pickup/dropoff stage.
 */
async function handleLocationPin(
  phone: string,
  lat: number,
  lng: number,
  convo: ConversationState
): Promise<string> {
  const fence = validateGTALocation(lat, lng)
  if (!fence.withinGTA) {
    return (
      `${fence.reason} We currently serve Toronto and the surrounding GTA.\n\n` +
      `Please provide an address or share a location pin within the GTA.`
    )
  }

  const address = await reverseGeocode(lat, lng)
  const needsPickup = !convo.pickupAddress || convo.stage === 'awaiting_pickup' || convo.stage === 'awaiting_service'

  const merged = needsPickup
    ? { ...convo, pickupAddress: address, pickupLat: lat, pickupLng: lng }
    : { ...convo, dropoffAddress: address, dropoffLat: lat, dropoffLng: lng }

  const nextStage = computeNextStage(merged)

  if (nextStage === 'awaiting_confirm') {
    return buildAndShowConfirmation(phone, merged)
  }

  await upsertConversationState({ ...merged, stage: nextStage })

  const pinLabel = needsPickup ? 'Pickup' : 'Drop-off'
  return `📍 ${pinLabel}: *${address}*\n\n${nextPromptForStage(nextStage, merged)}`
}

/**
 * Interpret natural language confirmation, correction, or cancellation.
 */
async function handleConfirmation(
  phone: string,
  text: string,
  convo: ConversationState,
  customerName: string | undefined
): Promise<string> {
  const intent = await extractIntent(text, convo, customerName)

  if (intent.confirmationIntent === 'cancel') {
    await resetConversation(phone)
    return `Booking cancelled. No problem — message us anytime to start a new one! 🙏`
  }

  if (intent.confirmationIntent === 'confirm') {
    return submitBooking(phone, convo)
  }

  if (intent.confirmationIntent === 'correction') {
    const updated: Omit<ConversationState, 'updatedAt'> = {
      ...convo,
      ...(intent.serviceType && { serviceType: intent.serviceType }),
      ...(intent.pickupAddress && { pickupAddress: intent.pickupAddress, pickupLat: undefined, pickupLng: undefined }),
      ...(intent.dropoffAddress && { dropoffAddress: intent.dropoffAddress, dropoffLat: undefined, dropoffLng: undefined }),
      ...(intent.passengerCount !== undefined && { passengerCount: intent.passengerCount }),
      ...(intent.packageSize && { packageSize: intent.packageSize }),
      ...(intent.fragile !== undefined && { fragile: intent.fragile }),
      ...(intent.recipientName && { recipientName: intent.recipientName }),
      ...(intent.paymentMethod && { paymentMethod: intent.paymentMethod }),
    }
    return buildAndShowConfirmation(phone, updated)
  }

  // Unclear — re-show summary
  return (
    buildProseSummary(convo) +
    `\n\nDoes that look right? Just say *yes* to confirm or let me know what to change.`
  )
}

// ─── Confirmation summary & booking creation ──────────────────────────────────

/**
 * Geocode addresses (if needed), calculate fare, save state, and return prose summary.
 */
async function buildAndShowConfirmation(
  phone: string,
  convo: Omit<ConversationState, 'updatedAt'>
): Promise<string> {
  let pickupCoords =
    convo.pickupLat && convo.pickupLng ? { lat: convo.pickupLat, lng: convo.pickupLng } : null
  let dropoffCoords =
    convo.dropoffLat && convo.dropoffLng ? { lat: convo.dropoffLat, lng: convo.dropoffLng } : null

  if (!pickupCoords || !dropoffCoords) {
    const [pickupGeo, dropoffGeo] = await Promise.all([
      !pickupCoords && convo.pickupAddress ? geocodeAddress(convo.pickupAddress) : Promise.resolve(null),
      !dropoffCoords && convo.dropoffAddress ? geocodeAddress(convo.dropoffAddress) : Promise.resolve(null),
    ])
    if (pickupGeo) {
      pickupCoords = { lat: pickupGeo.lat, lng: pickupGeo.lng }
      convo = { ...convo, pickupLat: pickupGeo.lat, pickupLng: pickupGeo.lng }
    }
    if (dropoffGeo) {
      dropoffCoords = { lat: dropoffGeo.lat, lng: dropoffGeo.lng }
      convo = { ...convo, dropoffLat: dropoffGeo.lat, dropoffLng: dropoffGeo.lng }
    }
  }

  if (!pickupCoords || !dropoffCoords) {
    return (
      `I couldn't resolve one of the addresses. Could you double-check?\n\n` +
      `📍 Pickup: ${convo.pickupAddress ?? 'not set'}\n` +
      `📍 Drop-off: ${convo.dropoffAddress ?? 'not set'}\n\n` +
      `You can also share a 📍 location pin for a precise spot.`
    )
  }

  const route = await getRoute(pickupCoords, dropoffCoords)
  if (!route) {
    return (
      `Sorry, I couldn't calculate the route right now. Could you confirm your addresses?\n\n` +
      `📍 Pickup: ${convo.pickupAddress}\n📍 Drop-off: ${convo.dropoffAddress}\n\n` +
      `Reply *yes* to retry or type a corrected address.`
    )
  }

  const fareResult = calculateFare({
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    serviceType: convo.serviceType!,
    timeOfDay: getTimeOfDay(),
    heavyTraffic: route.heavyTraffic,
    packageSize: convo.packageSize,
    fragile: convo.fragile,
  })

  const updated: Omit<ConversationState, 'updatedAt'> = { ...convo, stage: 'awaiting_confirm', fareResult }
  await upsertConversationState(updated)

  return (
    buildProseSummary({ ...updated, updatedAt: '' }) +
    `\n\nDoes that look right? Say *yes* to confirm or let me know what to change.`
  )
}

/**
 * Build the single prose confirmation message (PRT-67).
 */
function buildProseSummary(convo: ConversationState): string {
  const type = convo.serviceType === 'ride' ? 'ride' : 'package delivery'
  const pickup = convo.pickupAddress ?? 'unknown pickup'
  const dropoff = convo.dropoffAddress ?? 'unknown drop-off'

  let details = ''
  if (convo.serviceType === 'ride') {
    const pax = convo.passengerCount ?? 1
    details = `${pax} ${pax === 1 ? 'passenger' : 'passengers'}`
  } else {
    const size = convo.packageSize ?? 'small'
    const fragileLabel = convo.fragile ? ', fragile' : ''
    const recipientLabel = convo.recipientName ? ` for *${convo.recipientName}*` : ''
    details = `${size} package${fragileLabel}${recipientLabel}`
  }

  const payment = convo.paymentMethod === 'cash' ? 'cash' : 'Interac e-Transfer'
  const fareStr = convo.fareResult
    ? ` — estimated *$${convo.fareResult.rangeL.toFixed(2)}–$${convo.fareResult.rangeH.toFixed(2)}* (HST included)`
    : ''

  return (
    `Here's what I've got: *${type}* from *${pickup}* to *${dropoff}*, ` +
    `${details}, paying ${payment}${fareStr}.`
  )
}

async function submitBooking(phone: string, convo: ConversationState): Promise<string> {
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

// ─── Stage computation ────────────────────────────────────────────────────────

function computeNextStage(
  convo: Partial<Omit<ConversationState, 'updatedAt'>>
): ConversationStage {
  if (!convo.serviceType) return 'awaiting_service'
  if (!convo.pickupAddress) return 'awaiting_pickup'
  if (!convo.dropoffAddress) return 'awaiting_dropoff'

  if (convo.serviceType === 'ride') {
    if (!convo.passengerCount) return 'awaiting_pax'
  } else {
    if (!convo.packageSize) return 'awaiting_pkg_size'
    if (convo.fragile === undefined) return 'awaiting_recipient'
    if (!convo.recipientName) return 'awaiting_recipient'
  }

  if (!convo.paymentMethod) return 'awaiting_payment'
  return 'awaiting_confirm'
}

function nextPromptForStage(
  stage: ConversationStage,
  convo: Partial<Omit<ConversationState, 'updatedAt'>>
): string {
  switch (stage) {
    case 'awaiting_service':
      return serviceMenuMessage()
    case 'awaiting_pickup':
      return convo.serviceType === 'ride'
        ? `🚗 Great! What's the *pickup address*? Type an address or share your 📍 location.`
        : `📦 Got it! What's the *pickup address* (where we're collecting from)? Type an address or share your 📍 location.`
    case 'awaiting_dropoff':
      return `📍 Pickup: *${convo.pickupAddress}*\n\nNow, what's the *drop-off address*? Type an address or share your 📍 location.`
    case 'awaiting_pax':
      return `📍 Drop-off: *${convo.dropoffAddress}*\n\nHow many *passengers*? (including yourself)`
    case 'awaiting_pkg_size':
      return (
        `📍 Drop-off: *${convo.dropoffAddress}*\n\n` +
        `What size is the package?\n\n` +
        `1️⃣  *Small* — fits in a backpack\n` +
        `2️⃣  *Large* — needs both hands`
      )
    case 'awaiting_recipient':
      if (convo.fragile === undefined) {
        return `Is the package fragile? _(We'll handle it with extra care, +$3.00)_`
      }
      return `What's the *recipient's name*? (Who should the driver ask for at drop-off?)`
    case 'awaiting_payment':
      return paymentPrompt()
    default:
      return `Got it! Anything else?`
  }
}

// ─── Dispatcher notification ──────────────────────────────────────────────────

async function notifyDispatcher(newQueueNumber: number): Promise<void> {
  const [pending, dispatcher] = await Promise.all([
    getPendingBookings(),
    getDispatcherState(),
  ])

  const newBooking = pending.find(b => b.queueNumber === newQueueNumber)
  const customer = newBooking ? await getCustomer(newBooking.customerPhone) : null

  const lines = pending.map((b, i) => {
    const isNew = b.queueNumber === newQueueNumber
    const emoji = b.serviceType === 'ride' ? '🚗' : '📦'
    const paxOrPkg = b.serviceType === 'ride'
      ? `${b.passengerCount ?? 1} pax`
      : `${b.packageSize ?? 'small'}${b.fragile ? ' · fragile' : ''}`
    const payment = b.paymentMethod === 'cash' ? 'cash' : 'e-transfer'
    const customerLine = isNew && customer?.name ? `\n    👤 ${customer.name}` : ''

    let priorityLine = ''
    if (isNew) {
      if (dispatcher?.currentLat && dispatcher?.currentLng && b.pickupLat && b.pickupLng) {
        const km = haversineKm(dispatcher.currentLat, dispatcher.currentLng, b.pickupLat, b.pickupLng)
        priorityLine = `\n    📏 ~${km.toFixed(1)} km from you`
      } else if (dispatcher?.currentZone) {
        priorityLine = `\n    🗺️ Zone: ${dispatcher.currentZone}`
      }
    }

    return (
      `${i + 1}️⃣  *#${b.queueNumber}* ${emoji} ${paxOrPkg}${isNew ? ' 🆕' : ''}` +
      customerLine + priorityLine +
      `\n    📍 ${b.pickupAddress}\n` +
      `       → ${b.dropoffAddress}\n` +
      `    💰 $${b.fare.toFixed(2)} · ${payment}`
    )
  })

  const msg =
    `🔔 New booking request!\n\n` +
    `*Pending queue:*\n\n${lines.join('\n\n')}\n\n` +
    `Reply *CONFIRM [#]* or *DECLINE [#]* — e.g. CONFIRM ${newQueueNumber}`

  await sendWhatsApp(`whatsapp:${DISPATCHER_PHONE}`, msg)
}

// ─── Haversine distance ───────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (deg: number) => deg * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Message templates ────────────────────────────────────────────────────────

function serviceMenuMessage(): string {
  return (
    `What can we help you with today?\n\n` +
    `1️⃣  *Ride* — get picked up ASAP\n` +
    `2️⃣  *Package delivery*\n\n` +
    `Just tell me what you need — no need to reply with a number!`
  )
}

function paymentPrompt(): string {
  return (
    `How would you like to pay?\n\n` +
    `💵  *Cash* — pay the driver directly\n` +
    `📲  *Interac e-Transfer*\n\n` +
    `Just say "cash" or "e-transfer"!`
  )
}

function offDutyMessage(): string {
  return (
    `Hi! Thanks for reaching out to *Pronto* 🙏\n\n` +
    `We're not available right now, but we'll be back soon.\n\n` +
    `Feel free to message us again later — we'd love to help! 🚗`
  )
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
