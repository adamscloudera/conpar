import { create } from 'zustand'

export type ApiStatus = 'idle' | 'connecting' | 'connected' | 'fetching' | 'done' | 'error'

type ApiStore = {
  company: string
  accessToken: string
  accessExpiry: string
  refreshToken: string
  refreshExpiry: string
  displayName: string
  status: ApiStatus
  error: string | null

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
    }),
}))
