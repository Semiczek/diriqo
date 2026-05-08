import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Legacy route screens still carry dormant UI helper/style variants from
    // previous product iterations. Keep the cleanup scoped to those files so
    // new server/DAL/security code still gets normal unused-symbol coverage.
    files: [
      "app/(dashboard)/page.tsx",
      "app/absences/page.tsx",
      "app/calendar/page.tsx",
      "app/customers/*/calculations/*/edit/page.tsx",
      "app/customers/*/calculations/*/page.tsx",
      "app/customers/*/calculations/new/page.tsx",
      "app/customers/*/calculations/page.tsx",
      "app/customers/*/page.tsx",
      "app/customers/*/quotes/*/edit/page.tsx",
      "app/customers/*/quotes/*/page.tsx",
      "app/customers/*/quotes/page.tsx",
      "app/invoices/page.tsx",
      "app/invoices/*/page.tsx",
      "app/jobs/*/JobDetailPageClient.tsx",
      "app/jobs/page.tsx",
      "app/kalkulace/*/page.tsx",
      "app/kalkulace/*/edit/page.tsx",
      "app/kalkulace/nova/bez-zakaznika/page.tsx",
      "app/workers/page.tsx",
      "components/JobCommunicationSection.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
