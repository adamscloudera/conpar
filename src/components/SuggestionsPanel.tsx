import { useState } from 'react'
import { Lightbulb, Copy, Check } from 'lucide-react'
import { useTemplateStore } from '../stores/useTemplateStore.ts'
import { generateSuggestions } from '../Logic/core/suggestionEngine.ts'

export function SuggestionsPanel() {
  const { rows, templateType } = useTemplateStore()
  const [copied, setCopied] = useState<number | null>(null)

  if (!templateType) return null

  const suggestions = generateSuggestions(rows)
  const unfilled = rows.filter((r) => !r.databaseName && !r.schemaName).length

  if (!unfilled) return null

  async function copyTerm(term: string, idx: number) {
    await navigator.clipboard.writeText(term)
    setCopied(idx)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="surface-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" />
          Step 2 — Suggested Search Terms
        </h2>
        <span className="text-xs text-muted">{unfilled} rows need population</span>
      </div>

      <p className="text-xs text-muted">
        Use these terms in Octopai Discovery Space → Advanced Search (Impala Columns). Set each field to{' '}
        <span className="font-medium text-foreground">Contains</span> with{' '}
        <span className="font-medium text-foreground">OR</span> between them, then export the results as CSV.
      </p>

      {suggestions.length === 0 ? (
        <p className="text-xs text-muted italic">No distinctive terms found in the template paths.</p>
      ) : (
        <div className="space-y-3">
          {suggestions.map((suggestion) => (
            <div key={suggestion.terms.join('|')} className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {suggestion.terms.map((term, i) => (
                  <div key={term} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-xs font-bold text-primary px-1 py-0.5 rounded bg-primary-surface border border-primary-border">
                        OR
                      </span>
                    )}
                    <button
                      onClick={() => copyTerm(term, i)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary-border bg-primary-surface text-sm font-mono font-medium text-primary hover:bg-blue-100 transition-colors"
                    >
                      {copied === i ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {term.toLowerCase()}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">
                Covers approximately{' '}
                <span className="font-medium text-foreground">{suggestion.coverage}</span> of{' '}
                <span className="font-medium text-foreground">{unfilled}</span> unfilled rows.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
