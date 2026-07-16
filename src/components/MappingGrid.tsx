import { useState } from 'react'
import { ChevronDown, Pencil, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useMappingStore } from '../stores/useMappingStore.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'
import type { MappingResult, MappingStatus } from '../types.ts'

type FilterTab = 'all' | 'filled' | 'review' | 'no_match';

const STATUS_BADGE: Record<MappingStatus, { label: string; cls: string }> = {
  pre_filled:      { label: 'Pre-filled',       cls: 'badge-gray' },
  auto_filled:     { label: 'Auto-filled',       cls: 'badge-blue' },
  needs_selection: { label: 'Review needed',     cls: 'badge-amber' },
  confirmed:       { label: 'Confirmed',         cls: 'badge-green' },
  no_match:        { label: 'No match',          cls: 'badge-red' },
  manual:          { label: 'Manual',            cls: 'badge-green' },
}

function shortPath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path
  const parts = path.split('\\')
  if (parts.length > 2) return '…\\' + parts.slice(-2).join('\\')
  return path.slice(-maxLen)
}

function resolvedDb(r: MappingResult): string {
  if (r.status === 'pre_filled') return r.templateRow.databaseName
  if (r.status === 'manual') return r.manualDatabase
  return r.selectedCandidate?.databaseName ?? ''
}

function resolvedSchema(r: MappingResult): string {
  if (r.status === 'pre_filled') return r.templateRow.schemaName
  if (r.status === 'manual') return r.manualSchema
  return r.selectedCandidate?.schemaName ?? ''
}

function ManualEdit({ result }: { result: MappingResult }) {
  const { setManualValues } = useMappingStore()
  const [editing, setEditing] = useState(false)
  const [db, setDb] = useState(resolvedDb(result))
  const [schema, setSchema] = useState(resolvedSchema(result))

  function commit() {
    if (db || schema) setManualValues(result.rowIndex, db, schema)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="btn-ghost text-xs">
        <Pencil className="w-3 h-3" /> Edit
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        className="border border-border rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Database"
        value={db}
        onChange={(e) => setDb(e.target.value)}
      />
      <input
        className="border border-border rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Schema"
        value={schema}
        onChange={(e) => setSchema(e.target.value)}
      />
      <button onClick={commit} className="btn-ghost text-xs">
        <Check className="w-3 h-3" />
      </button>
    </div>
  )
}

function CandidateSelector({ result }: { result: MappingResult }) {
  const { selectCandidate } = useMappingStore()
  const [open, setOpen] = useState(false)

  if (!result.candidates.length) return <ManualEdit result={result} />

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors',
          result.status === 'needs_selection'
            ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-border bg-gray-50 text-foreground hover:bg-gray-100',
        )}
      >
        <span className="font-mono">{resolvedSchema(result) || 'Select…'}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 bg-card border border-border rounded-xl shadow-lg min-w-48 max-h-48 overflow-y-auto">
          {result.candidates.map((c) => (
            <button
              key={c.schemaName}
              onClick={() => { selectCandidate(result.rowIndex, c); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-primary-surface transition-colors border-b border-border last:border-0"
            >
              <p className="font-mono font-medium text-foreground">{c.schemaName}</p>
              <p className="text-muted mt-0.5">
                score {c.score.toFixed(1)} · path {c.signals.pathTokenOverlap} · table {c.signals.tableNameOverlap} · freq {c.signals.sourceFrequency}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PropagateButton({ result }: { result: MappingResult }) {
  const { results, applyToSameKey } = useMappingStore()

  const hasValue = result.status === 'confirmed' || result.status === 'auto_filled' || result.status === 'manual'
  if (!hasValue) return null

  const targetCount = results.filter(
    (r) =>
      r.rowIndex !== result.rowIndex &&
      r.templateRow.key === result.templateRow.key &&
      r.status !== 'pre_filled',
  ).length

  if (!targetCount) return null

  return (
    <button
      onClick={() => applyToSameKey(result.rowIndex)}
      className="text-xs text-primary hover:underline leading-none mt-1"
    >
      Apply to {targetCount} other row{targetCount !== 1 ? 's' : ''} with same key
    </button>
  )
}

function filterResults(results: MappingResult[], tab: FilterTab): MappingResult[] {
  if (tab === 'all') return results
  if (tab === 'filled') return results.filter((r) => ['pre_filled', 'auto_filled', 'confirmed', 'manual'].includes(r.status))
  if (tab === 'review') return results.filter((r) => r.status === 'needs_selection')
  return results.filter((r) => r.status === 'no_match')
}

export function MappingGrid() {
  const { results } = useMappingStore()
  const { templateType } = useTemplateStore()
  const [tab, setTab] = useState<FilterTab>('all')

  if (!results.length) return null

  const counts = {
    all: results.length,
    filled: results.filter((r) => ['pre_filled', 'auto_filled', 'confirmed', 'manual'].includes(r.status)).length,
    review: results.filter((r) => r.status === 'needs_selection').length,
    no_match: results.filter((r) => r.status === 'no_match').length,
  }

  const visible = filterResults(results, tab)
  const pathLabel = templateType === 'REPORT' ? 'Report Path' : 'Folder Path'

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'filled', label: 'Filled', count: counts.filled },
    { key: 'review', label: 'Review', count: counts.review },
    { key: 'no_match', label: 'No match', count: counts.no_match },
  ]

  return (
    <div className="surface-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-foreground">Step 4 — Review Matches</h2>

      <div className="segmented-control">
        {TABS.map((t) => (
          <button
            key={t.key}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className="segmented-option"
          >
            {t.label}
            <span className={clsx('badge', tab === t.key ? 'badge-blue' : 'badge-gray')}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-muted">
              <th className="text-left px-3 py-2 font-medium border-b border-border">Connection</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">{pathLabel}</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">Status</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">Database / Schema</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.rowIndex} className="border-b border-border last:border-0 hover:bg-gray-50 transition-colors">
                <td className="px-3 py-2">
                  <p className="font-medium text-foreground truncate max-w-32">{r.templateRow.connectionLogicName}</p>
                  <p className="text-muted truncate max-w-32">{r.templateRow.key}</p>
                </td>
                <td className="px-3 py-2 max-w-xs">
                  <span className="font-mono text-foreground" title={r.templateRow.path}>
                    {shortPath(r.templateRow.path)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={clsx('badge', STATUS_BADGE[r.status].cls)}>
                    {STATUS_BADGE[r.status].label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-0.5">
                    <CandidateSelector result={r} />
                    <PropagateButton result={r} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
