/**
 * Pronto — Dispatcher message handler
 *
 * Receives a parsed dispatcher command and performs the appropriate action.
 * Returns the reply text to send back to the dispatcher via WhatsApp.
 */

import { parseDispatcherCommand } from './commands'
import { setOnDuty, setOffDuty } from '@/lib/supabase/dispatcher'

/**
 * Handle an inbound message from the dispatcher.
 * @param body  Raw WhatsApp message text
 * @returns     Reply text to send back to the dispatcher
 */
export async function handleDispatcherMessage(body: string): Promise<string> {
  const command = parseDispatcherCommand(body)

  switch (command.type) {
    case 'ON_DUTY': {
      await setOnDuty(command.zone)
      return `✅ You're ON DUTY in *${command.zone}*. Bot is active — customers can now book.`
    }

    case 'OFF_DUTY': {
      await setOffDuty()
      return `🔴 You're OFF DUTY. Bot is paused — no new bookings will be accepted.`
    }

    // PRT-17 — remaining commands implemented in next story
    case 'CONFIRM':
    case 'DECLINE':
    case 'ARRIVED':
    case 'COMPLETE':
    case 'NOSHOW':
      return `⚠️ Command received but not yet active. Coming soon.`

    case 'UNKNOWN':
    default:
      return `❓ Unrecognised command: "${command.raw}"\n\nValid commands:\nON DUTY [zone]\nOFF DUTY\nCONFIRM [id]\nDECLINE [id]\nARRIVED\nCOMPLETE\nNOSHOW`
  }
}
