import { useEffect, useRef } from 'react'
import { InstructionsPanel } from './components/InstructionsPanel.tsx'
import { TemplateUploadPanel } from './components/TemplateUploadPanel.tsx'
import { SuggestionsPanel } from './components/SuggestionsPanel.tsx'
import { DiscoveryUploadPanel } from './components/DiscoveryUploadPanel.tsx'
import { ApiConfigPanel } from './components/ApiConfigPanel.tsx'
import { MappingGrid } from './components/MappingGrid.tsx'
import { StatsPanel } from './components/StatsPanel.tsx'
import { ExportPanel } from './components/ExportPanel.tsx'
import { PlatformChrome } from './components/PlatformChrome.tsx'
import { SessionLogPanel } from './components/SessionLogPanel.tsx'
import { useSessionLog } from './hooks/useSessionLog.ts'
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
  const { sessionLog, addLog, downloadLog } = useSessionLog()

  const prevTemplateLen = useRef(0)
  const prevDiscoveryLen = useRef(0)
  const prevMatchSig = useRef('')

  // Recompute mappings whenever template rows or discovery files change
  useEffect(() => {
    if (!templateRows.length) { setResults([]); return }
    const mappings = computeMappings(templateRows, discoveryFiles)
    setResults(mappings)
  }, [templateRows, discoveryFiles, setResults])

  // Log template load
  useEffect(() => {
    if (templateRows.length && templateRows.length !== prevTemplateLen.current) {
      prevTemplateLen.current = templateRows.length
      addLog(`Template loaded: ${templateRows.length} rows (${templateType ?? 'unknown type'})`)
    } else if (!templateRows.length && prevTemplateLen.current > 0) {
      prevTemplateLen.current = 0
    }
  }, [templateRows.length, templateType, addLog])

  // Log discovery file additions
  useEffect(() => {
    if (discoveryFiles.length > prevDiscoveryLen.current) {
      const latest = discoveryFiles[discoveryFiles.length - 1]
      addLog(`Discovery file loaded: ${latest.filename} · ${latest.type} · ${latest.rowCount} rows`)
    }
    prevDiscoveryLen.current = discoveryFiles.length
  }, [discoveryFiles, addLog])

  // Log matching results — re-fires when status distribution changes (not just row count)
  useEffect(() => {
    if (!results.length) return
    const auto = results.filter((r) => r.status === 'auto_filled').length
    const needs = results.filter((r) => r.status === 'needs_selection').length
    const noMatch = results.filter((r) => r.status === 'no_match').length
    const preFilled = results.filter((r) => r.status === 'pre_filled').length
    const sig = `${preFilled}:${auto}:${needs}:${noMatch}`
    if (sig === prevMatchSig.current) return
    prevMatchSig.current = sig
    addLog(
      `Matching complete: ${results.length} rows — ${preFilled} pre-filled, ${auto} auto-filled, ${needs} need review, ${noMatch} no match`
    )
  }, [results, addLog])

  const hasTemplate = !!templateType
  const hasDiscovery = discoveryFiles.length > 0
  const hasMappings = results.length > 0
  const hasReview = hasMappings && results.every((r) => r.status !== 'needs_selection')

  const currentStep = deriveStep(hasTemplate, hasDiscovery, hasMappings, hasReview)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex-1">
            <PlatformChrome />
            <h1 className="text-base font-bold text-foreground mt-0.5">ConPar</h1>
            <p className="text-xs text-muted">Connection Parameter Population Tool</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Left rail: instructions */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <InstructionsPanel currentStep={currentStep} />
          </div>

          {/* Right column: panels */}
          <div className="space-y-4">
            <TemplateUploadPanel />
            <SuggestionsPanel />
            <ApiConfigPanel />
            <DiscoveryUploadPanel />
            <StatsPanel />
            <MappingGrid />
            <ExportPanel />
          </div>
        </div>
      </main>

      {/* Sticky session log at bottom */}
      <div className="sticky bottom-0">
        <SessionLogPanel sessionLog={sessionLog} onDownloadLog={downloadLog} />
      </div>
    </div>
  )
}
