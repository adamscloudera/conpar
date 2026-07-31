import type { AssetItem, LineageNode } from './apiClient.ts'
import type { DiscoveryFile, ImpalaColumnsRow } from '../../types.ts'

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function assetToRow(item: AssetItem | LineageNode): ImpalaColumnsRow {
  return {
    databaseName: item.databaseName ?? '',
    schemaName: item.schemaName ?? '',
    objectName: item.objectName ?? '',
    objectType: item.objectType ?? '',
    columnName: '',
    dataType: '',
    connectionLogicName: item.connectionName ?? '',
    connectionId: ('connectionId' in item ? item.connectionId : undefined) ?? '',
  }
}

// Deduplicate rows by (databaseName, schemaName, objectName) triple.
// The Assets API may return the same schema multiple times for different
// columns; we only need one representative row per object for matching.
function dedupeRows(rows: ImpalaColumnsRow[]): ImpalaColumnsRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const key = `${r.databaseName}\x00${r.schemaName}\x00${r.objectName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function assetsToDiscoveryFile(
  items: AssetItem[],
  lineageNodes: LineageNode[] = [],
  label = 'API Lookup',
): DiscoveryFile {
  const rows = dedupeRows([
    ...items.map(assetToRow),
    ...lineageNodes.map(assetToRow),
  ])

  return {
    id: generateId(),
    filename: label,
    type: 'api_lookup',
    rowCount: rows.length,
    lineageRows: [],
    impalaRows: rows,
  }
}
