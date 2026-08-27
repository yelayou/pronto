-- =============================================================================
-- Migration: 20260827000001_geocode_cache
-- Description: Geocode result cache table with 7-day TTL (PRT-38)
-- =============================================================================

create table if not exists geocode_cache (
  address_key       text        primary key,         -- normalised address (lowercase trimmed)
  lat               double precision not null,
  lng               double precision not null,
  formatted_address text        not null,
  cached_at         timestamptz not null default now()
);

-- Index to efficiently sweep expired entries (WHERE cached_at < now() - interval '7 days')
create index if not exists geocode_cache_cached_at_idx
  on geocode_cache (cached_at);

alter table geocode_cache enable row level security;

-- Service role bypasses RLS — no additional policies needed for server-side access.
