-- PRT-46: Optimistic locking on conversation_state
--
-- Two near-simultaneous messages from the same customer race on upserts.
-- Both reads see the same stage, both process, and the second write silently
-- overwrites the first — corrupting state or creating duplicate bookings.
--
-- Adding a version counter lets the second write detect the conflict and drop
-- itself rather than overwriting the first write's result.

ALTER TABLE conversation_state
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Backfill existing rows to start at version 1
UPDATE conversation_state
  SET version = 1
  WHERE version IS NULL;

COMMENT ON COLUMN conversation_state.version IS
  'Optimistic lock counter. Incremented on every update. '
  'Writers must match the current version or the update is rejected (PRT-46).';
