# ConPar Changelog

## 2026-07-31

### Octopai API mode + workflow build-out

ConPar gained a live Octopai API path alongside the existing file-based flow, a
full upload/suggest/insights/export workflow, and a set of correctness fixes
from the workspace code review.

**Reusable API client extracted**

- Deleted `src/Logic/api/apiClient.ts`; its login / asset-query / lineage logic
  now lives in a standalone package, `@adamscloudera/octopai-api` (repo sibling
  `octopai-api/`), consumed via `file:../octopai-api`.
- New `src/Logic/api/octopaiApi.ts` adapts the shared client to ConPar's stores.
- `apiAdapter.ts` and `useApiStore.ts` rewired onto the shared client; API
  requests now carry `AbortSignal` cancellation with a 60s timeout.

**API mode UI**

- `ApiConfigPanel.tsx` expanded (+216 lines) for live connection config, auth,
  and asset fetch — API mode replaces manual Discovery CSV upload when enabled.
- New panels: `DiscoveryUploadPanel`, `TemplateUploadPanel`, `ExportPanel`,
  `InsightsPanel`, `SuggestionsPanel`, `InstructionsPanel`.
- New stores: `useDiscoveryStore`, `useTemplateStore`, `useMappingStore`,
  `useInsightsStore`.
- New logic: `Logic/core/insightMetrics.ts`, `Logic/core/suggestionEngine.ts`,
  `Logic/readers/templateReader.ts`.

**Correctness fixes (code review)**

- `exportEngine.ts`: guard against an empty workbook — `wb.SheetNames[0] ??
  'Sheet1'` — instead of indexing `undefined` when no sheet exists.
- `tokenExtractor.ts`: strip file extension before splitting path segments.
- `ApiConfigPanel.tsx`: default lineage `nodes`/`links` to `[]` per response —
  leaf-key lineage results omit these fields, and the raw `flatMap` spliced an
  `undefined` element that crashed `computeInsightMetrics` (`reading 'from'`).

**Build / serving**

- `vite.config.ts`: `base: '/conpar/'` set in config (not via `--base` flag) and
  a dev proxy for `/conpar/octopai-proxy` → `VITE_OCTOPAI_BASE_URL`, so the app
  runs identically in local dev and behind the cdl-field-tools nginx portal.

**Notes**

- No unit suite yet — only `src/test/setup.ts` scaffolding. `npm run build`
  (tsc typecheck + vite) is the current gate and passes.
- `@adamscloudera/octopai-api` is published to GitHub Packages
  (`npm.pkg.github.com`); the `conpar.git` submodule consumes it from the
  registry (with an `.npmrc` scope mapping) so the cdl-field-tools platform can
  build the refactored ConPar from its pinned submodule SHA.
