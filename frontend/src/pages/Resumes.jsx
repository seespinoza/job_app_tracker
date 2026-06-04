import { useEffect, useState, useRef } from 'react'
import { api } from '../api'

const TABS = ['Data Scientist', 'ML Engineer', 'AI Engineer']

const LABEL_STYLE = {
  fontSize: '0.8rem', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7,
}

function emptyForm(tab) {
  return { name: '', date: '', description: '', job_type: tab, file: null }
}

export default function Resumes() {
  const [resumes, setResumes]   = useState(null)
  const [activeTab, setActiveTab] = useState(TABS[0])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(() => emptyForm(TABS[0]))
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const fileRef                 = useRef(null)

  const load = () => api.resumes().then(setResumes).catch(console.error)
  useEffect(() => { load() }, [])

  function switchTab(tab) {
    setActiveTab(tab)
    setShowForm(false)
    setError(null)
  }

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function resetForm() {
    setForm(emptyForm(activeTab))
    if (fileRef.current) fileRef.current.value = ''
    setError(null)
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!form.file)       { setError('Please select a PDF file.'); return }
    if (!form.name.trim()) { setError('Please enter a name for this resume version.'); return }

    const fd = new FormData()
    fd.append('file', form.file)
    fd.append('name', form.name.trim())
    fd.append('date', form.date)
    fd.append('description', form.description.trim())
    fd.append('job_type', form.job_type)

    setSaving(true)
    setError(null)
    try {
      await api.uploadResume(fd)
      await load()
      resetForm()
      setShowForm(false)
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete resume "${name}"? This cannot be undone.`)) return
    try {
      await api.deleteResume(id)
      await load()
    } catch (err) {
      alert('Delete failed: ' + err.message)
    }
  }

  const visible = resumes ? resumes.filter(r => r.job_type === activeTab) : []

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="page-title">Resumes</h1>
          <p className="page-subtitle">Store and manage your resume versions</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setForm(emptyForm(activeTab))
            setShowForm(v => !v)
            setError(null)
          }}
        >
          {showForm ? 'Cancel' : '+ Add Resume'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            className={`btn btn-ghost${activeTab === tab ? ' chip-active' : ''}`}
            onClick={() => switchTab(tab)}
          >
            {tab}
            {resumes && (
              <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}>
                ({resumes.filter(r => r.job_type === tab).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Upload form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="card-title">Upload Resume</div>
          {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}
          <form onSubmit={handleUpload}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={LABEL_STYLE}>Version Name *</span>
                <input
                  type="text"
                  placeholder="e.g. General v3, FAANG tailored…"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  required
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={LABEL_STYLE}>Date</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={LABEL_STYLE}>Description</span>
                <textarea
                  rows={2}
                  placeholder="Brief notes about this version…"
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={LABEL_STYLE}>Role Type</span>
                <select value={form.job_type} onChange={e => set('job_type', e.target.value)}>
                  {TABS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1.25rem' }}>
              <span style={LABEL_STYLE}>PDF File *</span>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={e => set('file', e.target.files[0] || null)}
                required
              />
            </label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Uploading…' : 'Upload'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { resetForm(); setShowForm(false) }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Resume list */}
      {!resumes ? (
        <div className="text-muted">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="alert alert-info">
          No {activeTab} resumes yet. Click "+ Add Resume" to upload one.
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>File</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td className="text-muted">{r.date || '—'}</td>
                    <td style={{ maxWidth: 360 }}>{r.description || <span className="text-muted">—</span>}</td>
                    <td>
                      <a
                        href={api.resumeFileUrl(r.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost"
                        style={{ textDecoration: 'none', padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                      >
                        View PDF
                      </a>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => handleDelete(r.id, r.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
