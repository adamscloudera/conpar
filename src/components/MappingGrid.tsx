import { useState } from 'react'
import { ChevronDown, Pencil, Check, Download, CheckCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { useMappingStore } from '../stores/useMappingStore.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'
import type { CandidateSchema, ConfidenceLevel, MappingResult, MappingStatus } from '../types.ts'
import { classifyTargetTech } from '../Logic/core/connectionClassifier.ts'
import { exportTemplate } from '../Logic/core/exportEngine.ts'

type TechTab = 'all' | 'snowflake' | 'oracle' | 'other' | 'na'

type KeyGroup = {
  key: string
  connectionLogicName: string
  totalRows: number
  primary: MappingResult
}

function buildKeyGroups(results: MappingResult[]): KeyGroup[] {
  const byKey = new Map<string, MappingResult[]>()
  for (const r of results) {
    const g = byKey.get(r.templateRow.key) ?? []
    g.push(r)
    byKey.set(r.templateRow.key, g)
  }
  return Array.from(byKey.entries()).map(([key, rows]) => {
    const primary = rows.find(
      (r) => r.status !== 'pre_filled' && r.status !== 'not_applicable',
    ) ?? rows[0]
    return {
      key,
      connectionLogicName: rows[0].templateRow.connectionLogicName,
      totalRows: rows.length,
      primary,
    }
  })
}

const CONFIDENCE_BADGE: Record<ConfidenceLevel, { label: string; cls: string }> = {
  high:   { label: 'High',   cls: 'badge-green' },
  medium: { label: 'Medium', cls: 'badge-amber' },
  low:    { label: 'Low',    cls: 'badge-red' },
}

const DONE_BADGE: Partial<Record<MappingStatus, { label: string; cls: string }>> = {
  pre_filled:     { label: 'Pre-filled',  cls: 'badge-gray' },
  confirmed:      { label: 'Confirmed',   cls: 'badge-green' },
  manual:         { label: 'Manual',      cls: 'badge-green' },
  not_applicable: { label: 'N/A',         cls: 'badge-gray' },
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
  const { setManualValues, applyToSameKey } = useMappingStore()
  const [editing, setEditing] = useState(false)
  const [db, setDb] = useState(resolvedDb(result))
  const [schema, setSchema] = useState(resolvedSchema(result))

  function commit() {
    if (db || schema) {
      setManualValues(result.rowIndex, db, schema)
      applyToSameKey(result.rowIndex)
    }
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
  const { selectCandidate, applyToSameKey } = useMappingStore()
  const [open, setOpen] = useState(false)

  function pick(c: CandidateSchema) {
    selectCandidate(result.rowIndex, c)
    applyToSameKey(result.rowIndex)
    setOpen(false)
  }

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
              onClick={() => pick(c)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-primary-surface transition-colors border-b border-border last:border-0"
            >
              <p className="font-mono font-medium text-foreground">{c.databaseName}.{c.schemaName}</p>
              <p className="text-muted mt-0.5">
                {c.sourceFile === 'key-name inference' || c.sourceFile === 'key-name parsing'
                  ? `${c.sourceFile} — confirm or edit`
                  : c.score > 0
                    ? `score ${c.score.toFixed(1)} · key→db ${c.signals.keyDbOverlap} · key→schema ${c.signals.keySchemaOverlap} · path ${c.signals.pathTokenOverlap} · table ${c.signals.tableNameOverlap} · freq ${c.signals.sourceFrequency}`
                    : 'no token match — manual selection'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function keyGroupTechFilter(g: KeyGroup, tab: TechTab): boolean {
  if (tab === 'all') return true
  if (tab === 'na') return g.primary.status === 'not_applicable'
  const tech = classifyTargetTech(g.key)
  if (tab === 'snowflake') return tech === 'snowflake'
  if (tab === 'oracle') return tech === 'oracle' || tech === 'mysql'
  return tech !== 'snowflake' && tech !== 'oracle' && tech !== 'mysql'
    && g.primary.status !== 'not_applicable'
}

export function MappingGrid() {
  const { results, bulkConfirmHighConfidence } = useMappingStore()
  const { templateType, templateFile } = useTemplateStore()
  const [tab, setTab] = useState<TechTab>('all')

  if (!results.length) return null

  const groups = buildKeyGroups(results)

  const countFor = (t: TechTab) => groups.filter((g) => keyGroupTechFilter(g, t)).length
  const highFor  = (t: TechTab) => groups.filter((g) =>
    keyGroupTechFilter(g, t) &&
    g.primary.confidence === 'high' &&
    (g.primary.status === 'auto_filled' || g.primary.status === 'needs_selection'),
  ).length

  const TABS: { key: TechTab; label: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'snowflake', label: 'Snowflake' },
    { key: 'oracle',    label: 'Oracle' },
    { key: 'other',     label: 'Other' },
    { key: 'na',        label: 'N/A' },
  ]

  const visible = groups.filter((g) => keyGroupTechFilter(g, tab))
  const bulkCount = highFor(tab)
  const canExport = !!templateType && !!templateFile

  const tabFilter = tab === 'all' ? undefined : (r: MappingResult) => {
    const g = groups.find((gr) => gr.key === r.templateRow.key)
    return g ? keyGroupTechFilter(g, tab) : false
  }

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

      {tab !== 'na' && (() => {
        const actionable = visible.filter((g) => g.primary.status !== 'not_applicable' && g.primary.status !== 'pre_filled')
        if (!actionable.length) return null
        const hi = actionable.filter((g) => g.primary.confidence === 'high').length
        const md = actionable.filter((g) => g.primary.confidence === 'medium').length
        const lo = actionable.filter((g) => g.primary.confidence === 'low').length
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
              <th className="text-left px-3 py-2 font-medium border-b border-border">Connection Key</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border w-16">Rows</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">Confidence</th>
              <th className="text-left px-3 py-2 font-medium border-b border-border">Database / Schema</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => {
              const r = g.primary
              const done = DONE_BADGE[r.status]
              const conf = CONFIDENCE_BADGE[r.confidence]
              return (
                <tr key={g.key} className="border-b border-border last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2">
                    <p className="font-medium text-foreground font-mono truncate max-w-64">{g.key}</p>
                    {g.connectionLogicName && g.connectionLogicName !== g.key && (
                      <p className="text-muted truncate max-w-64">{g.connectionLogicName}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="badge badge-gray">{g.totalRows}</span>
                  </td>
                  <td className="px-3 py-2">
                    {done
                      ? <span className={clsx('badge', done.cls)}>{done.label}</span>
                      : <span className={clsx('badge', conf.cls)}>{conf.label}</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <CandidateSelector result={r} />
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
