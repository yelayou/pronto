/**
 * Pronto — Dispatcher message handler
 *
 * Receives a parsed dispatcher command and performs the appropriate action.
 * Returns the reply text to send back to the dispatcher via WhatsApp.
 */

import { parseDispatcherCommand } from './commands'
import { setOnDuty, setOffDuty } from '@/lib/supabase/dispatcher'
import {
  getBookingByQueueNumber,
  getActiveBooking,
  getPendingBookings,
  updateBookingStatus,
  logIncident,
} from '@/lib/supabase/bookings'
import { sendWhatsApp } from '@/lib/twilio/client'
import { resetConversation } from '@/lib/supabase/conversations'

const NOSHOW_FEE = 5.00

/**
 * Handle an inbound message from the dispatcher.
 * @param body  Raw WhatsApp message text
 * @returns     Reply text to send back to the dispatcher
 */
export async function handleDispatcherMessage(body: string): Promise<string> {
  const command = parseDispatcherCommand(body)

  switch (command.type) {

    // ── Duty status ────────────────────────────────────────────────────────────

    case 'ON_DUTY': {
      await setOnDuty(command.zone)
      return `✅ You're ON DUTY in *${command.zone}*. Bot is active — customers can now book.`
    }

    case 'OFF_DUTY': {
      await setOffDuty()
      return `🔴 You're OFF DUTY. Bot is paused — no new bookings will be accepted.`
    }

    // ── Booking lifecycle ──────────────────────────────────────────────────────

    case 'CONFIRM': {
      const booking = await getBookingByQueueNumber(command.queueNumber)
      if (!booking) return `❌ Booking *#${command.queueNumber}* not found.`
      if (booking.status !== 'pending') {
        return `⚠️ Booking *#${command.queueNumber}* is already *${booking.status}*.`
      }

      await updateBookingStatus(booking.id, 'confirmed')

      await sendWhatsApp(
        booking.customerPhone,
        `✅ Your booking is confirmed! Your driver is on the way to *${booking.pickupAddress}*.\n\nWe'll notify you when they arrive. 🚗`
      )

      // Show remaining queue after confirming
      const remaining = await getPendingBookings()
      const queueSuffix = remaining.length > 0
        ? `\n\n*${remaining.length} booking(s) still pending:*\n` + remaining.map((b, i) =>
            `${i + 1}️⃣  *#${b.queueNumber}* — ${b.serviceType === 'ride' ? '🚗' : '📦'} ${b.pickupAddress} → ${b.dropoffAddress}`
          ).join('\n')
        : `\n\nNo more pending bookings.`

      return `✅ Confirmed *#${command.queueNumber}*. Customer notified.${queueSuffix}`
    }

    case 'DECLINE': {
      const booking = await getBookingByQueueNumber(command.queueNumber)
      if (!booking) return `❌ Booking *#${command.queueNumber}* not found.`
      if (booking.status !== 'pending') {
        return `⚠️ Booking *#${command.queueNumber}* is already *${booking.status}*.`
      }

      await updateBookingStatus(booking.id, 'declined')
      await resetConversation(booking.customerPhone)

      await sendWhatsApp(
        booking.customerPhone,
        `Sorry, we're unable to accept your booking at this time. Please try again in a few minutes. 🙏`
      )

      const remaining = await getPendingBookings()
      const queueSuffix = remaining.length > 0
        ? `\n\n*${remaining.length} booking(s) still pending:*\n` + remaining.map((b, i) =>
            `${i + 1}️⃣  *#${b.queueNumber}* — ${b.serviceType === 'ride' ? '🚗' : '📦'} ${b.pickupAddress} → ${b.dropoffAddress}`
          ).join('\n')
        : `\n\nNo more pending bookings.`

      return `🚫 Declined *#${command.queueNumber}*. Customer notified.${queueSuffix}`
    }

    case 'ARRIVED': {
      const booking = await getActiveBooking()
      if (!booking) return `❌ No active booking found. Has a booking been confirmed?`

      await updateBookingStatus(booking.id, 'arrived')

      const paymentMsg = booking.paymentMethod === 'cash'
        ? `Your driver has arrived! Please pay *$${booking.fare.toFixed(2)}* (HST included) in *cash* 💵`
        : `Your driver has arrived! Please send *$${booking.fare.toFixed(2)}* (HST included) via *Interac e-Transfer* to:\n${process.env.ETRANSFER_LINK ?? 'your dispatcher'} 💸`

      await sendWhatsApp(booking.customerPhone, paymentMsg)

      return `📍 Marked as ARRIVED for booking *${booking.id.slice(0, 8)}*. Payment instructions sent to customer.`
    }

    case 'COMPLETE': {
      const booking = await getActiveBooking()
      if (!booking) return `❌ No active booking found.`
      if (booking.status !== 'arrived') {
        return `⚠️ Current booking status is *${booking.status}* — send ARRIVED first.`
      }

      await updateBookingStatus(booking.id, 'complete')
      await resetConversation(booking.customerPhone)

      await sendWhatsApp(
        booking.customerPhone,
        `Thank you for riding with Pronto! 🚗 Have a great day. Book again anytime by messaging us here.`
      )

      return `✅ Booking *#${booking.queueNumber}* marked COMPLETE. Ride closed.`
    }

    case 'NOSHOW': {
      const booking = await getActiveBooking()
      if (!booking) return `❌ No active booking found.`

      await updateBookingStatus(booking.id, 'noshow')
      await logIncident(booking.customerPhone, booking.id, 'noshow', NOSHOW_FEE)
      await resetConversation(booking.customerPhone)

      await sendWhatsApp(
        booking.customerPhone,
        `We noticed you weren't at the pickup location. A *$${NOSHOW_FEE.toFixed(2)} no-show fee* has been applied to your account. If this was a mistake, reply to this message.`
      )

      return `⚠️ NOSHOW logged for booking *${booking.id.slice(0, 8)}*. $${NOSHOW_FEE.toFixed(2)} fee notice sent to customer.`
    }

    // ── Fallback ───────────────────────────────────────────────────────────────

    case 'UNKNOWN':
    default:
      return `❓ Unrecognised command: "${command.raw}"\n\nValid commands:\nON DUTY [zone]\nOFF DUTY\nCONFIRM [#]\nDECLINE [#]\nARRIVED\nCOMPLETE\nNOSHOW`
  }
}
