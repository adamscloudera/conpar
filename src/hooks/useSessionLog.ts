import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_LOG_LINES = 10000

export function useSessionLog() {
  const startedRef = useRef(false)
  const [sessionLog, setSessionLog] = useState<string[]>([])

  const addLog = useCallback((msg: string) => {
    setSessionLog((prev) => {
      const next = [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
    })
  }, [])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    queueMicrotask(() => addLog('Session started'))

    const onError = (event: ErrorEvent) => {
      addLog(`[ERROR] ${event.message} @ ${event.filename}:${event.lineno}`)
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
      addLog(`[UNHANDLED] ${reason}`)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [addLog])

  const downloadLog = useCallback(() => {
    const content = sessionLog.join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conpar-session-${new Date().toISOString().slice(0, 10)}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [sessionLog])

  return { sessionLog, addLog, downloadLog }
}
