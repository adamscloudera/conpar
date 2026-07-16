import { useRef, useState } from 'react'
import { FileSpreadsheet, X, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { parseTemplate } from '../Logic/readers/templateReader.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'

export function TemplateUploadPanel() {
  const { templateFile, templateType, rows, parseError, setTemplate, clearTemplate, setParseError } = useTemplateStore()
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setParseError('Only .xlsx files are supported')
      return
    }
    setLoading(true)
    try {
      const result = await parseTemplate(file)
      setTemplate(file, result.type, result.rows, result.connectionKeys, result.connectionLogicNames)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse template')
    } finally {
      setLoading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const unfilledCount = rows.filter((r) => !r.databaseName && !r.schemaName).length
  const preFilledCount = rows.length - unfilledCount

  return (
    <div className="surface-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-primary" />
        Step 1 — Connection Parameters Template
      </h2>

      {!templateFile ? (
        <div
          className={clsx('drop-zone', dragging && 'drag-over')}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-muted" />
          <p className="text-sm font-medium text-foreground">Drop template XLSX here</p>
          <p className="text-xs text-muted">or click to browse</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>
      ) : (
        <div className="flex items-start gap-3 p-3 rounded-xl border border-border bg-gray-50">
          <FileSpreadsheet className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{templateFile.name}</p>
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="badge badge-blue">{templateType} template</span>
              <span className="badge badge-gray">{rows.length} rows total</span>
              {preFilledCount > 0 && <span className="badge badge-green">{preFilledCount} pre-filled</span>}
              {unfilledCount > 0 && <span className="badge badge-amber">{unfilledCount} need population</span>}
            </div>
          </div>
          <button onClick={clearTemplate} className="shrink-0 text-muted hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading && <p className="text-xs text-muted">Parsing template…</p>}
      {parseError && <p className="text-xs text-red-600">{parseError}</p>}
    </div>
  )
}
