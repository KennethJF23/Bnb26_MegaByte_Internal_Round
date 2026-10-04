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

export const submitCode = (problem_id, code) =>
  call('/api/ml/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ problem_id, code }),
  })

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