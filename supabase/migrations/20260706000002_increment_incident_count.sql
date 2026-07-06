-- =============================================================================
-- Migration: 20260706000002_increment_incident_count
-- Description: Helper function to atomically increment incident_count (PRT-25)
-- PRTs: PRT-25
-- =============================================================================

create or replace function increment_incident_count(customer_phone text)
returns void
language sql
security definer
as $$
  update customers
  set incident_count = incident_count + 1,
      last_seen = now()
  where phone = customer_phone;
$$;
