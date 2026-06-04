import { useEffect, useState } from 'react'
import { api } from '../api'

function RawTextSection({ rawText, onChange, onExtract, extracting }) {
  const [expanded, setExpanded] = useState(false)
  const hasText = (rawText || '').trim().length > 0

  return (
    <div className="form-group" style={{ marginBottom: '1.5rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        Raw Job Text
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{ fontSize: '0.75rem', padding: '1px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          {expanded ? 'Collapse' : hasText ? `Expand (${rawText.length.toLocaleString()} chars)` : 'Expand to paste'}
        </button>
      </label>
      {expanded && (
        <>
          <textarea
            value={rawText || ''}
            onChange={e => onChange(e.target.value)}
            rows={20}
            placeholder="Paste raw job posting text here, then click Extract with AI ✨"
            style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}
          />
          {hasText && (
            <button
              type="button"
              onClick={onExtract}
              disabled={extracting}
              className="btn btn-primary"
              style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
            >
              {extracting ? <><span className="spinner" /> Extracting…</> : 'Extract with AI ✨'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

const TODAY = new Date().toISOString().split('T')[0]

function emptyForm(config) {
  return {
    company: '', org_team: '', job_title: '',
    job_type: config?.job_types?.[0] ?? '',
    job_source: config?.job_sources?.[0] ?? '',
    job_link: '',
    locations: [{ city: '', state: '' }],
    work_arrangement: '',
    salary_min: '', salary_max: '', summary: '', raw_text: '', extracted_by_ai: false,
  }
}

function LocationRows({ locations, config, onChange }) {
  function updateLoc(i, field, value) {
    const next = locations.map((l, j) => j === i ? { ...l, [field]: value } : l)
    onChange(next)
  }
  function addLoc() { onChange([...locations, { city: '', state: '' }]) }
  function removeLoc(i) { onChange(locations.filter((_, j) => j !== i)) }

  return (
    <div>
      {locations.map((loc, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="City"
            value={loc.city || ''}
            onChange={e => updateLoc(i, 'city', e.target.value)}
            style={{ flex: 1 }}
          />
          <select
            value={loc.state || ''}
            onChange={e => updateLoc(i, 'state', e.target.value)}
            style={{ width: '10rem' }}
          >
            <option value="">— State —</option>
            {Object.entries(config.us_states).map(([k, v]) => (
              <option key={k} value={k}>{k} — {v}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => removeLoc(i)}
            disabled={locations.length === 1}
            style={{ padding: '0.3rem 0.6rem', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: locations.length === 1 ? 'default' : 'pointer', color: 'var(--text-muted)', opacity: locations.length === 1 ? 0.4 : 1 }}
          >×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={addLoc}
        style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'none', border: '1px dashed var(--border)', padding: '0.25rem 0.75rem', borderRadius: 4, cursor: 'pointer' }}
      >+ Add Location</button>
    </div>
  )
}

function locDisplay(t) {
  const locs = (t.locations || [])
    .map(l => [l.city, l.state].filter(Boolean).join(', '))
    .filter(Boolean)
    .join(' · ')
  const arr = t.work_arrangement
  if (locs && arr) return `${locs} · ${arr}`
  return locs || arr || '—'
}

function ConfirmModal({ modal, onDateChange, onConfirm, onCancel }) {
  if (!modal) return null
  const { type, todo, date } = modal
  const isApply = type === 'apply'

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card-bg, #fff)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '1.5rem', minWidth: 340, maxWidth: 480,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem' }}>
          {isApply ? 'Mark as Applied?' : 'Remove from To-Do?'}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1rem' }}>
          <strong>{todo.company}</strong>{todo.job_title ? ` — ${todo.job_title}` : ''}
        </div>
        {isApply && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>Applied date</label>
            <input type="date" value={date} onChange={e => onDateChange(e.target.value)} style={{ width: '100%' }} />
          </div>
        )}
        {!isApply && (
          <div style={{ fontSize: '0.85rem', color: '#b91c1c', marginBottom: '1rem' }}>
            This will permanently delete the entry.
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel}
            style={{ background: 'none', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <button
            className={isApply ? 'btn btn-success' : 'btn btn-danger'}
            onClick={onConfirm}
          >
            {isApply ? 'Mark as Applied' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TodoApplications() {
  const [config, setConfig]       = useState(null)
  const [todos, setTodos]         = useState([])
  const [form, setForm]           = useState(null)
  const [url, setUrl]             = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractingText, setExtractingText] = useState(false)
  const [extractError, setExtractError] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [formMsg, setFormMsg]     = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)

  const loadTodos = () => api.todos().then(setTodos).catch(console.error)

  useEffect(() => {
    api.config().then(cfg => { setConfig(cfg); setForm(emptyForm(cfg)) })
    loadTodos()
  }, [])

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleExtract() {
    if (!url.trim()) return
    setExtracting(true)
    setExtractError(null)
    try {
      const res = await api.extract(url.trim())
      if (res.error) {
        setExtractError(res.error)
      } else {
        const d = res.data
        setForm(f => ({
          ...f,
          company:          d.company          || f.company,
          org_team:         d.org_team         || f.org_team,
          job_title:        d.job_title        || f.job_title,
          job_type:         d.job_type         || f.job_type,
          locations:        d.locations?.length ? d.locations : f.locations,
          work_arrangement: d.work_arrangement ?? f.work_arrangement,
          salary_min:       d.salary_min       ?? f.salary_min,
          salary_max:       d.salary_max       ?? f.salary_max,
          job_link:         url.trim(),
          job_source:       d.job_source       || f.job_source,
          summary:          d.summary          || f.summary,
          raw_text:         d.raw_text         || f.raw_text,
          extracted_by_ai:  true,
        }))
      }
    } catch (err) {
      setExtractError(err.message)
    } finally {
      setExtracting(false)
    }
  }

  async function handleExtractText() {
    if (!form.raw_text?.trim()) return
    setExtractingText(true)
    setExtractError(null)
    try {
      const res = await api.extractText(form.raw_text)
      if (res.error) {
        setExtractError(res.error)
      } else {
        const d = res.data
        setForm(f => ({
          ...f,
          company:          d.company          || f.company,
          org_team:         d.org_team         || f.org_team,
          job_title:        d.job_title        || f.job_title,
          job_type:         d.job_type         || f.job_type,
          locations:        d.locations?.length ? d.locations : f.locations,
          work_arrangement: d.work_arrangement ?? f.work_arrangement,
          salary_min:       d.salary_min       ?? f.salary_min,
          salary_max:       d.salary_max       ?? f.salary_max,
          job_source:       d.job_source       || f.job_source,
          summary:          d.summary          || f.summary,
          extracted_by_ai:  true,
        }))
      }
    } catch (err) {
      setExtractError(err.message)
    } finally {
      setExtractingText(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormMsg(null)
    try {
      await api.createTodo({
        ...form,
        salary_min: form.salary_min ? parseInt(form.salary_min) : null,
        salary_max: form.salary_max ? parseInt(form.salary_max) : null,
        work_arrangement: form.work_arrangement || null,
      })
      setForm(emptyForm(config))
      setUrl('')
      setFormMsg({ type: 'success', text: 'Added to To-Do list.' })
      loadTodos()
    } catch (err) {
      setFormMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  function openApply(todo) {
    setConfirmModal({ type: 'apply', todo, date: TODAY })
  }

  function openDelete(todo) {
    setConfirmModal({ type: 'remove', todo, date: TODAY })
  }

  async function handleConfirm() {
    if (!confirmModal) return
    if (confirmModal.type === 'apply') {
      await api.applyTodo(confirmModal.todo.id, confirmModal.date)
    } else {
      await api.deleteTodo(confirmModal.todo.id)
    }
    setConfirmModal(null)
    loadTodos()
  }

  if (!form) return <div className="text-muted">Loading…</div>

  return (
    <div>
      <ConfirmModal
        modal={confirmModal}
        onDateChange={v => setConfirmModal(m => ({ ...m, date: v }))}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmModal(null)}
      />
      <div className="page-header">
        <h1 className="page-title">To-Do Applications</h1>
        <p className="page-subtitle">Save jobs to apply to later; AI URL extraction available</p>
      </div>

      {/* URL extractor */}
      <div className="card">
        <div className="card-title">AI Auto-Fill from URL</div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleExtract()}
            placeholder="https://jobs.lever.co/company/…"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleExtract} disabled={extracting || !url.trim()}>
            {extracting ? <><span className="spinner" /> Extracting…</> : 'Extract ✨'}
          </button>
        </div>
        {extractError && <div className="alert alert-danger" style={{ marginTop: '0.75rem' }}>{extractError}</div>}
      </div>

      {/* Add form */}
      <div className="card form-section">
        <div className="card-title">
          Add to To-Do
          {form.extracted_by_ai && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 9999, fontWeight: 600 }}>
              AI-extracted ✨
            </span>
          )}
        </div>
        {formMsg && (
          <div className={`alert ${formMsg.type === 'success' ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '1rem' }}>
            {formMsg.text}
          </div>
        )}
        <form onSubmit={handleSave}>
          <div className="form-grid-2" style={{ marginBottom: '1rem' }}>
            <div className="form-group">
              <label>Company</label>
              <input type="text" value={form.company} onChange={e => set('company', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Team / Org</label>
              <input type="text" value={form.org_team} onChange={e => set('org_team', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Job Title</label>
              <input type="text" value={form.job_title} onChange={e => set('job_title', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Job Type</label>
              <select value={form.job_type} onChange={e => set('job_type', e.target.value)}>
                {config.job_types.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Job Source</label>
              <select value={form.job_source} onChange={e => set('job_source', e.target.value)}>
                {config.job_sources.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Job Link</label>
              <input type="url" value={form.job_link} onChange={e => set('job_link', e.target.value)} />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Locations</label>
              <LocationRows locations={form.locations} config={config} onChange={v => set('locations', v)} />
            </div>
            <div className="form-group">
              <label>Work Arrangement</label>
              <select value={form.work_arrangement} onChange={e => set('work_arrangement', e.target.value)}>
                <option value="">— Unspecified —</option>
                <option value="onsite">Onsite</option>
                <option value="hybrid">Hybrid</option>
                <option value="remote">Remote</option>
              </select>
            </div>
            <div className="form-group">
              <label>Salary Min ($)</label>
              <input type="number" value={form.salary_min} onChange={e => set('salary_min', e.target.value)} min="0" />
            </div>
            <div className="form-group">
              <label>Salary Max ($)</label>
              <input type="number" value={form.salary_max} onChange={e => set('salary_max', e.target.value)} min="0" />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label>Summary</label>
            <textarea
              value={form.summary}
              onChange={e => set('summary', e.target.value)}
              rows={3}
              placeholder="AI-generated role summary — edit as needed"
            />
          </div>

          <RawTextSection rawText={form.raw_text} onChange={v => set('raw_text', v)} onExtract={handleExtractText} extracting={extractingText} />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add to To-Do'}
          </button>
        </form>
      </div>

      {/* To-Do table */}
      <div className="card">
        <div className="card-title">To-Do Queue ({todos.length})</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Company</th><th>Title</th><th>Type</th>
                <th>Location</th><th>Salary</th><th>Added</th><th>AI</th><th>Link</th>
                <th>Apply</th><th>Del</th>
              </tr>
            </thead>
            <tbody>
              {todos.map(t => (
                <tr key={t.id}>
                  <td className="text-muted">{t.id}</td>
                  <td><strong>{t.company || '—'}</strong></td>
                  <td>{t.job_title || '—'}</td>
                  <td className="text-muted">{t.job_type || '—'}</td>
                  <td>{locDisplay(t)}</td>
                  <td className="text-muted">
                    {(t.salary_min || t.salary_max)
                      ? `$${(t.salary_min ?? '?').toLocaleString?.() ?? '?'}–$${(t.salary_max ?? '?').toLocaleString?.() ?? '?'}`
                      : '—'}
                  </td>
                  <td className="text-muted">{(t.created_at || '').split('T')[0] || (t.created_at || '').split(' ')[0] || '—'}</td>
                  <td>{t.extracted_by_ai ? '✨' : ''}</td>
                  <td>{t.job_link ? <a href={t.job_link} target="_blank" rel="noreferrer">↗</a> : <span className="text-muted">—</span>}</td>
                  <td>
                    <button
                      onClick={() => openApply(t)}
                      style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'none', border: '1px solid #16a34a', borderRadius: 4, cursor: 'pointer', color: '#16a34a', whiteSpace: 'nowrap' }}
                    >✓ Apply</button>
                  </td>
                  <td>
                    <button
                      onClick={() => openDelete(t)}
                      style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'none', border: '1px solid #dc2626', borderRadius: 4, cursor: 'pointer', color: '#dc2626' }}
                    >✕</button>
                  </td>
                </tr>
              ))}
              {todos.length === 0 && (
                <tr><td colSpan="11" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No to-do items yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
