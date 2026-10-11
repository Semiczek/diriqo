-- Additive foundation for real domain modules. No paid licence or price is created.
alter table private.company_module_rollouts drop constraint company_module_rollouts_product_check;
alter table private.company_module_rollouts add constraint company_module_rollouts_product_check
  check (product in ('diriqo_core','inventory','invoicing','smart_quotes','fleet','ai_assistant','pos'));
insert into private.company_module_rollouts(company_id,product,livemode)
select distinct company_id,product,false from private.company_test_module_grants
where product in ('ai_assistant','pos') and revoked_at is null
on conflict (company_id,product) do nothing;

-- Internal decision only: never an externally callable permission oracle.
create function private.module_raw_entitlement(c uuid,p text,cap text default null,r uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from (
      select product,register_id,valid_from,valid_until,history_until,capabilities,livemode
      from public.company_module_entitlements where company_id=c and not revoked and state='active'
        and origin='paid' and policy_version='diriqo-capabilities-v0.1'
      union all
      select product,register_id,valid_from,valid_until,history_until,capabilities,livemode
      from private.company_test_module_grants where company_id=c and revoked_at is null and state='active'
        and policy_version='diriqo-capabilities-v0.1'
    ) e where e.product=p and e.valid_from<=statement_timestamp()
      and e.livemode=coalesce((select livemode from private.company_module_rollouts where company_id=c and product=p),true)
      and (case when p='pos' then (r is not null and e.register_id=r) or (r is null and cap is null) else e.register_id is null end)
      and case when cap is null then statement_timestamp()<e.history_until
        and (case when p='diriqo_core' then 'core' else p end)||'.history.read'=any(e.capabilities)
        else statement_timestamp()<e.valid_until and cap=any(e.capabilities)
          and private.module_offer_configuration_valid(p,array[cap],'diriqo-capabilities-v0.1') end
  );
$$;
revoke all on function private.module_raw_entitlement(uuid,text,text,uuid) from public,anon,authenticated,service_role;

create function private.module_has_entitlement(c uuid,p text,cap text default null,r uuid default null)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if not private.module_raw_entitlement(c,p,cap,r) then return false; end if;
  if cap is null or p in ('diriqo_core','pos') then return true; end if;
  if private.module_raw_entitlement(c,'diriqo_core','core.jobs.create',null) then return true; end if;
  if p in ('inventory','invoicing','ai_assistant') then
    return exists(select 1 from (
      select register_id from public.company_module_entitlements where company_id=c and product='pos'
      union select register_id from private.company_test_module_grants where company_id=c and product='pos'
    ) b where private.module_raw_entitlement(c,'pos','pos.sale.create',b.register_id));
  end if;
  return false;
end;
$$;
revoke all on function private.module_has_entitlement(uuid,text,text,uuid) from public,anon,authenticated,service_role;

create function private.module_is_active(c uuid,p text)
returns boolean language sql stable security definer set search_path='' as $$
 select private.module_has_entitlement(c,p,case p when 'diriqo_core' then 'core.jobs.create'
 when 'inventory' then 'inventory.movement.post' when 'invoicing' then 'invoicing.invoice.issue'
 when 'fleet' then 'fleet.vehicle.manage' when 'smart_quotes' then 'smart_quotes.template.manage'
 when 'ai_assistant' then 'ai_assistant.conversation.run' end,null);
$$;
revoke all on function private.module_is_active(uuid,text) from public,anon,authenticated,service_role;

create function private.require_module_entitlement(c uuid,p text,cap text default null,r uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 select cm.profile_id into actor from public.company_members cm join public.profiles pr on pr.id=cm.profile_id
 where cm.company_id=c and cm.is_active and pr.auth_user_id=auth.uid()
   and (pr.user_id is null or pr.user_id=pr.auth_user_id)
   and cm.role in ('super_admin','company_admin','manager','worker');
 if actor is null then raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 -- Lock grant rows while authorizing a transaction, so revocation cannot race its writes.
 perform 1 from private.company_module_rollouts where company_id=c order by product for share;
 perform 1 from public.company_module_entitlements where company_id=c order by id for share;
 perform 1 from private.company_test_module_grants where company_id=c order by id for share;
 if not private.module_has_entitlement(c,p,cap,r) then
   raise exception 'MODULE_REQUIRED' using errcode='42501';
 end if;
 return actor;
end;
$$;
revoke all on function private.require_module_entitlement(uuid,text,text,uuid) from public,anon,authenticated,service_role;

create function private.require_module_access(c uuid,p text,cap text default null,r uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=private.require_module_entitlement(c,p,cap,r);
 if not public.has_company_role(c,array['super_admin','company_admin','manager']) then
   raise exception 'MODULE_FORBIDDEN' using errcode='42501';
 end if;
 return actor;
end;
$$;
revoke all on function private.require_module_access(uuid,text,text,uuid) from public,anon,authenticated,service_role;

create function private.module_can_read(c uuid,p text,managers_only boolean default true,r uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.has_company_role(c,case when managers_only
   then array['super_admin','company_admin','manager'] else array['super_admin','company_admin','manager','worker'] end)
   and private.module_has_entitlement(c,p,null,r);
$$;
revoke all on function private.module_can_read(uuid,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function private.module_can_read(uuid,text,boolean,uuid) to authenticated;

create table public.gastro_items (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 name text not null check(length(btrim(name)) between 1 and 200),sku text not null default '' check(length(sku)<=80),
 unit text not null default 'ks' check(length(unit) between 1 and 20),kind text not null default 'stock' check(kind in ('stock','nonstock','service')),
 sale_price_minor bigint not null default 0 check(sale_price_minor between 0 and 100000000000),currency text not null default 'CZK' check(currency='CZK'),
 tax_rate numeric(5,2) not null default 21 check(tax_rate in (0,12,21)),archived boolean not null default false,version integer not null default 1,
 created_at timestamptz not null default now(),unique(company_id,id)
);
create index gastro_items_company_name_idx on public.gastro_items(company_id,name);
create unique index gastro_items_company_sku_idx on public.gastro_items(company_id,lower(sku)) where sku<>'';
alter table public.gastro_items enable row level security;
revoke all on public.gastro_items from public,anon,authenticated,service_role;
grant select on public.gastro_items to authenticated;
create policy gastro_items_read on public.gastro_items for select to authenticated using (
 private.module_can_read(company_id,'inventory') or private.module_can_read(company_id,'pos',false)
);

create table public.gastro_warehouses (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 name text not null check(length(btrim(name)) between 1 and 160),archived boolean not null default false,
 version integer not null default 1,created_at timestamptz not null default now(),unique(company_id,id),unique(company_id,name)
);
alter table public.gastro_warehouses enable row level security;
revoke all on public.gastro_warehouses from public,anon,authenticated,service_role;
grant select on public.gastro_warehouses to authenticated;
create policy gastro_warehouses_read on public.gastro_warehouses for select to authenticated
 using (private.module_can_read(company_id,'inventory') or private.module_can_read(company_id,'pos'));

create function private.get_module_workspace_access(c uuid,p text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_company_role(c,array['super_admin','company_admin','manager','worker']) then
   raise exception 'MODULE_FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('company_id',c,'product',p,'can_read',private.module_can_read(c,p),
   'can_write',private.module_can_read(c,p) and private.module_is_active(c,p));
end $$;
revoke all on function private.get_module_workspace_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.get_module_workspace_access(uuid,text) to authenticated;
create function public.get_module_workspace_access(company uuid,product text)
returns jsonb language sql security invoker set search_path='' as $$ select private.get_module_workspace_access(company,product); $$;
revoke all on function public.get_module_workspace_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_module_workspace_access(uuid,text) to authenticated;
