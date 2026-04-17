-- =============================================================================
-- Migration: 20260408000000_customers_and_conversations
-- Description: Customer records and per-customer conversation state
-- PRTs: PRT-18 (greeting/service selection), PRT-19 (booking flow)
-- =============================================================================

-- ─── customers ────────────────────────────────────────────────────────────────

create table if not exists customers (
  phone           text primary key,
  name            text,
  booking_count   int not null default 0,
  incident_count  int not null default 0,
  last_seen       timestamptz not null default now()
);

-- ─── conversation_state ───────────────────────────────────────────────────────
-- One row per customer. Upserted on every message; reset to idle after booking.

create table if not exists conversation_state (
  customer_phone   text primary key references customers (phone),
  stage            text not null default 'idle'
                   check (stage in (
                     'idle',
                     'awaiting_service',
                     'awaiting_pickup',
                     'awaiting_dropoff',
                     'awaiting_pax',
                     'awaiting_pkg_size',
                     'awaiting_recipient',
                     'awaiting_payment',
                     'awaiting_confirm',
                     'confirmed'
                   )),
  service_type     text check (service_type in ('ride', 'package')),
  pickup_address   text,
  pickup_lat       double precision,
  pickup_lng       double precision,
  dropoff_address  text,
  dropoff_lat      double precision,
  dropoff_lng      double precision,
  passenger_count  int,
  package_size     text check (package_size in ('small', 'large')),
  fragile          boolean,
  recipient_name   text,
  notes            text,
  payment_method   text check (payment_method in ('cash', 'etransfer')),
  fare_result      jsonb,
  updated_at       timestamptz not null default now()
);

-- ─── Helper function: increment_booking_count ────────────────────────────────

create or replace function increment_booking_count(customer_phone text)
returns void
language sql
security definer
as $$
  update customers
  set booking_count = booking_count + 1,
      last_seen = now()
  where phone = customer_phone;
$$;

-- ─── Row Level Security ───────────────────────────────────────────────────────

alter table customers enable row level security;
alter table conversation_state enable row level security;
