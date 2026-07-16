# ConPar: Connection Parameter Matching Improvements

## Changes Implemented

### File: `src/Logic/core/matchingEngine.ts`

Two targeted changes to enable SQL Server schema matching when discovery data is available.

#### Change 1: Normalize `-1` Sentinel (Line 133-135)

**Problem**: Octopai exports `-1` in the `Schema Name` column for rows where the schema could not be resolved. The original guard `if (row.databaseName || row.schemaName)` treats `-1` as truthy, marking all such rows as `pre_filled` and skipping them for matching.

**Solution**: Detect and normalize `-1` to empty string before the pre_filled check:

```typescript
const knownDb = row.databaseName && row.databaseName !== '-1' ? row.databaseName : ''
const knownSchema = row.schemaName && row.schemaName !== '-1' ? row.schemaName : ''

if (knownDb && knownSchema) {
  // Only mark pre_filled if BOTH are known and non-sentinel
  return { ..., status: 'pre_filled' }
}
```

**Effect**: Rows with `schemaName = '-1'` now enter the matching pipeline instead of being skipped. This allows:
- `ODS_WH` key rows (DB known = `ODS_WH`, Schema = `-1`) → matching engine attempts to resolve schema via token overlap with SSIS package filename
- `Staging` + resolved `data` schema → still correctly `pre_filled`
- External source keys (`IMDB_*`, `LIBS_*`, `MEPS`, `OEPS`, `ISPWarehouse`) with empty DB and `'-1'` schema → will produce `no_match` (source systems not in CSV)

#### Change 2: Database-Scoped Filtering in `candidatesFromImpalaColumns` (Line 71-91)

**Problem**: The function signature had `_row: TemplateRow` (underscore prefix = unused), so it ignored the template row entirely. With two databases in the CSV (`ODS_WH`, `VODS_WH`), candidates from both were scored equally.

**Solution**: Activate the row parameter and add database filtering:

```typescript
function candidatesFromImpalaColumns(
  row: TemplateRow,  // changed from _row
  file: DiscoveryFile,
  pathTokens: Set<string>,
): CandidateSchema[] {
  // Filter by template row's database if known and not sentinel
  const dbFilter = row.databaseName && row.databaseName !== '-1'
    ? canonicalToken(row.databaseName)
    : ''

  for (const ir of file.impalaRows) {
    if (dbFilter && canonicalToken(ir.databaseName) !== dbFilter) continue
    // ... rest of grouping logic unchanged
  }
}
```

**Effect**: When a template row has a known database (e.g., `ODS_WH`), only discovery rows from that database are considered as candidates. This dramatically improves precision on multi-database extracts and aligns with the principle from the global field notes:

> Discovery export catch-22: resolved connections need lineage; lineage needs connection resolution. Discovery column exports serve as a bridge, but only when queried by schema name (not keyword) to constrain the candidate space.

## Expected Outcomes

### SSIS Template: `Octopai Connection Parameters Table - ETL (4)_populated.xlsx`
- **Schema**: 463 rows, 7 columns
- **Connection Logic Name**: Always `ODS_SSIS_Files`
- **Database Name**: `ODS_WH`, `Staging`, or empty
- **Schema Name**: `-1`, `data`, or empty

### SQL Server Discovery: `SQL SERVER-DB.csv`
- **Format**: Auto-detected as `impala_columns` (6/8 headers match)
- **Databases**: `ODS_WH` (>300 rows), `VODS_WH` (>100 rows)
- **Schemas**: CandidateAssessment, StaticData, PIMRD, Session, QuestionPapers, Report, Examiner, dbo (ODS_WH); ECC, EDI, HANA, INSPERA, TELEFORM (VODS_WH)

### Matching Scenarios

1. **ODS_WH key rows (DB = `ODS_WH`, Schema = `-1`, 47 rows)**
   - Status: `needs_selection` or `auto_filled` (if dominant candidate)
   - Candidates: Schemas from `ODS_WH` only
   - Scoring: Token overlap between SSIS filename (`Load_CandidateAssessment_*`) and schema name
   - Example: `Load_CandidateAssessment_AwardActivities.dtsx` → `CandidateAssessment` schema (high token overlap)

2. **Staging key rows (DB = `Staging`, Schema = `data`, ~280 rows)**
   - Status: `pre_filled`
   - No matching required (both values known and non-sentinel)

3. **External source keys (IMDB_*, LIBS_*, MEPS, OEPS, ISPWarehouse, ~100 rows)**
   - DB = empty, Schema = `-1`
   - Status: `no_match`
   - Reason: These source systems are not represented in the SQL Server CSV

4. **VODS_WH access (if mapped via Discovery lineage)**
   - Status: TBD (depends on lineage_map format upload)
   - Current CSV contains VODS_WH objects but no SSIS template rows reference it

## Verification Steps

1. **Start dev server**
   ```bash
   cd ConPar && npm run dev
   ```
   - Runs at `http://localhost:5175/conpar/`

2. **Upload files**
   - Template: Drag/drop `Octopai Connection Parameters Table - ETL (4)_populated.xlsx`
   - Discovery: Drag/drop `SQL SERVER-DB.csv`

3. **Inspect results**
   - Navigate to MappingGrid, filter by `ODS_WH` key rows
   - Verify status column shows `auto_filled` or `needs_selection`, not `pre_filled`
   - Click on first ODS_WH row → verify candidates include only schemas from ODS_WH (no VODS_WH schemas like ECC, HANA, INSPERA)
   - Verify `Staging`/`data` rows still show `pre_filled`

4. **Build & deploy**
   ```bash
   npm run build
   ```
   - Succeeds with no type errors
   - Output: `dist/` folder with bundled assets

## No Regressions

- **Token overlap scoring**: Weights unchanged (path: 3×, table names: 2×, frequency: +1 per match, capped at 5)
- **Dominance threshold**: Unchanged (≥2.5× runner-up)
- **Candidate pruning**: Unchanged (keep ≥15% of top score or top 3)
- **Lineage map matching**: Unchanged (no modifications to `candidatesFromLineageMap`)
- **Existing `Staging`/`data` rows**: Remain `pre_filled` (both DB and schema known and non-sentinel)
