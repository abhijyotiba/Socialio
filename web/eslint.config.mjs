import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Workspace-scoped DB helpers are being migrated to persona-scoped equivalents
// during Phase V2.2 (see docs/phases/PHASE_V2_2_MULTIPERSONA_REDESIGN.md).
// Warn on every existing call site so we can track the migration; flips to
// error in Step E (lockdown) once all callers are migrated.
const legacyBrandNames = [
  "getBrandConfig",
  "setVoiceProfile",
  "getVoiceProfile",
];
const legacyConnectionNames = [
  "getSocialConnection",
  "getActiveSocialConnections",
];

const restrictedImports = {
  paths: [
    {
      name: "@/lib/db/brand-configs",
      importNames: legacyBrandNames,
      message:
        "Workspace-scoped brand helpers are deprecated. Use getBrandConfigForPersona (Phase V2.2).",
    },
    {
      name: "@/lib/db/_legacy/brand-configs",
      importNames: legacyBrandNames,
      message:
        "Do not import from _legacy/ directly — these names are re-exported from @/lib/db/brand-configs only for the migration window.",
    },
    {
      name: "@/lib/db/social-connections",
      importNames: legacyConnectionNames,
      message:
        "Workspace-scoped connection helpers are deprecated. Use getSocialConnectionForPersona / getConnectionsForPersona (Phase V2.2).",
    },
    {
      name: "@/lib/db/_legacy/social-connections",
      importNames: legacyConnectionNames,
      message:
        "Do not import from _legacy/ directly — these names are re-exported from @/lib/db/social-connections only for the migration window.",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Flipped from warn to error in Phase V2.2 Step E. The only legitimate
      // legacy imports left are the explicit fallback callers in the cron and
      // publish/regenerate routes, each disabling the rule on a single line
      // with a comment explaining why.
      "no-restricted-imports": ["error", restrictedImports],
    },
  },
  {
    // _legacy/ and the trampoline files that re-export from it are exempt —
    // they exist precisely to keep the legacy names reachable during the
    // migration window.
    files: [
      "lib/db/_legacy/**/*.ts",
      "lib/db/brand-configs.ts",
      "lib/db/social-connections.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
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
