import type { CandidateSchema, DiscoveryFile, MappingResult, MappingStatus, TemplateRow } from '../../types.ts'
import { canonicalToken, extractKeyIdentifier, extractPathTokens } from './tokenExtractor.ts'

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
      signals: { pathTokenOverlap, tableNameOverlap, sourceFrequency, keyDbOverlap: 0 },
      sourceFile: file.filename,
    })
  }

  return candidates
}

function candidatesFromImpalaColumns(
  row: TemplateRow,
  file: DiscoveryFile,
  pathTokens: Set<string>,
): CandidateSchema[] {
  // Filter by template row's database if known and not sentinel
  const dbFilter = row.databaseName && row.databaseName !== '-1'
    ? canonicalToken(row.databaseName)
    : ''

  // Extract identifier tokens from the connection key for DB-name matching.
  // "Project.ConnectionManagers[ISPWarehouse]" → ["ISPWAREHOUSE"]
  // "ODS_WH"                                  → ["ODS", "WH"]
  const keyTokenSet = new Set(extractKeyIdentifier(row.key))

  // Group by (databaseName||schemaName) to keep same-named schemas in different
  // environments separate (e.g. ISPWarehouse_BDEV.dbo ≠ ISPWarehouse_Prod.dbo)
  const schemaGroups = new Map<string, typeof file.impalaRows>()
  for (const ir of file.impalaRows) {
    if (dbFilter && canonicalToken(ir.databaseName) !== dbFilter) continue

    // Without a known DB, only include rows from DBs that share key tokens.
    // This prevents unrelated databases from flooding the candidate list.
    if (!dbFilter && keyTokenSet.size > 0) {
      const dbParts = new Set(extractPathTokens(ir.databaseName))
      let overlap = 0
      for (const t of keyTokenSet) { if (dbParts.has(t)) overlap++ }
      if (overlap === 0) continue
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

    const score = keyDbOverlap * 10 + pathTokenOverlap * 3 + tableNameOverlap * 2 + Math.min(sourceFrequency, 5)

    const candidate: CandidateSchema = {
      databaseName: db || schema,
      schemaName: schema,
      score,
      signals: { pathTokenOverlap, tableNameOverlap, sourceFrequency, keyDbOverlap },
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

export function computeMappings(
  templateRows: TemplateRow[],
  discoveryFiles: DiscoveryFile[],
): MappingResult[] {
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
      }
    }

    if (!discoveryFiles.length) {
      return {
        rowIndex,
        templateRow: row,
        candidates: [],
        selectedCandidate: null,
        manualDatabase: '',
        manualSchema: '',
        status: 'no_match' as MappingStatus,
      }
    }

    const pathTokens = new Set(extractPathTokens(row.path))
    const allCandidates: CandidateSchema[] = []

    for (const file of discoveryFiles) {
      if (file.type === 'lineage_map') {
        allCandidates.push(...candidatesFromLineageMap(row, file, pathTokens))
      } else if (file.type === 'impala_columns') {
        allCandidates.push(...candidatesFromImpalaColumns(row, file, pathTokens))
      }
    }

    const merged = mergeCandidates(allCandidates)

    if (!merged.length) {
      return {
        rowIndex,
        templateRow: row,
        candidates: [],
        selectedCandidate: null,
        manualDatabase: '',
        manualSchema: '',
        status: 'no_match' as MappingStatus,
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

    return {
      rowIndex,
      templateRow: row,
      candidates,
      selectedCandidate: candidates[0] ?? null,
      manualDatabase: '',
      manualSchema: '',
      status,
    }
  })
}
