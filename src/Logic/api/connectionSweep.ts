import type { AssetItem, OctopaiClient } from '@adamscloudera/octopai-api'
import type { TemplateRow } from '../../types.ts'
import { classifyConnectionKey } from '../core/connectionClassifier.ts'

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

  // Stage 2b: Per-connection targeted fetch using ConnectionIds filter.
  for (let i = 0; i < connectionNames.length; i++) {
    if (signal?.aborted) break
    const name = connectionNames[i]
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

  for (const [, result] of sweepResults) {
    for (const item of result.rawItems) {
      if (item.toolType !== 'DB' && item.isObjectData !== true) continue
      const db = item.databaseName ?? ''
      const schema = item.schemaName ?? ''
      if (!db && !schema) continue

      const key = `${(item.connectionName ?? '').toLowerCase()}\x00${db}\x00${schema}\x00${item.objectName ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }

  return items
}
