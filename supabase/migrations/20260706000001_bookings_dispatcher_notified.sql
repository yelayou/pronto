-- PRT-45: Partial failure recovery — track whether the dispatcher was notified
--
-- If createBooking() succeeds but the Twilio send to the dispatcher fails,
-- the booking exists as 'pending' but the dispatcher never sees it. The customer
-- is left waiting indefinitely with no recovery path.
--
-- dispatcher_notified tracks whether the initial WhatsApp notification was sent.
-- The QUEUE and ON DUTY commands use this flag to surface un-notified bookings
-- as a built-in recovery mechanism.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS dispatcher_notified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN bookings.dispatcher_notified IS
  'True once the dispatcher WhatsApp notification has been sent successfully. '
  'False means the booking needs recovery — surfaced via QUEUE / ON DUTY (PRT-45).';
