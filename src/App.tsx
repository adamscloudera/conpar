import { useEffect } from 'react'
import { InstructionsPanel } from './components/InstructionsPanel.tsx'
import { TemplateUploadPanel } from './components/TemplateUploadPanel.tsx'
import { SuggestionsPanel } from './components/SuggestionsPanel.tsx'
import { DiscoveryUploadPanel } from './components/DiscoveryUploadPanel.tsx'
import { MappingGrid } from './components/MappingGrid.tsx'
import { ExportPanel } from './components/ExportPanel.tsx'
import { useTemplateStore } from './stores/useTemplateStore.ts'
import { useDiscoveryStore } from './stores/useDiscoveryStore.ts'
import { useMappingStore } from './stores/useMappingStore.ts'
import { computeMappings } from './Logic/core/matchingEngine.ts'
import type { WorkflowStep } from './components/InstructionsPanel.tsx'

function deriveStep(
  hasTemplate: boolean,
  hasDiscovery: boolean,
  hasMappings: boolean,
  hasReview: boolean,
): WorkflowStep {
  if (!hasTemplate) return 1
  if (!hasDiscovery) return 2
  if (!hasMappings) return 3
  if (!hasReview) return 4
  return 5
}

export default function App() {
  const { rows: templateRows, templateType } = useTemplateStore()
  const { files: discoveryFiles } = useDiscoveryStore()
  const { results, setResults } = useMappingStore()

  // Recompute mappings whenever template rows or discovery files change
  useEffect(() => {
    if (!templateRows.length) { setResults([]); return }
    const mappings = computeMappings(templateRows, discoveryFiles)
    setResults(mappings)
  }, [templateRows, discoveryFiles, setResults])

  const hasTemplate = !!templateType
  const hasDiscovery = discoveryFiles.length > 0
  const hasMappings = results.length > 0
  const hasReview = hasMappings && results.every((r) => r.status !== 'needs_selection')

  const currentStep = deriveStep(hasTemplate, hasDiscovery, hasMappings, hasReview)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div>
            <h1 className="text-base font-bold text-foreground">ConPar</h1>
            <p className="text-xs text-muted">Connection Parameter Population Tool</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Left rail: instructions */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <InstructionsPanel currentStep={currentStep} />
          </div>

          {/* Right column: panels */}
          <div className="space-y-4">
            <TemplateUploadPanel />
            <SuggestionsPanel />
            <DiscoveryUploadPanel />
            <MappingGrid />
            <ExportPanel />
          </div>
        </div>
      </main>
    </div>
  )
}
