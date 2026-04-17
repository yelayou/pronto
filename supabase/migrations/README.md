# Supabase Migrations

Migrations are plain SQL files, numbered by timestamp. Run them in order against your Supabase project using the SQL editor or the Supabase CLI.

## Order

| File | Description |
|---|---|
| `20260401000000_initial_schema.sql` | dispatcher_state, bookings, incidents, queue sequence, RLS |
| `20260408000000_customers_and_conversations.sql` | customers, conversation_state, increment_booking_count() |
| `20260415000000_repeat_offender_flag.sql` | is_repeat_offender() helper function |

## Applying to a new environment

**Via Supabase SQL editor** — paste and run each file in order.

**Via Supabase CLI** (if you set up `supabase link`):
```bash
supabase db push
```

## Notes

- RLS is enabled on all tables. The app uses the **service role key** server-side, which bypasses RLS automatically. No anon/authenticated policies are defined — this is intentional.
- `dispatcher_state` is seeded with a single `OFF DUTY` row (id = 1). All commands UPDATE this row; never INSERT.
- `booking_queue_seq` is a Postgres sequence that auto-increments `queue_number` on every new booking.
