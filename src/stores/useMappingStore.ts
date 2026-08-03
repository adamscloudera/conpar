import { create } from 'zustand'
import type { CandidateSchema, ConnectionScopeConfig, MappingResult } from '../types.ts'

type MappingStore = {
  results: MappingResult[];
  setResults: (results: MappingResult[]) => void;
  selectCandidate: (rowIndex: number, candidate: CandidateSchema) => void;
  setManualValues: (rowIndex: number, databaseName: string, schemaName: string) => void;
  applyToSameKey: (rowIndex: number) => void;
  clearResults: () => void;
  scopeConfig: ConnectionScopeConfig;
  setScopeConfig: (config: ConnectionScopeConfig) => void;
};

export const useMappingStore = create<MappingStore>((set) => ({
  results: [],
  scopeConfig: { keyConnectionMap: {} },
  setScopeConfig: (config) => set({ scopeConfig: config }),

  setResults: (results) => set({ results }),

  selectCandidate: (rowIndex, candidate) =>
    set((state) => ({
      results: state.results.map((r) =>
        r.rowIndex === rowIndex
          ? { ...r, selectedCandidate: candidate, status: 'confirmed', manualDatabase: '', manualSchema: '' }
          : r,
      ),
    })),

  setManualValues: (rowIndex, databaseName, schemaName) =>
    set((state) => ({
      results: state.results.map((r) =>
        r.rowIndex === rowIndex
          ? { ...r, manualDatabase: databaseName, manualSchema: schemaName, status: 'manual', selectedCandidate: null }
          : r,
      ),
    })),

  applyToSameKey: (rowIndex) =>
    set((state) => {
      const source = state.results.find((r) => r.rowIndex === rowIndex)
      if (!source) return state
      const key = source.templateRow.key
      return {
        results: state.results.map((r) => {
          if (r.rowIndex === rowIndex) return r
          if (r.templateRow.key !== key) return r
          if (r.status === 'pre_filled' || r.status === 'not_applicable') return r
          if (source.status === 'manual') {
            return { ...r, manualDatabase: source.manualDatabase, manualSchema: source.manualSchema, status: 'manual' as const, selectedCandidate: null }
          }
          return { ...r, selectedCandidate: source.selectedCandidate, status: 'confirmed' as const, manualDatabase: '', manualSchema: '' }
        }),
      }
    }),

  clearResults: () => set({ results: [] }),
}))
