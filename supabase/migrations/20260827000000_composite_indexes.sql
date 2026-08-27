-- =============================================================================
-- Migration: 20260827000000_composite_indexes
-- Description: Composite indexes for high-frequency query patterns (PRT-50)
-- PRTs: PRT-50
--
-- Existing single-column indexes (from initial schema):
--   bookings: queue_number (unique), status, customer_phone
--   incidents: customer_phone, created_at
--
-- These new composite indexes target the query patterns that dominate at volume:
-- =============================================================================

-- (customer_phone, status) on bookings
-- Covers: fetching a customer's pending/active bookings (common in booking flow)
-- EXPLAIN: enables index-only scan instead of filter on the status index
create index if not exists bookings_customer_phone_status_idx
  on bookings (customer_phone, status);

-- (status, created_at DESC) on bookings
-- Covers: getPendingBookings() queue ordering — status='pending' ORDER BY created_at
-- EXPLAIN: avoids a sort step; rows come out in queue order directly from the index
create index if not exists bookings_status_created_at_idx
  on bookings (status, created_at desc);

-- updated_at on conversation_state
-- Covers: TTL expiry checks — WHERE updated_at < now() - interval '2 hours'
-- EXPLAIN: full table scan → index range scan for expired conversation cleanup
create index if not exists conversation_state_updated_at_idx
  on conversation_state (updated_at);

-- (customer_phone, created_at) on incidents
-- Covers: is_repeat_offender() — WHERE customer_phone = ? AND created_at >= now() - 30 days
-- EXPLAIN: replaces seq scan + filter with index range scan; the existing
--   customer_phone_idx only helps with equality, not the date range filter
create index if not exists incidents_customer_phone_created_at_idx
  on incidents (customer_phone, created_at);
