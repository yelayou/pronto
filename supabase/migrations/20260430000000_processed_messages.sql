-- PRT-33: Idempotency check for inbound Twilio messages
--
-- Prevents duplicate booking creation when Twilio or QStash retries a webhook
-- delivery. Before processing any customer message, the worker inserts the
-- Twilio MessageSid here. A unique-violation on INSERT signals a duplicate —
-- the worker returns 200 silently without re-processing.
--
-- TTL: rows expire after 24 hours and can be pruned safely.

CREATE TABLE IF NOT EXISTS processed_messages (
  message_sid   text        PRIMARY KEY,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);

-- Index for efficient pruning of expired rows
CREATE INDEX IF NOT EXISTS processed_messages_expires_at_idx
  ON processed_messages (expires_at);

COMMENT ON TABLE processed_messages IS
  'Idempotency log for inbound Twilio messages. '
  'Rows expire after 24 hours. '
  'Prune with: DELETE FROM processed_messages WHERE expires_at < now().';

COMMENT ON COLUMN processed_messages.message_sid IS
  'Twilio MessageSid — globally unique per message delivery attempt.';

COMMENT ON COLUMN processed_messages.expires_at IS
  'Row is safe to prune after this timestamp. Default 24 hours from insertion.';
