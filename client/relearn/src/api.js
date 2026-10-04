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

const getGuestSessionKey = () => {
  let key = localStorage.getItem('relearn_guest_session')
  if (!key) {
    key = 'guest_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now()
    localStorage.setItem('relearn_guest_session', key)
  }
  return key
}

const analyticsHeaders = () => ({
  ...authHeaders(),
  'x-guest-session': getGuestSessionKey(),
})

export const recordAnalyticsEvent = (eventData) =>
  call('/api/analytics/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...analyticsHeaders() },
    body: JSON.stringify({ ...eventData, sessionKey: getGuestSessionKey() }),
  })

export const getAnalyticsTrends = (timeRange = '30d', category = 'All') => {
  const q = new URLSearchParams({ timeRange, category, sessionKey: getGuestSessionKey() }).toString()
  return call(`/api/analytics/trends?${q}`, { headers: analyticsHeaders() })
}

export const getInterventionRecommendations = () => {
  const q = new URLSearchParams({ sessionKey: getGuestSessionKey() }).toString()
  return call(`/api/analytics/recommendations?${q}`, { headers: analyticsHeaders() })
}

export const getLearnerModel = () => {
  const q = new URLSearchParams({ sessionKey: getGuestSessionKey() }).toString()
  return call(`/api/analytics/learner-model?${q}`, { headers: analyticsHeaders() })
}

export const exportAnalyticsReport = () => {
  const q = new URLSearchParams({ sessionKey: getGuestSessionKey() }).toString()
  return call(`/api/analytics/export?${q}`, { headers: analyticsHeaders() })
}

export const seedAnalyticsDemo = () =>
  call('/api/analytics/seed-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...analyticsHeaders() },
    body: JSON.stringify({ sessionKey: getGuestSessionKey() }),
  })

export const resetAnalyticsData = () =>
  call('/api/analytics/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...analyticsHeaders() },
    body: JSON.stringify({ sessionKey: getGuestSessionKey() }),
  })

export const diagnoseSnippet = (code, evidence = null) =>
  call('/api/ml/diagnose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...analyticsHeaders() },
    body: JSON.stringify({ code, evidence }),
  })

export const resolveProbe = (probe, chosenMisconceptionId) =>
  call('/api/ml/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...analyticsHeaders() },
    body: JSON.stringify({ probe, chosenMisconceptionId }),
  })

export const markInterventionDelivered = (misconceptionId, interventionId = null) =>
  call('/api/ml/intervention/delivered', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...analyticsHeaders() },
    body: JSON.stringify({ misconceptionId, interventionId }),
  })

export const getMlMetrics = () =>
  call('/api/ml/metrics', { headers: analyticsHeaders() })

export const getMisconceptionBank = () =>
  call('/api/ml/bank', { headers: analyticsHeaders() })

export const getQuestions = (misconceptionId, category) => {
  const params = new URLSearchParams()
  if (misconceptionId) params.set('misconceptionId', misconceptionId)
  if (category) params.set('category', category)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return call(`/api/ml/questions${qs}`, { headers: analyticsHeaders() })
}