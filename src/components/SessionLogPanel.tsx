import { useState } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'

export function SessionLogPanel({
  sessionLog,
  onDownloadLog,
}: {
  sessionLog: string[]
  onDownloadLog: () => void
}) {
  const [expanded, setExpanded] = useState(true)

  if (sessionLog.length === 0) return null

  return (
    <div className="border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] z-20">
      <div className="max-w-5xl mx-auto w-full px-6">
        <div className="flex items-center justify-between gap-3 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 text-left text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-gray-500" aria-hidden />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden />
            )}
            Session log
            <span className="text-xs font-normal text-gray-500">({sessionLog.length} lines)</span>
          </button>
          <button
            type="button"
            onClick={onDownloadLog}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium shrink-0"
          >
            <Download className="w-3 h-3" aria-hidden /> Download debug log
          </button>
        </div>
        {expanded && (
          <div className="bg-gray-900 rounded-t-md p-3 max-h-48 overflow-y-auto flex flex-col-reverse shadow-inner mb-0 border border-b-0 border-gray-800">
            <div className="flex flex-col gap-1">
              {sessionLog.map((line, i) => (
                <div key={i} className="text-green-400 font-mono text-xs break-all">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
