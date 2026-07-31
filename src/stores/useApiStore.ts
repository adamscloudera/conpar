import { create } from 'zustand'

export type ApiStatus = 'idle' | 'connecting' | 'connected' | 'fetching' | 'done' | 'error'

export type QueryLogEntry = {
  ts: string
  level: 'info' | 'ok' | 'error'
  message: string
}

export type FetchProgress = {
  phase: 'assets' | 'lineage'
  assetsTotal: number
  lineageDone: number
  lineageTotal: number
  lineageStartedAt: number
} | null

type ApiStore = {
  company: string
  accessToken: string
  accessExpiry: string
  refreshToken: string
  refreshExpiry: string
  displayName: string
  status: ApiStatus
  error: string | null
  queryLog: QueryLogEntry[]
  fetchProgress: FetchProgress

  setConfig: (company: string) => void
  setTokens: (params: {
    accessToken: string
    accessExpiry: string
    refreshToken: string
    refreshExpiry: string
    displayName: string
  }) => void
  setStatus: (status: ApiStatus, error?: string | null) => void
  clearSession: () => void
  addQueryLog: (entry: QueryLogEntry) => void
  setFetchProgress: (progress: FetchProgress) => void
  clearFetchState: () => void
}

export const useApiStore = create<ApiStore>((set) => ({
  company: '',
  accessToken: '',
  accessExpiry: '',
  refreshToken: '',
  refreshExpiry: '',
  displayName: '',
  status: 'idle',
  error: null,
  queryLog: [],
  fetchProgress: null,

  setConfig: (company) => set({ company }),

  setTokens: ({ accessToken, accessExpiry, refreshToken, refreshExpiry, displayName }) =>
    set({ accessToken, accessExpiry, refreshToken, refreshExpiry, displayName, status: 'connected', error: null }),

  setStatus: (status, error = null) => set({ status, error }),

  clearSession: () =>
    set({
      accessToken: '',
      accessExpiry: '',
      refreshToken: '',
      refreshExpiry: '',
      displayName: '',
      status: 'idle',
      error: null,
      queryLog: [],
      fetchProgress: null,
    }),

  addQueryLog: (entry) => set((s) => ({ queryLog: [...s.queryLog, entry] })),
  setFetchProgress: (fetchProgress) => set({ fetchProgress }),
  clearFetchState: () => set({ queryLog: [], fetchProgress: null }),
}))
