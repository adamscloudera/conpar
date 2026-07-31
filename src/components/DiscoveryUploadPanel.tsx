import { useRef, useState } from 'react'
import { FileText, X, Plus, AlertCircle, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { parseDiscoveryFile } from '../Logic/readers/discoveryReader.ts'
import { useDiscoveryStore } from '../stores/useDiscoveryStore.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'

const FORMAT_LABELS: Record<string, string> = {
  lineage_map: 'Lineage Map',
  impala_columns: 'Impala Columns',
  api_lookup: 'API Lookup',
  unknown: 'Unknown format',
}

export function DiscoveryUploadPanel() {
  const { templateType } = useTemplateStore()
  const { files, addFile, removeFile } = useDiscoveryStore()
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  if (!templateType) return null

  async function handleFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList).filter((f) => f.name.endsWith('.csv'))
    if (!arr.length) { setError('Only .csv files are supported'); return }
    setError(null)
    setLoading(true)
    try {
      for (const file of arr) {
        const result = await parseDiscoveryFile(file)
        addFile(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
    } finally {
      setLoading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="surface-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
        <FileText className="w-4 h-4 text-primary" />
        Step 3 — Discovery Exports
        <span className="text-xs font-normal text-muted">(optional, multiple supported)</span>
      </h2>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file) => {
            const isExpanded = expandedFileId === file.id
            const canExpand = file.impalaRows.length > 0
            return (
              <li key={file.id} className="rounded-xl border border-border bg-gray-50">
                <div className="flex items-center gap-3 p-3">
                  <FileText className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{file.filename}</p>
                    <div className="flex gap-2 mt-0.5">
                      <span className={clsx('badge', file.type === 'unknown' ? 'badge-amber' : 'badge-blue')}>
                        {FORMAT_LABELS[file.type]}
                      </span>
                      <span className="badge badge-gray">{file.rowCount} rows</span>
                    </div>
                  </div>
                  {file.type === 'unknown' && (
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" aria-label="Format not recognised" />
                  )}
                  {canExpand && (
                    <button
                      onClick={() => setExpandedFileId(isExpanded ? null : file.id)}
                      className="shrink-0 text-muted hover:text-foreground transition-colors"
                      title={isExpanded ? 'Hide rows' : 'Show rows'}
                    >
                      <ChevronDown className={clsx('w-4 h-4 transition-transform duration-150', isExpanded && 'rotate-180')} />
                    </button>
                  )}
                  <button onClick={() => removeFile(file.id)} className="shrink-0 text-muted hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="border-t border-border/60 max-h-64 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-[11px] font-mono">
                      <thead className="sticky top-0 bg-gray-100 border-b border-border/60">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold text-muted whitespace-nowrap">Connection</th>
                          <th className="px-2 py-1 text-left font-semibold text-muted whitespace-nowrap">Database</th>
                          <th className="px-2 py-1 text-left font-semibold text-muted whitespace-nowrap">Schema</th>
                          <th className="px-2 py-1 text-left font-semibold text-muted whitespace-nowrap">Object</th>
                        </tr>
                      </thead>
                      <tbody>
                        {file.impalaRows.map((row, i) => (
                          <tr key={i} className={clsx('border-b border-border/40 last:border-0', i % 2 === 0 ? 'bg-gray-50' : 'bg-white')}>
                            <td className="px-2 py-0.5 text-muted">{row.connectionLogicName || '—'}</td>
                            <td className="px-2 py-0.5">{row.databaseName || '—'}</td>
                            <td className="px-2 py-0.5">{row.schemaName || '—'}</td>
                            <td className="px-2 py-0.5">{row.objectName || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div
        className={clsx('drop-zone', dragging && 'drag-over')}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Plus className="w-6 h-6 text-muted" />
        <p className="text-sm font-medium text-foreground">
          {files.length ? 'Add another discovery CSV' : 'Drop discovery CSV here'}
        </p>
        <p className="text-xs text-muted">Impala Columns export or lineage map CSV</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files) }}
        />
      </div>

      {loading && <p className="text-xs text-muted">Parsing file…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
