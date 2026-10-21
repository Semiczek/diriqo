-- Local runner creates customer_before before applying the real migration.
-- Works both when the column was absent and when timestamps already existed.
do $test$
begin
  assert (select count(*) from public.customers)=(select count(*) from customer_before),
    'customer_count_preserved';
  assert not exists (
    select 1 from customer_before b full join public.customers c on c.id=b.id
    where b.id is null or c.id is null
      or (to_jsonb(c)-'ares_last_checked_at') is distinct from (b.row_data-'ares_last_checked_at')
  ),'all_existing_customer_fields_preserved';
  assert not exists (
    select 1 from customer_before b join public.customers c on c.id=b.id
    where to_jsonb(c)->'ares_last_checked_at' is distinct from coalesce(b.row_data->'ares_last_checked_at','null'::jsonb)
  ),'missing_timestamp_stays_null_existing_timestamp_preserved';
  assert exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='customers' and column_name='ares_last_checked_at'
      and data_type='timestamp with time zone' and is_nullable='YES' and column_default is null
  ),'nullable_timestamptz_without_default';
end;
$test$;
