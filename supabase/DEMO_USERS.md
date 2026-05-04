# Diriqo Demo Users

Create Supabase Auth users manually. Do not put a real shared password in documentation or commits.

Use this placeholder while setting up:

```text
ChangeMe-Use-Strong-Password
```

## Suggested Users

- `admin@demo.diriqo.com` - Adam Admin - `company_admin`
- `manager@demo.diriqo.com` - Martina Managerova - `manager` if supported, otherwise `company_admin`
- `jana@demo.diriqo.com` - Jana Novakova - `worker`
- `petr@demo.diriqo.com` - Petr Dvorak - `worker`

Optional worker accounts:

- `martin@demo.diriqo.com` - Martin Svoboda - `worker`
- `eva@demo.diriqo.com` - Eva Cerna - `worker`

## Manual Setup

1. Open Supabase Dashboard for the Diriqo project.
2. Go to Authentication > Users.
3. Create each user with e-mail confirmed.
4. Use a strong temporary password and require a reset before sharing access.
5. Run `supabase/seed-demo-diriqo.sql`.
6. Link each Auth user to the matching row in `profiles`:

```sql
update public.profiles
set auth_user_id = '<auth-user-uuid>', user_id = '<auth-user-uuid>'
where email = 'admin@demo.diriqo.com';
```

Repeat for every demo user.

## Verification

- Log in as `admin@demo.diriqo.com`.
- Confirm the active company is `Diriqo Demo s.r.o.`.
- Confirm customers, jobs, calendar events, quotes, and invoices/demo finance views load.
- Log in as `jana@demo.diriqo.com`.
- Confirm worker-visible screens show only Jana's assigned jobs/shifts according to RLS and app filters.
