# Quick Test Guide — ConPar Matching Improvements

## Setup

The dev server is already running at **http://localhost:5175/conpar/**

Files ready in `Resources/`:
- Template XLSX: `Octopai Connection Parameters Table - ETL (4)_populated.xlsx`
- Discovery CSV: `SQL SERVER-DB.csv`

## Test Steps

### 1. Open the app
Navigate to **http://localhost:5175/conpar/**

### 2. Upload Template
- Click **TemplateUploadPanel** (or the template upload area)
- Select: `Resources/Octopai Connection Parameters Table - ETL (4)_populated.xlsx`
- Expected: Template loads, 463 rows parsed, `ODS_SSIS_Files` connection logic name detected

### 3. Upload Discovery
- Click **DiscoveryUploadPanel** (or discovery upload area)
- Select: `Resources/SQL SERVER-DB.csv`
- Expected: File parses as `impala_columns` format, 300+ rows from ODS_WH detected

### 4. Examine ODS_WH Key Rows

**Finding rows**:
- Look for rows where Key = `ODS_WH` and Database Name = `ODS_WH` and Schema Name = `-1`
- These should be ~47 rows spread throughout the grid

**Per row, click to inspect**:
- Should see:
  - Status: `auto_filled` (if one dominant candidate) or `needs_selection` (if multiple)
  - ✗ Should NOT be `pre_filled`
  - Candidates: List of schemas from ODS_WH only (CandidateAssessment, StaticData, PIMRD, Session, QuestionPapers, Report, Examiner, dbo)
  - ✗ Should NOT include VODS_WH schemas (ECC, HANA, INSPERA, etc.)

**Example row**:
```
Folder Path: C:\...\Load_CandidateAssessment_AwardActivities.dtsx
Candidates:
  1. CandidateAssessment (Score: 15) ← Top candidate, CANDIDATEASSESSMENT token matches
  2. StaticData (Score: 4)
  3. PIMRD (Score: 2)
```

### 5. Verify Staging Rows Stay pre_filled

**Finding rows**:
- Look for Key = `Project.ConnectionManagers[Staging]`
- Database Name = `Staging`, Schema Name = `data`
- These should be ~248 rows

**Expected**:
- Status: `pre_filled`
- Candidates: [] (empty list, no matching attempted)

### 6. Verify External Source Keys Show no_match

**Finding rows**:
- Look for Key = `Project.ConnectionManagers[IMDB_ItemMarksV2]` or similar IMDB/LIBS/MEPS/OEPS keys
- Database Name: empty, Schema Name: `-1`

**Expected**:
- Status: `no_match`
- Reason: These source systems (IMDB, LIBS, MEPS, OEPS, ISPWarehouse) are not in the SQL Server CSV

### 7. Test Export

- Click **ExportPanel**
- Choose export format (XLSX or CSV)
- Download the file
- Verify ODS_WH rows now have resolved schema names (not `-1`)

---

## Success Criteria

✓ ODS_WH key rows transition from `pre_filled` → `auto_filled` or `needs_selection`  
✓ Candidates include only ODS_WH schemas (no VODS_WH leakage)  
✓ Staging key rows remain `pre_filled`  
✓ External source keys show `no_match`  
✓ Token overlap scoring works (CandidateAssessment > StaticData > others)  
✓ Export produces resolved schema names  

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| App won't load | Dev server running? Try port 5175, 5174, or 5173 |
| CSV fails to parse | File encoding? Use UTF-8; check CSV header row matches discovery format |
| All rows pre_filled | Did you upload both template AND discovery files? |
| Candidates empty | Discovery file uploaded but rows don't match? Check Connection Logic Name and Database Name fields |
| No candidates show for ODS_WH rows | Check that schema name in CSV is not empty; verify `canonicalToken()` normalizes correctly |

---

## Code Files Modified

- **`src/Logic/core/matchingEngine.ts`** — Two changes:
  1. Lines 133-135: Normalize `-1` sentinel in pre_filled gate
  2. Lines 71-91: Activate database-scoped filtering in `candidatesFromImpalaColumns`

No changes to:
- `src/Logic/readers/` (template and discovery file parsing)
- `src/components/` (UI display)
- `src/types.ts` (data structures)
- Token extraction or scoring algorithms
