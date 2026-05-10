alter table public.companies
  add column if not exists logo_url text null;

comment on column public.companies.logo_url is 'Optional company logo URL shown on public offers.';

drop function if exists public.get_public_offer_by_token(text);

create function public.get_public_offer_by_token(input_token text)
returns table (
  id uuid,
  title text,
  status text,
  valid_until date,
  intro_text text,
  contact_name text,
  contact_email text,
  customer_request_title text,
  customer_request text,
  our_solution_title text,
  proposed_solution text,
  timeline_title text,
  work_description text,
  work_schedule text,
  pricing_title text,
  pricing_text text,
  payment_terms_title text,
  payment_terms text,
  benefits_text text,
  total_price numeric,
  customer_name text,
  company_name text,
  company_logo_url text,
  created_at timestamptz,
  updated_at timestamptz,
  creator_name text
)
language sql
security definer
set search_path = public
as $$
  select
    q.id,
    q.title,
    q.status,
    q.valid_until,
    q.intro_text,
    q.contact_name,
    q.contact_email,
    q.customer_request_title,
    q.customer_request,
    q.our_solution_title,
    q.proposed_solution,
    q.timeline_title,
    q.work_description,
    q.work_schedule,
    q.pricing_title,
    q.pricing_text,
    q.payment_terms_title,
    q.payment_terms,
    q.benefits_text,
    q.total_price,
    c.name as customer_name,
    co.name as company_name,
    co.logo_url as company_logo_url,
    q.created_at,
    q.updated_at,
    p.full_name as creator_name
  from public.quotes q
  left join public.customers c on c.id = q.customer_id
  left join public.companies co on co.id = q.company_id
  left join public.profiles p on p.id = q.created_by
  where q.share_token = input_token
    and q.share_token is not null
  limit 1;
$$;

revoke all on function public.get_public_offer_by_token(text) from public;
grant execute on function public.get_public_offer_by_token(text) to anon, authenticated;
