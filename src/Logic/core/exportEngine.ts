import * as XLSX from 'xlsx'
import type { MappingResult, TemplateType } from '../../types.ts'

function resolvedValues(result: MappingResult): { serverName: string; databaseName: string; schemaName: string } {
  if (result.status === 'pre_filled' || result.status === 'manual') {
    return {
      serverName: result.templateRow.serverName,
      databaseName: result.manualDatabase || result.templateRow.databaseName,
      schemaName: result.manualSchema || result.templateRow.schemaName,
    }
  }
  if (result.selectedCandidate) {
    return {
      serverName: result.templateRow.serverName,
      databaseName: result.selectedCandidate.databaseName,
      schemaName: result.selectedCandidate.schemaName,
    }
  }
  const sentinel = (v: string) => (v === '-1' ? '' : v)
  return {
    serverName: result.templateRow.serverName,
    databaseName: sentinel(result.templateRow.databaseName),
    schemaName: sentinel(result.templateRow.schemaName),
  }
}

export function exportTemplate(
  results: MappingResult[],
  templateType: TemplateType,
  originalFilename: string,
): void {
  const pathKey = templateType === 'REPORT' ? 'Report Path' : 'Folder Path'

  const rows = results.map((r) => {
    const { serverName, databaseName, schemaName } = resolvedValues(r)
    return {
      'Connection Logic Name': r.templateRow.connectionLogicName,
      'Tool Name': r.templateRow.toolName,
      'Key': r.templateRow.key,
      [pathKey]: r.templateRow.path,
      'Server Name': serverName,
      'Database Name': databaseName,
      'Schema Name': schemaName,
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

  const base = originalFilename.replace(/\.[^.]+$/, '').replace(/_populated$/, '')
  XLSX.writeFile(wb, `${base}_populated.xlsx`)
}
