import Papa from 'papaparse'
import type { DiscoveryFile, DiscoveryFileType, ImpalaColumnsRow, LineageRow } from '../../types.ts'

const IMPALA_COLUMNS_HEADERS = new Set([
  'Database Name',
  'Schema Name',
  'Object Name',
  'Object Type',
  'Column Name',
  'Data Type',
  'Connection Logic Name',
  'CONNECTION_ID',
])

function detectFormat(firstRow: string[]): DiscoveryFileType {
  if (firstRow[0]?.trim().toUpperCase().startsWith('DATABASE TO REPORT')) return 'lineage_map'
  const headerSet = new Set(firstRow.map((h) => h.trim()))
  const impalaMatch = [...IMPALA_COLUMNS_HEADERS].filter((h) => headerSet.has(h)).length
  if (impalaMatch >= 5) return 'impala_columns'
  return 'unknown'
}

function parseLineageMap(rawRows: string[][]): LineageRow[] {
  // Row 0: title, Row 1: empty, Row 2: section labels, Row 3: headers, Row 4+: data
  const dataRows = rawRows.slice(4)
  const results: LineageRow[] = []
  for (const row of dataRows) {
    if (!row[0]?.trim()) continue // skip empty rows
    results.push({
      sourceConnectionKey: (row[2] ?? '').trim(),  // "Database Name" col
      sourceSchemaName: (row[3] ?? '').trim(),       // "Schema Name" col
      sourceObjectName: (row[4] ?? '').trim(),       // "Object Name" col
      sourceConnectionName: (row[6] ?? '').trim(),   // "Connection Name" col
      targetReportPath: (row[12] ?? '').trim(),      // "Report Path" col
    })
  }
  return results
}

function parseImpalaColumns(rows: Record<string, string>[]): ImpalaColumnsRow[] {
  return rows.map((r) => ({
    databaseName: (r['Database Name'] ?? '').trim(),
    schemaName: (r['Schema Name'] ?? '').trim(),
    objectName: (r['Object Name'] ?? '').trim(),
    objectType: (r['Object Type'] ?? '').trim(),
    columnName: (r['Column Name'] ?? '').trim(),
    dataType: (r['Data Type'] ?? '').trim(),
    connectionLogicName: (r['Connection Logic Name'] ?? '').trim(),
    connectionId: (r['CONNECTION_ID'] ?? '').trim(),
  }))
}

export function parseDiscoveryFile(file: File): Promise<DiscoveryFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target!.result as string

      // First parse raw to detect format
      const rawResult = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false })
      if (rawResult.errors.length && !rawResult.data.length) {
        reject(new Error('Failed to parse CSV'))
        return
      }

      const firstRow = (rawResult.data[0] ?? []) as string[]
      const format = detectFormat(firstRow)

      if (format === 'lineage_map') {
        const lineageRows = parseLineageMap(rawResult.data as string[][])
        resolve({
          id: crypto.randomUUID(),
          filename: file.name,
          type: 'lineage_map',
          rowCount: lineageRows.length,
          lineageRows,
          impalaRows: [],
        })
      } else if (format === 'impala_columns') {
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
        const impalaRows = parseImpalaColumns(parsed.data)
        resolve({
          id: crypto.randomUUID(),
          filename: file.name,
          type: 'impala_columns',
          rowCount: impalaRows.length,
          lineageRows: [],
          impalaRows,
        })
      } else {
        resolve({
          id: crypto.randomUUID(),
          filename: file.name,
          type: 'unknown',
          rowCount: rawResult.data.length,
          lineageRows: [],
          impalaRows: [],
        })
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
