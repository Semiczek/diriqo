# Diriqo Supabase Auth E-mail Templates

Tyto soubory jsou připravené pro Supabase Auth šablony v hosted projektu.

## URL Configuration

V Supabase Dashboardu nastavte:

- Site URL: `https://app.diriqo.com`
- Redirect URLs:
  - `https://app.diriqo.com/auth/callback`
  - `https://app.diriqo.com/reset-password`
  - `https://app.diriqo.com/portal/reset-password`

Lokální redirecty pro vývoj jsou v `supabase/config.toml`, ale produkční e-maily pro zákazníky mají vždy vést na `https://app.diriqo.com`.

## SMTP / Sender

HTML šablona změní obsah e-mailu, ale ne jméno odesílatele. Aby příjemce neviděl `Supabase Auth`, nastavte v Supabase custom SMTP:

- Sender name: `Diriqo`
- Sender e-mail: např. `noreply@app.diriqo.com`

Bez custom SMTP může Supabase pořád zobrazovat vlastního odesílatele, i když je tělo e-mailu brandované.

## Confirm Signup

- Subject: `Potvrďte registraci do Diriqo`
- Body: zkopírovat celý obsah souboru `confirmation.html`

Šablona používá Supabase proměnnou `{{ .ConfirmationURL }}`.

## Reset Password

- Subject: `Obnovení hesla do Diriqo`
- Body: zkopírovat celý obsah souboru `recovery.html`

Šablona používá Supabase proměnnou `{{ .ConfirmationURL }}`.
