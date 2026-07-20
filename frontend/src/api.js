const BASE = '/api'

async function request(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
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
  discoveryJobs: () => request('GET', '/discovery/jobs'),
  discoveryRuns: () => request('GET', '/discovery/runs'),
  discoveryLatestRun: () => request('GET', '/discovery/runs/latest'),
  discoveryDismiss: (id) => request('POST', `/discovery/jobs/${id}/dismiss`),
  discoverySetTags: (id, tags) => request('POST', `/discovery/jobs/${id}/tags`, { tags }),
  discoverySaveTodo: (data) => request('POST', '/discovery/save-todo', data),
  discoverySaveApplied: (data) => request('POST', '/discovery/save-applied', data),
}
