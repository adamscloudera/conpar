# ConPar Integration: cdl-field-tools

ConPar is now integrated as a sub-tool in cdl-field-tools, the CDL field team's internal tools platform.

## Access

When deployed:
- **Local dev**: http://localhost:5175/conpar/ (standalone dev server)
- **Platform**: https://{vm}/conpar/ (via cdl-field-tools nginx routing)

## Build Integration

**Location**: `/Users/adams/Documents/Integration Projects/cdl-field-tools/scripts/release/build-conpar.sh`

The build script:
- Pulls ConPar source from `../ConPar` (relative to cdl-field-tools root)
- Installs dependencies with `npm ci`
- Builds with Vite: `npx vite build --base=/conpar/`
- Rsyncs output to `dist/conpar/`

**Current architecture**: ConPar lives in the integration-projects monorepo. When extracted to a separate `adamscloudera/conpar` repo, the build script will reference it as a git submodule under `apps/conpar/` (matching UCUI, OctopaiPrepTool, OctopaiQaKb pattern).

## Platform Integration Checklist

- [x] Build script created (`build-conpar.sh`)
- [x] Added to build pipeline (`build-apps.sh`)
- [x] Nginx routing configured (`default.conf`)
- [x] Landing page updated (`static/index.html`)
- [x] Validation rules added (`validate-dist.sh`)
- [x] Full platform build passes
- [x] Asset prefixes correct (`/conpar/`)

## Matching Engine Improvements

See `/Users/adams/Documents/Integration Projects/ConPar/`:

- **IMPLEMENTATION_SUMMARY.md** — Technical overview of changes
- **MATCHING_LOGIC_FLOW.md** — Before/after logic flow with concrete examples
- **QUICK_TEST.md** — Testing guide

Key improvements:
1. `-1` sentinel normalization (Octopai unresolved marker)
2. Database-scoped filtering for discovery rows
3. Enables SSIS template → SQL Server discovery matching

## Files Modified in cdl-field-tools

```
cdl-field-tools/
├── scripts/release/
│   ├── build-conpar.sh          (NEW)
│   ├── build-apps.sh            (UPDATED)
│   └── validate.sh              (unchanged, calls validate-dist.sh)
├── scripts/
│   └── validate-dist.sh         (UPDATED)
├── nginx/
│   └── default.conf             (UPDATED)
├── static/
│   └── index.html               (UPDATED)
└── INTEGRATION_CONPAR.md        (NEW)
```

## Testing

### Standalone ConPar Dev Server
```bash
cd ConPar
npm run dev
# http://localhost:5173 or 5174 or 5175
```

### Full Platform Build
```bash
cd cdl-field-tools
bash scripts/build.sh
# Validates all 4 tools + landing page
```

### Local Docker Smoke Test
```bash
cd cdl-field-tools
docker-compose up --build
# http://localhost:8080/conpar/
```

## Deployment

The platform is deployed via `scripts/deploy-vm.sh`, which:
- Builds all 4 tools
- Validates dist/ structure
- Syncs to VM
- Restarts nginx

ConPar is now part of the standard deployment.

## Future: Separate Repository

When ready to extract ConPar as an independent project:

1. Create `github.com/adamscloudera/conpar`
2. Move code from integration-projects
3. Add as submodule: `git submodule add https://github.com/adamscloudera/conpar.git apps/conpar`
4. Update `build-conpar.sh` line 5 from `../ConPar` to `apps/conpar`
5. Follow standard submodule pinning workflow for releases

This aligns ConPar with UCUI, OctopaiPrepTool, and Octopai Q&A KB.
