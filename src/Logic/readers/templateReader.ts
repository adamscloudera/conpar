import * as XLSX from 'xlsx'
import type { TemplateRow, TemplateType } from '../../types.ts'

export type ParsedTemplate = {
  type: TemplateType;
  rows: TemplateRow[];
  connectionKeys: string[];
  connectionLogicNames: string[];
};

export function parseTemplate(file: File): Promise<ParsedTemplate> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })

        if (!rawRows.length) {
          reject(new Error('Template file is empty'))
          return
        }

        const headers = Object.keys(rawRows[0])
        const type: TemplateType = headers.includes('Report Path') ? 'REPORT' : 'ETL'
        const pathKey = type === 'REPORT' ? 'Report Path' : 'Folder Path'

        const rows: TemplateRow[] = rawRows.map((r) => ({
          connectionLogicName: String(r['Connection Logic Name'] ?? '').trim(),
          toolName: String(r['Tool Name'] ?? '').trim(),
          key: String(r['Key'] ?? '').trim(),
          path: String(r[pathKey] ?? '').trim(),
          serverName: String(r['Server Name'] ?? '').trim(),
          databaseName: String(r['Database Name'] ?? '').trim(),
          schemaName: String(r['Schema Name'] ?? '').trim(),
        }))

        const connectionKeys = [...new Set(rows.map((r) => r.key).filter(Boolean))]
        const connectionLogicNames = [...new Set(rows.map((r) => r.connectionLogicName).filter(Boolean))]

        resolve({ type, rows, connectionKeys, connectionLogicNames })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}
