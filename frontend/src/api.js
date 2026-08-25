const BASE = '/api'

async function request(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) {
    // FastAPI's HTTPException responses are {"detail": "..."} — surface that
    // text when present (e.g. duplicate-label / bad-prompt-template messages)
    // instead of just the status code, so callers can show it to the user.
    // detail can also be a structured object (e.g. save-applied's missing
    // required fields) — callers that need the structured form read err.detail.
    let detail = null
    try { detail = (await res.json()).detail } catch { /* not JSON */ }
    const message = typeof detail === 'string' ? detail
      : (detail && detail.message) || `${method} ${path} → ${res.status}`
    const err = new Error(message)
    err.status = res.status
    err.detail = detail
    throw err
  }
  return res.json()
}

async function uploadFile(path, formData) {
  const res = await fetch(BASE + path, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`)
  return res.json()
}

export const api = {
  config: () => request('GET', '/config'),
  applications: (status) => request('GET', `/applications${status ? `?status=${status}` : ''}`),
  createApplication: (data) => request('POST', '/applications', data),
  updateStatus: (id, status) => request('PATCH', `/applications/${id}/status`, { status }),
  updateApplication: (id, data) => request('PUT', `/applications/${id}`, data),
  deleteApplication: (id) => request('DELETE', `/applications/${id}`),
  communications: (appId) => request('GET', `/applications/${appId}/communications`),
  createCommunication: (appId, data) => request('POST', `/applications/${appId}/communications`, data),
  deleteCommunication: (id) => request('DELETE', `/communications/${id}`),
  upcomingFollowups: () => request('GET', '/communications/upcoming-followups'),
  todos: () => request('GET', '/todos'),
  createTodo: (data) => request('POST', '/todos', data),
  deleteTodo: (id) => request('DELETE', `/todos/${id}`),
  applyTodo: (id, date_applied) => request('POST', `/todos/${id}/apply`, { date_applied }),
  extract: (url) => request('POST', '/extract', { url }),
  extractText: (text) => request('POST', '/extract-text', { text }),
  scraperLog: () => request('GET', '/scraper-log'),
  analytics: () => request('GET', '/analytics'),
  notes: () => request('GET', '/notes'),
  getNote: (id) => request('GET', `/notes/${id}`),
  createNote: (title) => request('POST', '/notes', { title }),
  updateNote: (id, data) => request('PUT', `/notes/${id}`, data),
  deleteNote: (id) => request('DELETE', `/notes/${id}`),
  resumes: () => request('GET', '/resumes'),
  uploadResume: (formData) => uploadFile('/resumes', formData),
  deleteResume: (id) => request('DELETE', `/resumes/${id}`),
  resumeFileUrl: (id) => `${BASE}/resumes/${id}/file`,
  discoveryJobs: (runId) => request('GET', `/discovery/jobs${runId ? `?run_id=${runId}` : ''}`),
  discoveryRuns: () => request('GET', '/discovery/runs'),
  discoveryLatestRun: () => request('GET', '/discovery/runs/latest'),
  discoveryDismiss: (id) => request('POST', `/discovery/jobs/${id}/dismiss`),
  discoverySetTags: (id, tags) => request('POST', `/discovery/jobs/${id}/tags`, { tags }),
  discoverySaveTodo: (data) => request('POST', '/discovery/save-todo', data),
  discoverySaveApplied: (data) => request('POST', '/discovery/save-applied', data),
  discoveryTracks: () => request('GET', '/discovery/tracks'),
  addDiscoveryTrack: (label, query) => request('POST', '/discovery/tracks', { label, query }),
  updateDiscoveryTrack: (id, patch) => request('PATCH', `/discovery/tracks/${id}`, patch),
  deleteDiscoveryTrack: (id) => request('DELETE', `/discovery/tracks/${id}`),
  discoveryLocations: () => request('GET', '/discovery/locations'),
  addDiscoveryLocation: (label, search_term) => request('POST', '/discovery/locations', { label, search_term }),
  updateDiscoveryLocation: (id, patch) => request('PATCH', `/discovery/locations/${id}`, patch),
  deleteDiscoveryLocation: (id) => request('DELETE', `/discovery/locations/${id}`),
  getAnalystConfig: () => request('GET', '/discovery/analyst-config'),
  updateAnalystConfig: (patch) => request('PUT', '/discovery/analyst-config', patch),
}
