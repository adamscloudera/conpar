import type { CandidateSchema, DiscoveryFile, MappingResult, MappingStatus, TemplateRow } from '../../types.ts'
import { canonicalToken, extractPathTokens } from './tokenExtractor.ts'

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
      signals: { pathTokenOverlap, tableNameOverlap, sourceFrequency },
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

  // Group by (databaseName, schemaName)
  const schemaGroups = new Map<string, typeof file.impalaRows>()
  for (const ir of file.impalaRows) {
    if (dbFilter && canonicalToken(ir.databaseName) !== dbFilter) continue

    const key = canonicalToken(ir.schemaName) || canonicalToken(ir.databaseName)
    if (!key) continue
    const existing = schemaGroups.get(key) ?? []
    existing.push(ir)
    schemaGroups.set(key, existing)
  }

  const candidates: CandidateSchema[] = []
  for (const [, rows] of schemaGroups) {
    const schema = rows[0].schemaName
    const db = rows[0].databaseName
    const pathTokenOverlap = tokenOverlap(pathTokens, schema)
    const tableNameOverlap = rows.reduce((acc, ir) => acc + tokenOverlap(pathTokens, ir.objectName), 0)
    const sourceFrequency = rows.filter((ir) => tokenOverlap(pathTokens, ir.objectName) > 0).length

    if (pathTokenOverlap === 0 && tableNameOverlap === 0) continue

    const score = pathTokenOverlap * 3 + tableNameOverlap * 2 + Math.min(sourceFrequency, 5)
    candidates.push({
      databaseName: db || schema,
      schemaName: schema,
      score,
      signals: { pathTokenOverlap, tableNameOverlap, sourceFrequency },
      sourceFile: file.filename,
    })
  }

  return candidates
}

function mergeCandidates(all: CandidateSchema[]): CandidateSchema[] {
  const merged = new Map<string, CandidateSchema>()
  for (const c of all) {
    const key = canonicalToken(c.schemaName)
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

    // Drop candidates scoring below 15% of the top to remove noise from display;
    // keep at least the top 3 so the user still has options.
    const topScore = merged[0].score
    const meaningful = merged.filter((c) => c.score >= topScore * 0.15)
    const candidates = meaningful.length >= 3 ? meaningful : merged.slice(0, 3)

    // Auto-fill when winner is dominant (≥2.5× runner-up) — a keyword-search
    // Impala file will always produce multiple schemas, so strict count=1 is too narrow.
    const dominant =
      candidates.length === 1 ||
      (candidates.length > 1 && candidates[0].score >= candidates[1].score * 2.5)

    const status: MappingStatus = dominant ? 'auto_filled' : 'needs_selection'
    return {
      rowIndex,
      templateRow: row,
      candidates,
      selectedCandidate: candidates[0],
      manualDatabase: '',
      manualSchema: '',
      status,
    }
  })
}
