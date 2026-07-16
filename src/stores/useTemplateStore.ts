import { create } from 'zustand'
import type { TemplateRow, TemplateType } from '../types.ts'

type TemplateStore = {
  templateFile: File | null;
  templateType: TemplateType | null;
  rows: TemplateRow[];
  connectionKeys: string[];
  connectionLogicNames: string[];
  parseError: string | null;
  setTemplate: (
    file: File,
    type: TemplateType,
    rows: TemplateRow[],
    connectionKeys: string[],
    connectionLogicNames: string[],
  ) => void;
  clearTemplate: () => void;
  setParseError: (err: string) => void;
};

export const useTemplateStore = create<TemplateStore>((set) => ({
  templateFile: null,
  templateType: null,
  rows: [],
  connectionKeys: [],
  connectionLogicNames: [],
  parseError: null,

  setTemplate: (file, type, rows, connectionKeys, connectionLogicNames) =>
    set({ templateFile: file, templateType: type, rows, connectionKeys, connectionLogicNames, parseError: null }),

  clearTemplate: () =>
    set({ templateFile: null, templateType: null, rows: [], connectionKeys: [], connectionLogicNames: [], parseError: null }),

  setParseError: (err) => set({ parseError: err }),
}))
