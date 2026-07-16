import { Download, AlertTriangle } from 'lucide-react'
import { useMappingStore } from '../stores/useMappingStore.ts'
import { useTemplateStore } from '../stores/useTemplateStore.ts'
import { exportTemplate } from '../Logic/core/exportEngine.ts'

export function ExportPanel() {
  const { results } = useMappingStore()
  const { templateType, templateFile } = useTemplateStore()

  if (!results.length || !templateType || !templateFile) return null

  const autoFilled = results.filter((r) => r.status === 'auto_filled').length
  const confirmed = results.filter((r) => ['confirmed', 'manual', 'pre_filled'].includes(r.status)).length
  const needsReview = results.filter((r) => r.status === 'needs_selection').length
  const noMatch = results.filter((r) => r.status === 'no_match').length

  function doExport() {
    exportTemplate(results, templateType!, templateFile!)
  }

  return (
    <div className="surface-card p-5 space-y-4">
      <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Download className="w-4 h-4 text-primary" />
        Step 5 — Export
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Auto-filled', value: autoFilled, color: 'text-blue-600' },
          { label: 'Confirmed', value: confirmed, color: 'text-green-600' },
          { label: 'Needs review', value: needsReview, color: 'text-amber-600' },
          { label: 'No match', value: noMatch, color: 'text-red-600' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-gray-50 px-3 py-2 text-center">
            <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-muted mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {(needsReview > 0 || noMatch > 0) && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            {needsReview > 0 && `${needsReview} row${needsReview > 1 ? 's' : ''} need manual selection. `}
            {noMatch > 0 && `${noMatch} row${noMatch > 1 ? 's' : ''} have no match and will export with empty fields.`}
          </p>
        </div>
      )}

      <button onClick={doExport} className="btn-primary">
        <Download className="w-4 h-4" />
        Download populated template
      </button>
    </div>
  )
}
