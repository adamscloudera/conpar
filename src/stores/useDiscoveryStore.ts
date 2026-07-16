import { create } from 'zustand'
import type { DiscoveryFile } from '../types.ts'

type DiscoveryStore = {
  files: DiscoveryFile[];
  addFile: (file: DiscoveryFile) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
};

export const useDiscoveryStore = create<DiscoveryStore>((set) => ({
  files: [],

  addFile: (file) =>
    set((state) => ({ files: [...state.files, file] })),

  removeFile: (id) =>
    set((state) => ({ files: state.files.filter((f) => f.id !== id) })),

  clearFiles: () => set({ files: [] }),
}))
