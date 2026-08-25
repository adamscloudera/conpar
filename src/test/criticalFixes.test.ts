import { describe, it, expect } from 'vitest'
import { resolvedValues } from '../Logic/core/exportEngine.ts'
import { computeMappings } from '../Logic/core/matchingEngine.ts'
import type { CandidateSchema, DiscoveryFile, MappingResult, TemplateRow } from '../types.ts'

const NO_SIGNALS = { pathTokenOverlap: 0, tableNameOverlap: 0, sourceFrequency: 0, keyDbOverlap: 0, keySchemaOverlap: 0 }

const BASE_ROW: TemplateRow = {
  connectionLogicName: 'MyConn',
  toolName: 'OBIEE',
  key: 'MY_KEY',
  path: 'some/alpha/beta',
  serverName: 'myserver',
  databaseName: 'MY_DB',
  schemaName: '',
}

// ── resolvedValues ────────────────────────────────────────────────────────────

describe('resolvedValues — lineage_map databaseName fallback', () => {
  it('falls back to templateRow.databaseName when selectedCandidate.databaseName is empty', () => {
    // This is the bug: candidatesFromLineageMap hardcoded databaseName:'' because
    // the lineage_map CSV format has no database column. The fix adds a fallback
    // to the template row's known database so the exported CSV is not corrupted.
    const candidate: CandidateSchema = {
      databaseName: '',
      schemaName: 'MY_SCHEMA',
      score: 5,
      signals: NO_SIGNALS,
      sourceFile: 'lineage.csv',
    }
    const result: MappingResult = {
      rowIndex: 0,
      templateRow: BASE_ROW,
      candidates: [candidate],
      selectedCandidate: candidate,
      manualDatabase: '',
      manualSchema: '',
      status: 'auto_filled',
      confidence: 'high',
    }
    const { databaseName, schemaName } = resolvedValues(result)
    expect(databaseName).toBe('MY_DB')
    expect(schemaName).toBe('MY_SCHEMA')
  })

  it('does not override a non-empty candidate databaseName', () => {
    const candidate: CandidateSchema = {
      databaseName: 'CANDIDATE_DB',
      schemaName: 'CANDIDATE_SCHEMA',
      score: 20,
      signals: NO_SIGNALS,
      sourceFile: 'impala.csv',
    }
    const result: MappingResult = {
      rowIndex: 0,
      templateRow: { ...BASE_ROW, databaseName: 'OTHER_DB' },
      candidates: [candidate],
      selectedCandidate: candidate,
      manualDatabase: '',
      manualSchema: '',
      status: 'auto_filled',
      confidence: 'high',
    }
    expect(resolvedValues(result).databaseName).toBe('CANDIDATE_DB')
  })

  it('strips the -1 sentinel from templateRow.databaseName used as fallback', () => {
    const candidate: CandidateSchema = {
      databaseName: '',
      schemaName: 'MY_SCHEMA',
      score: 5,
      signals: NO_SIGNALS,
      sourceFile: 'lineage.csv',
    }
    const result: MappingResult = {
      rowIndex: 0,
      templateRow: { ...BASE_ROW, databaseName: '-1' },
      candidates: [candidate],
      selectedCandidate: candidate,
      manualDatabase: '',
      manualSchema: '',
      status: 'auto_filled',
      confidence: 'high',
    }
    // Fallback should treat -1 as '' (unresolved sentinel), not forward it to the CSV
    expect(resolvedValues(result).databaseName).toBe('')
  })
})

// ── computeMappings — R07 floor + single-candidate path ──────────────────────

describe('computeMappings — R07 score floor, single lineage_map candidate', () => {
  // Score formula: pathTokenOverlap*3 + tableNameOverlap*2 + min(sourceFrequency, 5)
  // For MY_SCHEMA: pathTokenOverlap=0 because SCHEMA is a stop word and MY is < 3 chars.
  // For T1-T5: tableNameOverlap=0 because object names are < 3 chars (dropped by tokenizer).
  // sourceFrequency=5 (5 rows all matching the report path).
  // → score = 0 + 0 + 5 = 5, exactly at DOMINANT_SCORE_FLOOR.
  //
  // The single-candidate path (nonZero.length===1) bypasses the 2.5x ratio check,
  // so the floor is the only gate. This test verifies that boundary.

  const LINEAGE_FILE: DiscoveryFile = {
    id: 'lm1',
    filename: 'lineage.csv',
    type: 'lineage_map',
    rowCount: 5,
    lineageRows: Array.from({ length: 5 }, (_, i) => ({
      sourceConnectionKey: 'MY_KEY',
      sourceSchemaName: 'MY_SCHEMA',
      sourceObjectName: `T${i + 1}`,
      sourceConnectionName: 'MyConn',
      targetReportPath: 'some/alpha/beta',
    })),
    impalaRows: [],
  }

  it('auto-fills and assigns knownDb to the candidate when score equals the floor', () => {
    const [result] = computeMappings([BASE_ROW], [LINEAGE_FILE])
    expect(result.status).toBe('auto_filled')
    expect(result.confidence).toBe('high')
    expect(result.selectedCandidate?.databaseName).toBe('MY_DB')
    expect(result.selectedCandidate?.schemaName).toBe('MY_SCHEMA')
  })

  it('falls to needs_selection when the sole candidate scores below the floor', () => {
    // Drop to 4 rows so sourceFrequency = 4 → score = 4 < DOMINANT_SCORE_FLOOR = 5
    const lowFile: DiscoveryFile = {
      ...LINEAGE_FILE,
      rowCount: 4,
      lineageRows: LINEAGE_FILE.lineageRows.slice(0, 4),
    }
    const [result] = computeMappings([BASE_ROW], [lowFile])
    expect(result.status).toBe('needs_selection')
  })
})

// ── computeMappings — lineage_map + impala_columns merge ─────────────────────

describe('computeMappings — lineage_map + impala_columns same schema', () => {
  // Before the candidatesFromLineageMap fix, the lineage_map candidate keyed as
  // '||MY_SCHEMA' (empty databaseName) while the impala candidate keyed as
  // 'MY_DB||MY_SCHEMA', producing two separate candidates. Neither was dominant
  // in some configurations. After the fix, both key as 'MY_DB||MY_SCHEMA' and
  // merge into one candidate (highest score wins), preserving auto_fill.

  it('merges into one candidate with correct databaseName and auto-fills', () => {
    const lineageFile: DiscoveryFile = {
      id: 'lm1',
      filename: 'lineage.csv',
      type: 'lineage_map',
      rowCount: 5,
      lineageRows: Array.from({ length: 5 }, (_, i) => ({
        sourceConnectionKey: 'MY_KEY',
        sourceSchemaName: 'MY_SCHEMA',
        sourceObjectName: `T${i + 1}`,
        sourceConnectionName: 'MyConn',
        targetReportPath: 'some/alpha/beta',
      })),
      impalaRows: [],
    }
    const impalaFile: DiscoveryFile = {
      id: 'imp1',
      filename: 'impala.csv',
      type: 'impala_columns',
      rowCount: 1,
      lineageRows: [],
      impalaRows: [{
        databaseName: 'MY_DB',
        schemaName: 'MY_SCHEMA',
        objectName: 'T1',
        objectType: 'TABLE',
        columnName: 'ID',
        dataType: 'INT',
        connectionLogicName: 'MyConn',
        connectionId: '1',
        toolName: 'OBIEE',
      }],
    }
    const [result] = computeMappings([BASE_ROW], [lineageFile, impalaFile])
    expect(result.status).toBe('auto_filled')
    expect(result.selectedCandidate?.databaseName).toBe('MY_DB')
    // One merged candidate, not two split by databaseName
    expect(result.candidates.length).toBe(1)
  })
})
