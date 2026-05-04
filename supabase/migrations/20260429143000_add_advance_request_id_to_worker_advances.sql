alter table public.worker_advances
add column if not exists advance_request_id uuid references public.advance_requests(id) on delete set null;

with parsed as (
  select
    id,
    nullif(
      (
        regexp_match(
          note,
          '\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)'
        )
      )[1],
      ''
    )::uuid as request_id
  from public.worker_advances
  where advance_request_id is null
    and note is not null
    and note like 'Vyplaceno z žádosti o zálohu (%'
),
ranked as (
  select
    id,
    request_id,
    row_number() over (partition by request_id order by id) as row_number
  from parsed
  where request_id is not null
)
update public.worker_advances wa
set advance_request_id = ranked.request_id
from ranked
where wa.id = ranked.id
  and ranked.row_number = 1;

drop index if exists public.worker_advances_advance_request_id_uidx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'worker_advances_advance_request_id_key'
      and conrelid = 'public.worker_advances'::regclass
  ) then
    alter table public.worker_advances
    add constraint worker_advances_advance_request_id_key unique (advance_request_id);
  end if;
end $$;
