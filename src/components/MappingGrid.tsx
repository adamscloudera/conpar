import { useState } from 'react'
import { ChevronDown, Pencil, Check, Download, CheckCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { useMappingStore } from '../stores/useMappingStore.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'
import type { ConfidenceLevel, MappingResult, MappingStatus } from '../types.ts'
import { classifyTargetTech } from '../Logic/core/connectionClassifier.ts'
import { exportTemplate } from '../Logic/core/exportEngine.ts'

type TechTab = 'all' | 'snowflake' | 'oracle' | 'other' | 'na'

const CONFIDENCE_BADGE: Record<ConfidenceLevel, { label: string; cls: string }> = {
  high:   { label: 'High',   cls: 'badge-green' },
  medium: { label: 'Medium', cls: 'badge-amber' },
  low:    { label: 'Low',    cls: 'badge-red' },
}

// Overlay badge for rows the SE has explicitly finished
const DONE_BADGE: Partial<Record<MappingStatus, { label: string; cls: string }>> = {
  pre_filled:     { label: 'Pre-filled',  cls: 'badge-gray' },
  confirmed:      { label: 'Confirmed',   cls: 'badge-green' },
  manual:         { label: 'Manual',      cls: 'badge-green' },
  not_applicable: { label: 'N/A',         cls: 'badge-gray' },
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
        <span className="font-mono">
          {resolvedDb(result) ? `${resolvedDb(result)}.` : ''}{resolvedSchema(result) || 'Select…'}
        </span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 bg-card border border-border rounded-xl shadow-lg min-w-56 max-h-64 overflow-y-auto">
          {result.candidates.map((c) => (
            <button
              key={`${c.databaseName}.${c.schemaName}`}
              onClick={() => { selectCandidate(result.rowIndex, c); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-primary-surface transition-colors border-b border-border last:border-0"
            >
              <p className="font-mono font-medium text-foreground">{c.databaseName}.{c.schemaName}</p>
              <p className="text-muted mt-0.5">
                {c.sourceFile === 'key-name inference' || c.sourceFile === 'key-name parsing'
                  ? `${c.sourceFile} — confirm or edit`
                  : c.score > 0
                    ? `score ${c.score.toFixed(1)} · key→db ${c.signals.keyDbOverlap} · path ${c.signals.pathTokenOverlap} · table ${c.signals.tableNameOverlap} · freq ${c.signals.sourceFrequency}`
                    : 'no token match — manual selection'}
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

function techFilter(r: MappingResult, tab: TechTab): boolean {
  if (tab === 'all') return true
  if (tab === 'na') return r.status === 'not_applicable'
  const tech = classifyTargetTech(r.templateRow.key)
  if (tab === 'snowflake') return tech === 'snowflake'
  if (tab === 'oracle') return tech === 'oracle' || tech === 'mysql'
  return tech !== 'snowflake' && tech !== 'oracle' && tech !== 'mysql' && r.status !== 'not_applicable'
}

export function MappingGrid() {
  const { results, bulkConfirmHighConfidence } = useMappingStore()
  const { templateType, templateFile } = useTemplateStore()
  const [tab, setTab] = useState<TechTab>('all')

  if (!results.length) return null

  const pathLabel = templateType === 'REPORT' ? 'Report Path' : 'Folder Path'

  const countFor = (t: TechTab) => results.filter((r) => techFilter(r, t)).length
  const highFor  = (t: TechTab) => results.filter((r) => techFilter(r, t) && r.confidence === 'high' && (r.status === 'auto_filled' || r.status === 'needs_selection')).length

  const TABS: { key: TechTab; label: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'snowflake', label: 'Snowflake' },
    { key: 'oracle',    label: 'Oracle' },
    { key: 'other',     label: 'Other' },
    { key: 'na',        label: 'N/A' },
  ]

  const visible = results.filter((r) => techFilter(r, tab))
  const bulkCount = highFor(tab)
  const canExport = !!templateType && !!templateFile

  // Filter function passed to bulkConfirmHighConfidence for the active tab
  const tabFilter = tab === 'all' ? undefined : (r: MappingResult) => techFilter(r, tab)

  return (
    <div className="surface-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Step 4 — Review Matches</h2>
        <div className="flex items-center gap-2">
          {bulkCount > 0 && (
            <button
              onClick={() => bulkConfirmHighConfidence(tabFilter)}
              className="inline-flex items-center gap-1.5 py-1 px-3 text-xs rounded-lg border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Confirm {bulkCount} high-confidence
            </button>
          )}
          {canExport && (
            <button
              onClick={() => exportTemplate(results, templateType!, templateFile!)}
              className="btn-primary py-1 px-3 text-xs"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          )}
        </div>
      </div>

      <div className="segmented-control">
        {TABS.map((t) => (
          <button
            key={t.key}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className="segmented-option"
          >
            {t.label}
            <span className={clsx('badge', tab === t.key ? 'badge-blue' : 'badge-gray')}>{countFor(t.key)}</span>
          </button>
        ))}
      </div>

      {/* Confidence summary bar for active tab */}
      {tab !== 'na' && (() => {
        const rows = results.filter((r) => techFilter(r, tab) && r.status !== 'not_applicable')
        if (!rows.length) return null
        const hi = rows.filter((r) => r.confidence === 'high').length
        const md = rows.filter((r) => r.confidence === 'medium').length
        const lo = rows.filter((r) => r.confidence === 'low').length
        return (
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              {hi} high
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              {md} medium
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
              {lo} low
            </span>
          </div>
        )
      })()}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-muted">
              <th className="text-left px-3 py-2 font-medium border-b border-border">Connection</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">{pathLabel}</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">Confidence</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">Database / Schema</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const done = DONE_BADGE[r.status]
              const conf = CONFIDENCE_BADGE[r.confidence]
              return (
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
                    {done
                      ? <span className={clsx('badge', done.cls)}>{done.label}</span>
                      : <span className={clsx('badge', conf.cls)}>{conf.label}</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-0.5">
                      <CandidateSelector result={r} />
                      <PropagateButton result={r} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
