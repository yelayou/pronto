-- =============================================================================
-- Migration: 20260415000000_repeat_offender_flag
-- Description: Helper function to detect repeat offenders (PRT-25)
--              Returns true if customer has 2+ incidents in the last 30 days.
-- PRTs: PRT-25
-- =============================================================================

create or replace function is_repeat_offender(p_customer_phone text)
returns boolean
language sql
stable
security definer
as $$
  select count(*) >= 2
  from incidents
  where customer_phone = p_customer_phone
    and created_at >= now() - interval '30 days';
$$;
