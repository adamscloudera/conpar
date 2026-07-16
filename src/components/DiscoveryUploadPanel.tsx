import { useRef, useState } from 'react'
import { FileText, X, Plus, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { parseDiscoveryFile } from '../Logic/readers/discoveryReader.ts'
import { useDiscoveryStore } from '../stores/useDiscoveryStore.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'

const FORMAT_LABELS: Record<string, string> = {
  lineage_map: 'Lineage Map',
  impala_columns: 'Impala Columns',
  unknown: 'Unknown format',
}

export function DiscoveryUploadPanel() {
  const { templateType } = useTemplateStore()
  const { files, addFile, removeFile } = useDiscoveryStore()
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-gray-50">
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
              <button onClick={() => removeFile(file.id)} className="shrink-0 text-muted hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
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
