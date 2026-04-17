-- =============================================================================
-- Migration: 20260401000000_initial_schema
-- Description: Core tables — dispatcher_state, bookings, incidents
-- PRTs: PRT-13 (schema design), PRT-16/17 (dispatcher), PRT-22 (formalise)
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ─── dispatcher_state ─────────────────────────────────────────────────────────
-- Single-row table. id is always 1.

create table if not exists dispatcher_state (
  id             int primary key default 1,
  duty_status    text not null default 'off' check (duty_status in ('on', 'off')),
  current_zone   text,
  current_lat    double precision,
  current_lng    double precision,
  updated_at     timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- Seed the single row so ON DUTY / OFF DUTY can always UPDATE (never INSERT)
insert into dispatcher_state (id, duty_status)
values (1, 'off')
on conflict (id) do nothing;

-- ─── Queue sequence ────────────────────────────────────────────────────────────

create sequence if not exists booking_queue_seq start 1;

-- ─── bookings ─────────────────────────────────────────────────────────────────

create table if not exists bookings (
  id               uuid primary key default gen_random_uuid(),
  queue_number     int not null default nextval('booking_queue_seq'),
  customer_phone   text not null,
  service_type     text not null check (service_type in ('ride', 'package')),
  pickup_address   text not null,
  pickup_lat       double precision,
  pickup_lng       double precision,
  dropoff_address  text not null,
  dropoff_lat      double precision,
  dropoff_lng      double precision,
  fare             numeric(10, 2) not null,
  fare_breakdown   jsonb not null,
  status           text not null default 'pending'
                   check (status in ('pending','confirmed','en_route','arrived','complete','declined','noshow','cancelled')),
  payment_method   text not null check (payment_method in ('cash', 'etransfer')),
  passenger_count  int,
  package_size     text check (package_size in ('small', 'large')),
  fragile          boolean not null default false,
  recipient_name   text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists bookings_queue_number_idx on bookings (queue_number);
create index if not exists bookings_status_idx on bookings (status);
create index if not exists bookings_customer_phone_idx on bookings (customer_phone);

-- ─── incidents ────────────────────────────────────────────────────────────────

create table if not exists incidents (
  id               uuid primary key default gen_random_uuid(),
  customer_phone   text not null,
  booking_id       uuid not null references bookings (id),
  type             text not null check (type in ('noshow', 'cancel')),
  fee_amount       numeric(10, 2) not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists incidents_customer_phone_idx on incidents (customer_phone);
create index if not exists incidents_created_at_idx on incidents (created_at);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS on all tables. The service role key (used server-side) bypasses
-- RLS automatically. No additional policies are added — this blocks all access
-- from the anon / authenticated roles, which is intentional: no client-side DB
-- access should ever occur.

alter table dispatcher_state enable row level security;
alter table bookings enable row level security;
alter table incidents enable row level security;
