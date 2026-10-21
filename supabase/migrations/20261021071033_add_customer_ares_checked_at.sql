-- Compatibility only: an absent timestamp is not evidence of an ARES lookup.
-- No historical customer values are backfilled or rewritten.
alter table public.customers
  add column if not exists ares_last_checked_at timestamptz null;
