-- PRT-65: Add pending_landmark column to conversation_state
--
-- Stores mid-disambiguation state when a customer names an ambiguous landmark
-- (e.g. "Pearson", "Union Station") and we are waiting for their sub-location
-- choice. Cleared once the customer picks an option or shares a location pin.
--
-- Schema: { field: 'pickup' | 'dropoff', landmarkId: string }

ALTER TABLE conversation_state
  ADD COLUMN IF NOT EXISTS pending_landmark jsonb DEFAULT NULL;

COMMENT ON COLUMN conversation_state.pending_landmark IS
  'Set while awaiting landmark sub-location choice. '
  'Shape: { field: ''pickup'' | ''dropoff'', landmarkId: string }. '
  'Cleared on resolution or conversation reset.';
