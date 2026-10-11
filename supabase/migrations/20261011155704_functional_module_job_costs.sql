-- Existing job economics keeps actual module costs even when the source module expires.
-- This is a manager-only aggregate, not access to the source module's history/documents.
create function private.job_module_cost_totals(c uuid,requested_jobs uuid[])
returns table(job_id uuid,inventory_amount numeric,fleet_amount numeric,total_amount numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_company_role(c,array['super_admin','company_admin','manager']) then
   raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 if requested_jobs is null or cardinality(requested_jobs)>1000 then raise exception 'INVALID_JOB_SCOPE'; end if;
 return query
 with scoped as (select j.id from public.jobs j where j.company_id=c and j.id=any(requested_jobs)),
 materials as (
   select co.job_id,round(sum(co.quantity*lo.unit_cost_minor)/100,2) amount
   from public.inventory_consumptions co
   join scoped s on s.id=co.job_id
   join public.gastro_stock_lots lo on lo.id=co.lot_id and lo.company_id=c
   join public.gastro_stock_movements m on m.id=co.movement_id and m.company_id=c and m.job_id=co.job_id
   where co.company_id=c group by co.job_id
 ), vehicles as (
   select t.job_id,t.mileage_amount amount from public.fleet_trips t join scoped s on s.id=t.job_id
   where t.company_id=c and t.status in ('approved','locked') and t.cost_method='mileage'
   union all
   select a.job_id,a.amount from public.fleet_cost_allocations a join scoped s on s.id=a.job_id
   join public.fleet_costs f on f.id=a.cost_id and f.company_id=c where a.company_id=c
 ), vehicle_totals as (select v.job_id,sum(v.amount) amount from vehicles v group by v.job_id)
 select s.id,coalesce(m.amount,0),coalesce(v.amount,0),coalesce(m.amount,0)+coalesce(v.amount,0)
 from scoped s left join materials m on m.job_id=s.id left join vehicle_totals v on v.job_id=s.id;
end $$;
revoke all on function private.job_module_cost_totals(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.job_module_cost_totals(uuid,uuid[]) to authenticated;
create function public.job_module_cost_totals(company uuid,job_ids uuid[])
returns table(job_id uuid,inventory_amount numeric,fleet_amount numeric,total_amount numeric)
language sql stable security invoker set search_path='' as $$ select * from private.job_module_cost_totals(company,job_ids); $$;
revoke all on function public.job_module_cost_totals(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.job_module_cost_totals(uuid,uuid[]) to authenticated;
