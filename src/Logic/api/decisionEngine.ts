/**
 * Thin async client for the local decision-engine HTTP server.
 * The server is optional — all calls return null on any error so the
 * caller can treat it as a best-effort enrichment pass.
 */

const DECISION_ENGINE_URL = 'http://127.0.0.1:7862'

export async function classifyText(text: string, labels: string[]): Promise<string | null> {
  try {
    const response = await fetch(`${DECISION_ENGINE_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, labels }),
    })
    if (!response.ok) return null
    const data = await response.json()
    return typeof data.label === 'string' ? data.label : null
  } catch {
    return null
  }
}
