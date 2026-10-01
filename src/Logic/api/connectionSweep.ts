import type { AssetItem, OctopaiClient } from '@adamscloudera/octopai-api'
import type { TemplateRow } from '../../types.ts'
import { classifyConnectionKey } from '../core/connectionClassifier.ts'
import { classifyText } from './decisionEngine.ts'

export type ConnectionInventory = {
  needsSweep: Array<{ connectionLogicName: string; rowCount: number }>
  preFilled: number
  notApplicable: number
}

type ConnectionMeta = {
  connectionId: string
  toolName: string
  toolType: string
}

type SweepResult = ConnectionMeta & { rawItems: AssetItem[] }

export type SweepResults = Map<string, SweepResult>

export type CoverageSummary = {
  total: number
  na: number
  swept: number
  resolved: number
  unresolved: number
}

const NA_CLASSES = new Set(['file_path', 'salesforce', 'redshift'])

// Stage 1: Partition template rows into pre-filled, not-applicable, and the
// unique set of connections that need API sweeping. Deduplicates by
// connectionLogicName so the sweep makes one call per connection, not per row.
export function intakeTemplate(rows: TemplateRow[]): ConnectionInventory {
  let preFilled = 0
  let notApplicable = 0
  const connectionCounts = new Map<string, number>()

  for (const row of rows) {
    const db = row.databaseName && row.databaseName !== '-1' ? row.databaseName : ''
    const schema = row.schemaName && row.schemaName !== '-1' ? row.schemaName : ''

    if (db && schema) {
      preFilled++
      continue
    }

    if (NA_CLASSES.has(classifyConnectionKey(row.key))) {
      notApplicable++
      continue
    }

    const name = row.connectionLogicName
    if (name) {
      connectionCounts.set(name, (connectionCounts.get(name) ?? 0) + 1)
    }
  }

  const needsSweep = Array.from(connectionCounts.entries())
    .map(([connectionLogicName, rowCount]) => ({ connectionLogicName, rowCount }))
    .sort((a, b) => b.rowCount - a.rowCount)

  return { needsSweep, preFilled, notApplicable }
}

// Stage 2: For each connection in the needs-sweep list, fetch a targeted
// asset sample using the ConnectionIds filter. Requires knowing the numeric
// Octopai connectionId, which is obtained from a small index batch first.
export async function sweepConnections(
  client: OctopaiClient,
  company: string,
  token: string,
  connectionNames: string[],
  onProgress: (done: number, total: number, current: string) => void,
  signal?: AbortSignal,
): Promise<SweepResults> {
  const results: SweepResults = new Map()

  // Stage 2a: Small index fetch (200 items) to build name→meta map.
  // connectionId field on AssetItem gives us the numeric ID for scoped queries.
  const indexItems = await client.queryAssetsForIndex(company, token, signal)

  const idMap = new Map<string, ConnectionMeta>()
  for (const item of indexItems) {
    const name = (item.connectionName ?? '').toLowerCase()
    if (name && item.connectionId && !idMap.has(name)) {
      idMap.set(name, {
        connectionId: item.connectionId,
        toolName: item.toolName ?? '',
        toolType: item.toolType ?? '',
      })
    }
  }

  // Stage 2a enrichment: entries the regex missed (toolName empty or 'UNK') are
  // sent to the local decision-engine for a best-effort classification pass.
  // Runs in parallel; if the server is down all calls silently return null and
  // the sweep continues with whatever the API gave.
  const CLASSIFY_LABELS = [
    'SNOWFLAKE', 'ORACLE', 'MYSQL', 'POSTGRESQL', 'REDSHIFT', 'BIGQUERY', 'TABLEAU',
    'POWERBI', 'DBT', 'INFORMATICA_CLOUD', 'INFORMATICA', 'MSSQL', 'SAP', 'SAPHANA',
    'EEOBIEE', 'unknown',
  ]
  const unknownEntries = Array.from(idMap.entries()).filter(
    ([, meta]) => !meta.toolName || meta.toolName === 'UNK',
  )
  if (unknownEntries.length > 0) {
    await Promise.all(
      unknownEntries.map(async ([name, meta]) => {
        const result = await classifyText(name, CLASSIFY_LABELS)
        if (result && result !== 'unknown') {
          meta.toolName = result
        }
      }),
    )
  }

  // Stage 2b: Per-connection targeted fetch using ConnectionIds filter.
  // No AI pre-screening here — sweepToItems already discards non-DB assets on
  // output, so the cost of sweeping an ETL or BI connection is at most one
  // empty API call. NA_CLASSES above handles the static known-useless cases.
  const sweepQueue = connectionNames
  for (let i = 0; i < sweepQueue.length; i++) {
    if (signal?.aborted) break
    const name = sweepQueue[i]
    onProgress(i, connectionNames.length, name)

    const lower = name.toLowerCase()
    const meta = idMap.get(lower)

    if (!meta) {
      // Not found in index — ETL-only connection with no catalogued DB objects.
      results.set(lower, { connectionId: '', toolName: '', toolType: '', rawItems: [] })
      continue
    }

    try {
      const items = await client.queryAssetsForConnection(company, token, meta.connectionId, signal)
      results.set(lower, { ...meta, rawItems: items })
    } catch {
      results.set(lower, { ...meta, rawItems: [] })
    }
  }

  onProgress(connectionNames.length, connectionNames.length, '')
  return results
}

// Stage 3: Filter sweep raw items to actual DB objects before injection.
// Discard ETL mapping nodes (toolType='ETL', isObjectData=false) whose
// databaseName/schemaName fields are empty or unreliable.
// Customer-agnostic — makes no assumptions about tool stack topology.
export function sweepToItems(sweepResults: SweepResults): AssetItem[] {
  const items: AssetItem[] = []
  const seen = new Set<string>()

  for (const [connName, result] of sweepResults) {
    for (const item of result.rawItems) {
      if (item.toolType !== 'DB' && item.isObjectData !== true) continue
      const db = item.databaseName ?? ''
      const schema = item.schemaName ?? ''
      if (!db && !schema) continue

      // The ConnectionIds-filtered API response often omits connLogicName on each item
      // because the caller already knows the connection. Backfill from the sweep map key
      // so Quick Assign has connection names to work with, and matching can group correctly.
      const effectiveItem = item.connectionName ? item : { ...item, connectionName: connName }

      const key = `${effectiveItem.connectionName.toLowerCase()}\x00${db}\x00${schema}\x00${effectiveItem.objectName ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(effectiveItem)
    }
  }

  return items
}

// Coverage summary: how many template rows ended up with full db+schema metadata
// after the sweep. Pre-filled rows and N/A rows are counted toward totals but
// only API-returned items (with both databaseName and schemaName) count as resolved.
export function computeCoverage(inventory: ConnectionInventory, items: AssetItem[]): CoverageSummary {
  const total =
    inventory.preFilled +
    inventory.notApplicable +
    inventory.needsSweep.reduce((sum, c) => sum + c.rowCount, 0)
  const na = inventory.notApplicable
  const swept = total - na
  const resolved = items.filter(
    (item) => (item.databaseName ?? '') !== '' && (item.schemaName ?? '') !== '',
  ).length
  const unresolved = swept - resolved
  return { total, na, swept, resolved, unresolved }
}
