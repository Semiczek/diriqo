alter table public.calculation_items
  add column if not exists vat_rate numeric(5, 2) not null default 21;

alter table public.quote_items
  add column if not exists vat_rate numeric(5, 2) not null default 21;
