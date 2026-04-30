-- PRT-34: Conversation TTL — expire stale conversations after N hours of inactivity
--
-- Customers who start a booking and abandon it should get a fresh start the next
-- time they message, rather than being dropped back into a stale flow.
--
-- expires_at is set on every upsert to conversation_state. The customer handler
-- checks this column on each inbound message and resets the conversation if it
-- has expired. TTL duration is controlled by CONVERSATION_TTL_HOURS (default 2).

ALTER TABLE conversation_state
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
    NOT NULL DEFAULT now() + interval '2 hours';

-- Backfill existing rows so they don't immediately appear expired
UPDATE conversation_state
  SET expires_at = now() + interval '2 hours'
  WHERE expires_at IS NULL;

COMMENT ON COLUMN conversation_state.expires_at IS
  'Conversation resets if a message arrives after this timestamp. '
  'Refreshed on every upsert. Duration controlled by CONVERSATION_TTL_HOURS env var (default 2h).';
