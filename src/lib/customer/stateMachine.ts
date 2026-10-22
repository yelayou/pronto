import type { ConversationStage } from '@/types'

// ─── Error ────────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  readonly from: ConversationStage
  readonly to: ConversationStage

  constructor(from: ConversationStage, to: ConversationStage) {
    super(`Invalid stage transition: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

// ─── Transition map ───────────────────────────────────────────────────────────

/**
 * Exhaustive list of legal stage advances.
 *
 * Design rules:
 *  - Forward jumps are allowed: NLU can capture multiple fields in one message
 *    and skip stages (e.g. awaiting_service → awaiting_payment in one turn).
 *  - Self-transitions are allowed: if the customer's reply doesn't move the
 *    flow forward, computeNextStage returns the same stage.
 *  - Backward transitions are NOT allowed: prevents bug-driven regressions
 *    (e.g. awaiting_payment → awaiting_pickup).
 *  - awaiting_landmark is a side-step: can be entered from most pickup/dropoff
 *    stages and exits forward (never backward) once resolved.
 *  - confirmed is terminal: no transitions out.
 */
export const ALLOWED_TRANSITIONS: Record<ConversationStage, ConversationStage[]> = {
  idle: [
    'awaiting_name',
    'awaiting_service',
  ],
  awaiting_name: [
    'awaiting_service',
  ],
  awaiting_service: [
    'awaiting_service',
    'awaiting_pickup',
    'awaiting_dropoff',
    'awaiting_pax',
    'awaiting_pkg_size',
    'awaiting_recipient',
    'awaiting_payment',
    'awaiting_confirm',
    'awaiting_landmark',
  ],
  awaiting_pickup: [
    'awaiting_pickup',
    'awaiting_dropoff',
    'awaiting_pax',
    'awaiting_pkg_size',
    'awaiting_recipient',
    'awaiting_payment',
    'awaiting_confirm',
    'awaiting_landmark',
  ],
  awaiting_dropoff: [
    'awaiting_dropoff',
    'awaiting_pax',
    'awaiting_pkg_size',
    'awaiting_recipient',
    'awaiting_payment',
    'awaiting_confirm',
    'awaiting_landmark',
  ],
  awaiting_landmark: [
    'awaiting_dropoff',
    'awaiting_pax',
    'awaiting_pkg_size',
    'awaiting_recipient',
    'awaiting_payment',
    'awaiting_confirm',
  ],
  awaiting_pax: [
    'awaiting_pax',
    'awaiting_payment',
    'awaiting_confirm',
    'awaiting_landmark',
  ],
  awaiting_pkg_size: [
    'awaiting_pkg_size',
    'awaiting_recipient',
    'awaiting_payment',
    'awaiting_confirm',
    'awaiting_landmark',
  ],
  awaiting_recipient: [
    'awaiting_recipient',
    'awaiting_payment',
    'awaiting_confirm',
    'awaiting_landmark',
  ],
  awaiting_payment: [
    'awaiting_payment',
    'awaiting_confirm',
    'awaiting_landmark',
  ],
  awaiting_confirm: [
    'awaiting_confirm',
    'confirmed',
  ],
  confirmed: [],
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Assert that a stage transition is legal.
 * Throws InvalidTransitionError if not in the allowed-transitions map.
 */
export function assertValidTransition(from: ConversationStage, to: ConversationStage): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to)
  }
}
