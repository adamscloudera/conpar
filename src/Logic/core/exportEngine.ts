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
  originalFile: File,
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

  // Re-read the original file so the exported workbook retains Octopai's
  // metadata (Author: "Kendo UI", AppVersion, etc.) which the tenant
  // import validator checks.
  const fileReader = new FileReader()
  fileReader.onload = (e) => {
    const data = new Uint8Array(e.target!.result as ArrayBuffer)
    const wb = XLSX.read(data, { type: 'array' })
    wb.Sheets['Sheet1'] = XLSX.utils.json_to_sheet(rows)
    const base = originalFile.name.replace(/\.[^.]+$/, '').replace(/_populated$/, '')
    XLSX.writeFile(wb, `${base}_populated.xlsx`)
  }
  fileReader.readAsArrayBuffer(originalFile)
}
