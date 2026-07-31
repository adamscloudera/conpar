import { create } from 'zustand'
import type { InsightMetrics } from '../Logic/core/insightMetrics.ts'

type InsightsStore = {
  metrics: InsightMetrics | null
  setMetrics: (metrics: InsightMetrics) => void
  clearMetrics: () => void
}

export const useInsightsStore = create<InsightsStore>((set) => ({
  metrics: null,
  setMetrics: (metrics) => set({ metrics }),
  clearMetrics: () => set({ metrics: null }),
}))
