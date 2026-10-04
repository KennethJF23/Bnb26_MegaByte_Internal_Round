async function call(path, options) {
  const r = await fetch(path, options)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.message || `Request failed (${r.status})`)
  return data
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const register = (username, email, password) =>
  call('/api/auth/register', json({ username, email, password }))

export const login = (email, password) =>
  call('/api/auth/login', json({ email, password }))

const authHeaders = () => {
  let session
  try {
    session = JSON.parse(localStorage.getItem('relearn-session') || 'null')
  } catch {
    session = null
  }
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {}
}

export const getProblems = () =>
  call('/api/ml/problems', { headers: authHeaders() })

/**
 * Submit code for evaluation + misconception diagnosis.
 * @param {number} problem_id
 * @param {string} code
 * @param {string|null} model - 'baseline' | 'transformer' | 'transformer_v2' | null (auto)
 */
export const submitCode = (problem_id, code, model = null) => {
  const qs = model ? `?model=${encodeURIComponent(model)}` : ''
  return call(`/api/ml/submit${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ problem_id, code }),
  })
}

/**
 * Directly diagnose code for misconceptions (used in MCQ page after wrong answer).
 * @param {string} code
 * @param {string|null} model - 'baseline' | 'transformer' | 'transformer_v2' | null (auto)
 */
export const diagnoseCode = (code, model = null) => {
  const qs = model ? `?model=${encodeURIComponent(model)}` : ''
  return call(`/api/ml/diagnose${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ code }),
  })
}

export const getProgress = () =>
  call('/api/ml/progress', { headers: authHeaders() })

export const recordMcqAttempt = (attempt) =>
  call('/api/ml/progress/mcq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(attempt),
  })

export const getIntervention = (input) =>
  call('/api/ml/intervention', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })

export const getAdminDashboard = () =>
  call('/api/admin/dashboard', { headers: authHeaders() })

/**
 * Fetch the available model backends from the ML service.
 * Returns: { backends: string[], default: string }
 */
export const getModelHealth = () =>
  call('/api/ml/health', { headers: authHeaders() })