-- Diriqo Office staging preflight.
-- READ ONLY: this file contains SELECT statements only.
-- Execute only after the caller verified the allowlisted staging project ref
-- and matching Supabase URL. Database name/user is NOT proof of staging.
-- Never run against production. Never add corrective DDL or guessed seed here.
-- Run before creating any synthetic Auth users.
-- A missing baseline table, unknown required column, or unreviewed trigger
-- means STOP. Diriqo-only relations may be absent in Hub; they are required
-- for the documented Diriqo enforced-capability scenario.
-- Results contain schema metadata and counts, not credentials or user rows.

SELECT
  current_database() AS database_name,
  current_user AS database_role,
  current_setting('server_version') AS server_version;

-- Presence only. to_regclass returns NULL for missing relations.
WITH expected(host_scope, relation_name) AS (
  VALUES
    ('both', 'auth.users'),
    ('both', 'public.companies'),
    ('both', 'public.profiles'),
    ('both', 'public.company_members'),
    ('both', 'public.company_modules'),
    ('both-office', 'public.office_settings'),
    ('both-office', 'office_private.tenant_state'),
    ('both-office', 'office_private.settings_events'),
    ('diriqo', 'public.company_onboarding'),
    ('diriqo', 'public.user_onboarding_state'),
    ('diriqo', 'public.user_legal_acceptances'),
    ('diriqo', 'public.legal_document_versions'),
    ('diriqo', 'private.platform_admin_grants'),
    ('diriqo', 'private.company_module_rollouts'),
    ('diriqo', 'private.company_test_module_grants')
)
SELECT host_scope, relation_name, to_regclass(relation_name) IS NOT NULL AS present
FROM expected
ORDER BY host_scope, relation_name;

-- Exact column types/defaults. Pay attention to every NOT NULL column with
-- no default/identity/generated expression; never assume it can be omitted.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  NULLIF(a.attidentity, '') AS identity_kind,
  NULLIF(a.attgenerated, '') AS generated_kind,
  pg_get_expr(d.adbin, d.adrelid) AS default_or_generated_expression
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p')
  AND (
    (n.nspname = 'public' AND c.relname IN (
      'companies', 'profiles', 'company_members', 'company_modules',
      'company_onboarding', 'user_onboarding_state', 'user_legal_acceptances',
      'legal_document_versions', 'office_settings'
    ))
    OR (n.nspname = 'private' AND c.relname IN (
      'platform_admin_grants', 'company_module_rollouts', 'company_test_module_grants'
    ))
  )
ORDER BY n.nspname, c.relname, a.attnum;

-- PK/unique/FK/CHECK constraints, including role/status and grant restrictions.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS validated,
  con.condeferrable AS deferrable,
  con.condeferred AS initially_deferred,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (
  (n.nspname = 'public' AND c.relname IN (
    'companies', 'profiles', 'company_members', 'company_modules',
    'company_onboarding', 'user_onboarding_state', 'user_legal_acceptances',
    'legal_document_versions', 'office_settings'
  ))
  OR (n.nspname = 'private' AND c.relname IN (
    'platform_admin_grants', 'company_module_rollouts', 'company_test_module_grants'
  ))
)
ORDER BY n.nspname, c.relname, con.conname;

-- Unique/partial/expression indexes may impose restrictions beyond constraints.
SELECT schemaname AS schema_name, tablename AS table_name, indexname, indexdef
FROM pg_indexes
WHERE
  (schemaname = 'public' AND tablename IN (
    'companies', 'profiles', 'company_members', 'user_onboarding_state',
    'user_legal_acceptances', 'office_settings'
  ))
  OR (schemaname = 'private' AND tablename IN (
    'platform_admin_grants', 'company_module_rollouts', 'company_test_module_grants'
  ))
ORDER BY schemaname, tablename, indexname;

-- Enum labels, when these actual columns use an enum or a domain over enum.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attname AS column_name,
  tn.nspname AS enum_schema,
  et.typname AS enum_type,
  e.enumsortorder,
  e.enumlabel
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type at ON at.oid = a.atttypid
JOIN pg_type et ON et.oid = CASE WHEN at.typtype = 'd' THEN at.typbasetype ELSE at.oid END
JOIN pg_namespace tn ON tn.oid = et.typnamespace
JOIN pg_enum e ON e.enumtypid = et.oid
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname = 'public'
  AND (
    (c.relname = 'company_members' AND a.attname = 'role')
    OR (c.relname = 'profiles' AND a.attname IN ('role', 'worker_status', 'worker_type'))
  )
ORDER BY c.relname, a.attname, e.enumsortorder;

-- User-defined triggers. Auth creation may have profile/company side effects.
-- Review the referenced function bodies separately before calling createUser.
-- No function bodies are printed here to avoid dumping unrelated embedded data.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  pg_get_triggerdef(t.oid, true) AS trigger_definition,
  pn.nspname AS function_schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS function_arguments,
  p.oid AS function_oid,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND (
    (n.nspname = 'auth' AND c.relname = 'users')
    OR (n.nspname = 'public' AND c.relname IN (
      'companies', 'profiles', 'company_members', 'company_onboarding',
      'user_onboarding_state', 'office_settings'
    ))
    OR (n.nspname = 'private' AND c.relname IN (
      'platform_admin_grants', 'company_module_rollouts', 'company_test_module_grants'
    ))
  )
ORDER BY n.nspname, c.relname, t.tgname;

-- Required host/Office routine signatures and grants. Their presence alone does
-- not prove behavior; compare definitions with the reviewed migration source.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS result_type,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  pg_get_userbyid(p.proowner) AS owner_role,
  p.proconfig AS function_settings,
  p.proacl AS explicit_acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private', 'office_private')
  AND (
    n.nspname = 'office_private'
    OR
    p.proname LIKE 'office\_%' ESCAPE '\'
    OR p.proname IN (
      'is_super_admin', 'get_company_capability_access',
      'module_offer_configuration_valid', 'create_onboarding_company'
    )
  )
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- Table RLS state and raw grants. NULL ACL means defaults, NOT no privileges.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  pg_get_userbyid(c.relowner) AS owner_role,
  c.relacl AS explicit_acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND (
    (n.nspname = 'public' AND (
      c.relname IN ('companies', 'profiles', 'company_members', 'office_settings')
      OR c.relname LIKE 'office\_%' ESCAPE '\'
    ))
    OR n.nspname = 'office_private'
    OR (n.nspname = 'private' AND (
      c.relname IN ('platform_admin_grants', 'company_module_rollouts', 'company_test_module_grants')
      OR c.relname LIKE 'office\_%' ESCAPE '\'
    ))
  )
ORDER BY n.nspname, c.relname;

-- Effective grants for existing Supabase roles. Private test grant tables are
-- expected to reject service_role writes; do not "fix" them to enable REST seed.
SELECT
  r.rolname AS database_role,
  n.nspname AS schema_name,
  c.relname AS table_name,
  has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usage,
  has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
  has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete
FROM pg_roles r
CROSS JOIN pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
  AND c.relkind IN ('r', 'p')
  AND (
    (n.nspname = 'public' AND c.relname = 'office_settings')
    OR n.nspname = 'office_private'
    OR (n.nspname = 'private' AND c.relname IN (
      'platform_admin_grants', 'company_module_rollouts', 'company_test_module_grants'
    ))
  )
ORDER BY r.rolname, n.nspname, c.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE
  (schemaname = 'public' AND (
    tablename IN ('companies', 'profiles', 'company_members', 'office_settings')
    OR tablename LIKE 'office\_%' ESCAPE '\'
  ))
  OR schemaname = 'office_private'
  OR (schemaname = 'private' AND (
    tablename IN ('platform_admin_grants', 'company_module_rollouts', 'company_test_module_grants')
    OR tablename LIKE 'office\_%' ESCAPE '\'
  ))
ORDER BY schemaname, tablename, policyname;

-- Prove counts are not silently filtered by RLS. Every existing baseline table
-- must have can_select=true and row_visibility_unrestricted=true.
-- A false result means STOP even if a subsequent count happens to be zero.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  current_user AS database_role,
  r.rolsuper AS role_superuser,
  r.rolbypassrls AS role_bypasses_rls,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
  (
    NOT c.relrowsecurity
    OR r.rolsuper
    OR r.rolbypassrls
    OR (pg_has_role(current_user, c.relowner, 'USAGE') AND NOT c.relforcerowsecurity)
  ) AS row_visibility_unrestricted
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.rolname = current_user
WHERE
  (n.nspname = 'auth' AND c.relname = 'users')
  OR (n.nspname = 'public' AND c.relname IN ('companies', 'profiles', 'company_members'))
ORDER BY n.nspname, c.relname;

-- Empty-branch gate. Run BEFORE any seed/Auth provisioning.
-- These direct references intentionally fail if a baseline table is absent.
-- All four counts must be zero for a new data-free staging branch.
-- Any nonzero count means STOP and investigate; do not delete anything.
SELECT 'auth.users' AS relation_name, count(*) AS row_count FROM auth.users
UNION ALL
SELECT 'public.companies', count(*) FROM public.companies
UNION ALL
SELECT 'public.profiles', count(*) FROM public.profiles
UNION ALL
SELECT 'public.company_members', count(*) FROM public.company_members;
