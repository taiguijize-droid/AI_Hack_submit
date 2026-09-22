const serviceUrl = env => (env.OPENFACE_SERVICE_URL || `http://127.0.0.1:${env.OPENFACE_SERVICE_PORT || 8792}`).replace(/\/$/, '')

export async function openFaceStatus(env) {
  try {
    const response = await fetch(`${serviceUrl(env)}/health`, {signal: AbortSignal.timeout(2_000)})
    if (!response.ok) throw new Error(`OpenFace service ${response.status}`)
    const value = await response.json()
    return {ready: Boolean(value.ready), version: String(value.version || '2.2.0'), mode: 'local'}
  } catch {
    return {ready: false, version: '2.2.0', mode: 'local'}
  }
}

export async function analyzeWithOpenFace(dataUrl, env) {
  const response = await fetch(`${serviceUrl(env)}/analyze`, {
    method: 'POST',
    signal: AbortSignal.timeout(35_000),
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({imageDataUrl: dataUrl})
  })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(value.error || `OpenFace service ${response.status}`)
  return value.observation
}
