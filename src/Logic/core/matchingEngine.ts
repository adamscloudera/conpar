import type { CandidateSchema, ConfidenceLevel, ConnectionScopeConfig, DiscoveryFile, MappingResult, MappingStatus, TemplateRow } from '../../types.ts'
import { canonicalToken, extractKeyIdentifier, extractPathTokens } from './tokenExtractor.ts'
import { classifyConnectionKey, parseFullyQualifiedKey, snowflakeDbFromApiRows, snowflakeSchemaHint } from './connectionClassifier.ts'

function tokenOverlap(pathTokens: Set<string>, name: string): number {
  const nameTokens = extractPathTokens(name)
  let count = 0
  for (const t of nameTokens) {
    if (pathTokens.has(t)) count++
  }
  return count
}

function candidatesFromLineageMap(
  row: TemplateRow,
  file: DiscoveryFile,
  pathTokens: Set<string>,
): CandidateSchema[] {
  const rowKey = canonicalToken(row.key)
  const rowConn = canonicalToken(row.connectionLogicName)
  const rowPath = canonicalToken(row.path)

  // Group lineage rows by schema for rows matching this connection
  const schemaGroups = new Map<string, { rows: typeof file.lineageRows; pathMatchCount: number }>()

  for (const lr of file.lineageRows) {
    const keyMatch = canonicalToken(lr.sourceConnectionKey) === rowKey
    const connMatch = canonicalToken(lr.sourceConnectionName) === rowConn
    if (!keyMatch && !connMatch) continue

    const schemaKey = canonicalToken(lr.sourceSchemaName)
    if (!schemaKey) continue

    const existing = schemaGroups.get(schemaKey) ?? { rows: [], pathMatchCount: 0 }
    existing.rows.push(lr)

    // Count how many rows also match this specific report path
    if (canonicalToken(lr.targetReportPath) === rowPath) {
      existing.pathMatchCount++
    }
    schemaGroups.set(schemaKey, existing)
  }

  const candidates: CandidateSchema[] = []
  for (const [, group] of schemaGroups) {
    const schema = group.rows[0].sourceSchemaName
    const pathTokenOverlap = tokenOverlap(pathTokens, schema)
    // Table name overlap: sum of overlaps for tables that also match this report path
    const pathRows = group.rows.filter(
      (lr) => canonicalToken(lr.targetReportPath) === rowPath,
    )
    const tableNameOverlap = pathRows.reduce(
      (acc, lr) => acc + tokenOverlap(pathTokens, lr.sourceObjectName),
      0,
    )
    const sourceFrequency = group.pathMatchCount

    const score = pathTokenOverlap * 3 + tableNameOverlap * 2 + Math.min(sourceFrequency, 5)

    candidates.push({
      databaseName: schema,
      schemaName: schema,
      score,
      signals: { pathTokenOverlap, tableNameOverlap, sourceFrequency, keyDbOverlap: 0, keySchemaOverlap: 0 },
      sourceFile: file.filename,
    })
  }

  return candidates
}

function candidatesFromImpalaColumns(
  row: TemplateRow,
  file: DiscoveryFile,
  pathTokens: Set<string>,
  forceIncludeDb?: string,
): CandidateSchema[] {
  // Filter by template row's database if known and not sentinel
  const dbFilter = row.databaseName && row.databaseName !== '-1'
    ? canonicalToken(row.databaseName)
    : ''

  // Extract identifier tokens from the connection key for DB-name matching.
  // "Project.ConnectionManagers[ISPWarehouse]" → ["ISPWAREHOUSE"]
  // "ODS_WH"                                  → ["ODS", "WH"]
  // SSIS templates use GUID keys ({099FF4C3-...}) that carry no DB signal,
  // so fall back to the connection logic name in that case.
  const rawKeyTokens = extractKeyIdentifier(row.key)
  const keyTokenSet = new Set(
    rawKeyTokens.length > 0 ? rawKeyTokens : extractKeyIdentifier(row.connectionLogicName)
  )

  // Group by (databaseName||schemaName) to keep same-named schemas in different
  // environments separate (e.g. ISPWarehouse_BDEV.dbo ≠ ISPWarehouse_Prod.dbo)
  const schemaGroups = new Map<string, typeof file.impalaRows>()
  for (const ir of file.impalaRows) {
    if (dbFilter && canonicalToken(ir.databaseName) !== dbFilter) continue

    // Without a known DB, only include rows from DBs that share key tokens.
    // This prevents unrelated databases from flooding the candidate list.
    // Exception: always include rows from forceIncludeDb (the known Snowflake DB for
    // Snowflake-classified keys) — extractPathTokens drops 2-char parts like 'BI',
    // so 'BI_PROD' produces no tokens that overlap with keys like 'BI_STG_snow'.
    if (!dbFilter && keyTokenSet.size > 0) {
      const forced = forceIncludeDb?.toLowerCase()
      if (!forced || ir.databaseName.toLowerCase() !== forced) {
        const dbParts = new Set(extractPathTokens(ir.databaseName))
        let overlap = 0
        for (const t of keyTokenSet) { if (dbParts.has(t)) overlap++ }
        if (overlap === 0) continue
      }
    }

    const groupKey = `${canonicalToken(ir.databaseName)}||${canonicalToken(ir.schemaName)}`
    if (!groupKey.replace('||', '')) continue
    const existing = schemaGroups.get(groupKey) ?? []
    existing.push(ir)
    schemaGroups.set(groupKey, existing)
  }

  const scored: CandidateSchema[] = []
  const unscored: CandidateSchema[] = []

  for (const [, rows] of schemaGroups) {
    const schema = rows[0].schemaName
    const db = rows[0].databaseName
    const pathTokenOverlap = tokenOverlap(pathTokens, schema)
    const tableNameOverlap = rows.reduce((acc, ir) => acc + tokenOverlap(pathTokens, ir.objectName), 0)
    const sourceFrequency = rows.filter((ir) => tokenOverlap(pathTokens, ir.objectName) > 0).length

    // How many key tokens appear in the database name
    const dbParts = new Set(extractPathTokens(db))
    let keyDbOverlap = 0
    for (const t of keyTokenSet) { if (dbParts.has(t)) keyDbOverlap++ }

    // How many key tokens appear in the schema name.
    // When the key directly names the schema (e.g. BI_PROD_DBT → DBT) this
    // signal dominates, making the correct schema win without path/table data.
    const schemaParts = new Set(extractPathTokens(schema))
    let keySchemaOverlap = 0
    for (const t of keyTokenSet) { if (schemaParts.has(t)) keySchemaOverlap++ }

    const score = keyDbOverlap * 10 + keySchemaOverlap * 30 + pathTokenOverlap * 3 + tableNameOverlap * 2 + Math.min(sourceFrequency, 5)

    const candidate: CandidateSchema = {
      databaseName: db || schema,
      schemaName: schema,
      score,
      signals: { pathTokenOverlap, tableNameOverlap, sourceFrequency, keyDbOverlap, keySchemaOverlap },
      sourceFile: file.filename,
    }

    if (score > 0) {
      scored.push(candidate)
    } else if (dbFilter) {
      // When DB is known, keep all schemas so the user can manually verify
      unscored.push(candidate)
    }
  }

  return [...scored, ...unscored]
}

function mergeCandidates(all: CandidateSchema[]): CandidateSchema[] {
  const merged = new Map<string, CandidateSchema>()
  for (const c of all) {
    // Key includes DB so same schema name in different environments stays separate
    const key = `${canonicalToken(c.databaseName)}||${canonicalToken(c.schemaName)}`
    const existing = merged.get(key)
    if (!existing || c.score > existing.score) {
      merged.set(key, c)
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score)
}

// Collect all impalaRows from api_lookup files so classifiers can read API data.
function apiImpalaRows(discoveryFiles: DiscoveryFile[]) {
  return discoveryFiles.flatMap((f) => f.type === 'api_lookup' ? f.impalaRows : [])
}

// Return a copy of the discovery file list where each api_lookup file's impalaRows
// is filtered to a single scope value. Tries connectionLogicName first; falls back
// to databaseName for tenants whose API doesn't populate connection names.
function scopeDiscoveryFiles(files: DiscoveryFile[], scopeValue: string): DiscoveryFile[] {
  const lower = scopeValue.toLowerCase()
  return files.map((f) => {
    if (f.type !== 'api_lookup') return f
    const byConn = f.impalaRows.filter((r) => r.connectionLogicName.toLowerCase() === lower)
    const rows = byConn.length > 0
      ? byConn
      : f.impalaRows.filter((r) => r.databaseName.toLowerCase() === lower)
    return { ...f, impalaRows: rows }
  })
}

// Derive confidence from the resolved status and candidate.
// 'key-name parsing'  → fully-qualified key gave exact DB+schema  → high
// 'key-name inference' → Snowflake schema hint from key name:
//     DB present (scope assigned) → high; DB absent → medium
// API auto_filled with real DB → high
// needs_selection (multiple candidates) → medium
// no_match → low
function computeConfidence(
  status: MappingStatus,
  selectedCandidate: CandidateSchema | null,
  candidates: CandidateSchema[],
): ConfidenceLevel {
  if (status === 'pre_filled' || status === 'confirmed' || status === 'manual') return 'high'
  if (status === 'not_applicable') return 'high'
  if (status === 'no_match') return 'low'
  const c = selectedCandidate ?? candidates[0] ?? null
  if (!c) return 'low'
  if (c.sourceFile === 'key-name parsing') return 'high'
  if (c.sourceFile === 'key-name inference') {
    return c.databaseName ? 'high' : 'medium'
  }
  if (status === 'auto_filled') return 'high'
  return 'medium'
}

export function computeMappings(
  templateRows: TemplateRow[],
  discoveryFiles: DiscoveryFile[],
  scope?: ConnectionScopeConfig | null,
): MappingResult[] {
  // Global Snowflake DB (auto-detect via /snow/i) — used for keys with no explicit scope.
  const globalSnowflakeDb = snowflakeDbFromApiRows(apiImpalaRows(discoveryFiles))

  return templateRows.map((row, rowIndex) => {
    // Normalize -1 sentinel (Octopai unresolved marker) to empty
    const knownDb = row.databaseName && row.databaseName !== '-1' ? row.databaseName : ''
    const knownSchema = row.schemaName && row.schemaName !== '-1' ? row.schemaName : ''

    // Already filled in source template (both DB and schema known)
    if (knownDb && knownSchema) {
      return {
        rowIndex,
        templateRow: row,
        candidates: [],
        selectedCandidate: null,
        manualDatabase: row.databaseName,
        manualSchema: row.schemaName,
        status: 'pre_filled' as MappingStatus,
        confidence: 'high' as ConfidenceLevel,
      }
    }

    // Fully-qualified key: DB.schema.connectionName — extract DB and schema directly.
    // Handles Oracle-style keys like stgprod.dwh.BI_DWH_Oracle without requiring API data.
    const parsedKey = !knownDb && !knownSchema ? parseFullyQualifiedKey(row.key) : null
    if (parsedKey) {
      const candidate: CandidateSchema = {
        databaseName: parsedKey.database,
        schemaName: parsedKey.schema,
        score: 0,
        signals: { pathTokenOverlap: 0, tableNameOverlap: 0, sourceFrequency: 0, keyDbOverlap: 0, keySchemaOverlap: 0 },
        sourceFile: 'key-name parsing',
      }
      return {
        rowIndex,
        templateRow: row,
        candidates: [candidate],
        selectedCandidate: candidate,
        manualDatabase: '',
        manualSchema: '',
        status: 'auto_filled' as MappingStatus,
        confidence: 'high' as ConfidenceLevel,
      }
    }

    // Classify by connection key before running the discovery matcher.
    const connClass = classifyConnectionKey(row.key)

    // Salesforce, Redshift, and file-path connections don't have a DB/schema in
    // the relational sense. Mark them immediately so they don't inflate no_match.
    if (connClass === 'salesforce' || connClass === 'redshift' || connClass === 'file_path') {
      return {
        rowIndex,
        templateRow: row,
        candidates: [],
        selectedCandidate: null,
        manualDatabase: '',
        manualSchema: '',
        status: 'not_applicable' as MappingStatus,
        confidence: 'high' as ConfidenceLevel,
      }
    }

    // Per-row connection scope: when a connection is assigned to this key, filter
    // the api_lookup discovery data to only that connection's assets.
    const scopedConnection = scope?.keyConnectionMap[row.key] ?? null
    const activeFiles = scopedConnection
      ? scopeDiscoveryFiles(discoveryFiles, scopedConnection)
      : discoveryFiles

    // Snowflake DB to use for hint candidates: use scoped data when pinned, else global.
    const snowflakeDb = scopedConnection
      ? snowflakeDbFromApiRows(apiImpalaRows(activeFiles), scopedConnection)
      : globalSnowflakeDb

    if (!discoveryFiles.length) {
      // No discovery data: for Snowflake keys, still surface a schema hint.
      if (connClass === 'snowflake') {
        const hint = buildSnowflakeHintCandidate(row.key, snowflakeDb)
        if (hint) {
          return {
            rowIndex,
            templateRow: row,
            candidates: [hint],
            selectedCandidate: hint,
            manualDatabase: '',
            manualSchema: '',
            status: 'needs_selection' as MappingStatus,
            confidence: computeConfidence('needs_selection', hint, [hint]),
          }
        }
      }
      return {
        rowIndex,
        templateRow: row,
        candidates: [],
        selectedCandidate: null,
        manualDatabase: '',
        manualSchema: '',
        status: 'no_match' as MappingStatus,
        confidence: 'low' as ConfidenceLevel,
      }
    }

    const pathTokens = new Set(extractPathTokens(row.path))
    // For Snowflake keys, force-include rows from the known Snowflake DB even when
    // its name shares no token overlap with the key. extractPathTokens drops 2-char
    // parts like 'BI', so 'BI_PROD' produces {PROD} which never overlaps with key
    // tokens from 'BI_STG_snow' = {BI, STG, SNOW}.
    const forceIncludeDb = connClass === 'snowflake' ? snowflakeDb : ''

    const allCandidates: CandidateSchema[] = []

    for (const file of activeFiles) {
      if (file.type === 'lineage_map') {
        allCandidates.push(...candidatesFromLineageMap(row, file, pathTokens))
      } else if (file.type === 'impala_columns' || file.type === 'api_lookup') {
        allCandidates.push(...candidatesFromImpalaColumns(row, file, pathTokens, forceIncludeDb || undefined))
      }
    }

    // For Snowflake keys, boost the exact (snowflakeDb, schemaHint) candidate by +100.
    // Without this, 'to_stg.STG' (keyDbOverlap=1, score 40) beats 'BI_PROD.STG'
    // (keyDbOverlap=0, score 30) because PROD has no overlap with key tokens.
    // The +100 makes BI_PROD.STG dominant at 130 vs to_stg.STG at 40 (≥ 2.5×).
    if (connClass === 'snowflake' && snowflakeDb) {
      const db = snowflakeDb.toLowerCase()
      const schemaHint = (snowflakeSchemaHint(row.key) ?? '').toLowerCase()
      for (const c of allCandidates) {
        if (schemaHint &&
            c.databaseName.toLowerCase() === db &&
            c.schemaName.toLowerCase() === schemaHint) {
          c.score += 100
        }
      }
    }

    const merged = mergeCandidates(allCandidates)

    if (!merged.length) {
      // Snowflake keys with no discovery match: inject a schema hint as a
      // pre-populated suggestion so the SE confirms rather than types from scratch.
      if (connClass === 'snowflake') {
        const hint = buildSnowflakeHintCandidate(row.key, snowflakeDb)
        if (hint) {
          return {
            rowIndex,
            templateRow: row,
            candidates: [hint],
            selectedCandidate: hint,
            manualDatabase: '',
            manualSchema: '',
            status: 'needs_selection' as MappingStatus,
            confidence: computeConfidence('needs_selection', hint, [hint]),
          }
        }
      }
      return {
        rowIndex,
        templateRow: row,
        candidates: [],
        selectedCandidate: null,
        manualDatabase: '',
        manualSchema: '',
        status: 'no_match' as MappingStatus,
        confidence: 'low' as ConfidenceLevel,
      }
    }

    // Separate scored candidates from unscored DB fallbacks
    const nonZero = merged.filter((c) => c.score > 0)
    const zeroScore = merged.filter((c) => c.score === 0)

    // Apply noise-removal filter to scored candidates only; keep top 3 minimum
    let displayScored: CandidateSchema[]
    if (nonZero.length) {
      const topScore = nonZero[0].score
      const meaningful = nonZero.filter((c) => c.score >= topScore * 0.15)
      displayScored = meaningful.length >= 3 ? meaningful : nonZero.slice(0, 3)
    } else {
      displayScored = []
    }

    // Unscored DB schemas appended at end for manual review
    const candidates = [...displayScored, ...zeroScore]

    // Dominant check based on scored candidates only
    const dominant =
      nonZero.length === 1 ||
      (nonZero.length > 1 && nonZero[0].score >= nonZero[1].score * 2.5)

    // If no scored candidates, prompt user to pick from the DB's schemas
    const status: MappingStatus = !nonZero.length
      ? 'needs_selection'
      : dominant
        ? 'auto_filled'
        : 'needs_selection'

    const selectedCandidate = candidates[0] ?? null
    return {
      rowIndex,
      templateRow: row,
      candidates,
      selectedCandidate,
      manualDatabase: '',
      manualSchema: '',
      status,
      confidence: computeConfidence(status, selectedCandidate, candidates),
    }
  })
}

function buildSnowflakeHintCandidate(key: string, knownDb: string): CandidateSchema | null {
  const schema = snowflakeSchemaHint(key)
  if (!schema) return null
  return {
    databaseName: knownDb || '',
    schemaName: schema,
    score: 0,
    signals: { pathTokenOverlap: 0, tableNameOverlap: 0, sourceFrequency: 0, keyDbOverlap: 0, keySchemaOverlap: 0 },
    sourceFile: 'key-name inference',
  }
}
