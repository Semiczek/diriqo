create unique index if not exists customer_portal_users_contact_uidx
  on public.customer_portal_users (contact_id)
  where contact_id is not null;
