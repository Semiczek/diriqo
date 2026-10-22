-- Follow-up to the applied quote lifecycle migration. Preserve existing rows and ACLs.
-- Hosted metadata: total_price numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price).
-- Let PostgreSQL calculate each line and accumulate the values actually stored.
create or replace function private.core_quote_write_draft(p_company_id uuid,p_quote_id uuid,p_input jsonb)
returns void language plpgsql security definer set search_path='' as $f$
declare r jsonb; n integer:=0; total numeric:=0; item_total numeric;
begin
 update public.quotes set title=p_input->>'title',quote_date=(p_input->>'quote_date')::date,valid_until=(p_input->>'valid_until')::date,
  currency=p_input->>'currency',pricing_mode=p_input->>'pricing_mode',discount_amount=(p_input->>'discount_amount')::numeric,
  customer_note=p_input->>'customer_note',internal_note=p_input->>'internal_note',
  contact_name=p_input->'content'->>'contact_name',contact_email=p_input->'content'->>'contact_email',intro_text=p_input->'content'->>'intro_text',
  customer_request_title=p_input->'content'->>'customer_request_title',customer_request=p_input->'content'->>'customer_request',
  our_solution_title=p_input->'content'->>'our_solution_title',proposed_solution=p_input->'content'->>'proposed_solution',benefits_text=p_input->'content'->>'benefits_text',
  timeline_title=p_input->'content'->>'timeline_title',work_description=p_input->'content'->>'work_description',work_schedule=p_input->'content'->>'work_schedule',
  pricing_title=p_input->'content'->>'pricing_title',pricing_text=p_input->'content'->>'pricing_text',payment_terms_title=p_input->'content'->>'payment_terms_title',payment_terms=p_input->'content'->>'payment_terms'
 where id=p_quote_id and company_id=p_company_id;
 delete from public.quote_items where quote_id=p_quote_id and company_id=p_company_id;
 for r in select value from jsonb_array_elements(p_input->'items') loop
  insert into public.quote_items(company_id,quote_id,sort_order,name,description,quantity,unit,unit_price,vat_rate,note)
   values(p_company_id,p_quote_id,n,r->>'name',r->>'description',(r->>'quantity')::numeric,r->>'unit',(r->>'unit_price')::numeric,
    (r->>'vat_rate')::numeric,r->>'note') returning total_price into item_total;
  total:=total+item_total; n:=n+1;
 end loop;
 update public.quotes set subtotal_price=total,total_price=total-(p_input->>'discount_amount')::numeric,total_amount=total-(p_input->>'discount_amount')::numeric,
  updated_at=clock_timestamp() where id=p_quote_id and company_id=p_company_id;
end;
$f$;
revoke all on function private.core_quote_write_draft(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
