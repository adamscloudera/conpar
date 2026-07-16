# ConPar — Connector Parser

Browser app for loading and parsing connector data from CSV and Excel files. Client-side only — no data leaves the machine.

## Stack

React 19, TypeScript, Vite 8, Tailwind CSS v4, Zustand, papaparse, xlsx, vitest, Testing Library.

## Commands

```
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm test           # vitest run
```

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component |
| `src/store/` | Zustand state management |
| `src/components/` | UI components |
| `vite.config.ts` | Build config |

## Session Lifecycle

Enroll in Marrow for knowledge tracking: run `init-project.sh` from this directory (see `../Marrow/`). Once enrolled, run `/startup` at session start and `/close` before closing.
