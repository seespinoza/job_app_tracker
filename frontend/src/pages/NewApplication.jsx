import { useEffect, useState } from 'react'
import { api } from '../api'

const TODAY = new Date().toISOString().split('T')[0]

function emptyForm(config) {
  return {
    company: '', org_team: '', job_title: '',
    job_type: config?.job_types?.[0] ?? '',
    job_source: config?.job_sources?.[0] ?? '',
    job_link: '', date_posted: '', date_applied: TODAY,
    locations: [{ city: '', state: '' }],
    work_arrangement: '',
    salary_min: '', salary_max: '', summary: '', raw_text: '',
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

export default function NewApplication() {
  const [config, setConfig] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)
  const [url, setUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractingText, setExtractingText] = useState(false)
  const [extractError, setExtractError] = useState(null)
  const [aiExtracted, setAiExtracted] = useState(false)

  useEffect(() => {
    api.config().then(cfg => { setConfig(cfg); setForm(emptyForm(cfg)) })
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
          date_posted:      d.date_posted      || f.date_posted,
        }))
        setAiExtracted(true)
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
          date_posted:      d.date_posted      || f.date_posted,
        }))
        setAiExtracted(true)
      }
    } catch (err) {
      setExtractError(err.message)
    } finally {
      setExtractingText(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.company.trim() || !form.job_title.trim()) {
      setError('Company and Job Title are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.createApplication({
        ...form,
        salary_min: form.salary_min ? parseInt(form.salary_min) : null,
        salary_max: form.salary_max ? parseInt(form.salary_max) : null,
        date_posted: form.date_posted || null,
        date_applied: form.date_applied || null,
        work_arrangement: form.work_arrangement || null,
      })
      setSuccess(true)
      setForm(emptyForm(config))
      setUrl('')
      setAiExtracted(false)
      setTimeout(() => setSuccess(false), 4000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!form) return <div className="text-muted">Loading…</div>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">New Application</h1>
        <p className="page-subtitle">Log a completed job application</p>
      </div>

      {success && <div className="alert alert-success">Application saved successfully.</div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      <div className="card form-section">
        <div className="card-title">AI Auto-Fill from URL</div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: extractError ? '0' : '0' }}>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleExtract())}
            placeholder="https://jobs.lever.co/company/…"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-primary" onClick={handleExtract} disabled={extracting || !url.trim()}>
            {extracting ? <><span className="spinner" /> Extracting…</> : 'Extract ✨'}
          </button>
        </div>
        {extractError && <div className="alert alert-danger" style={{ marginTop: '0.75rem' }}>{extractError}</div>}
      </div>

      <div className="card form-section">
        <div className="card-title">
          Application Details
          {aiExtracted && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 9999, fontWeight: 600 }}>
              AI-extracted ✨
            </span>
          )}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid-2" style={{ marginBottom: '1rem' }}>
            <div className="form-group">
              <label>Company *</label>
              <input type="text" value={form.company} onChange={e => set('company', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Team / Org</label>
              <input type="text" value={form.org_team} onChange={e => set('org_team', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Job Title *</label>
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
            <div className="form-group">
              <label>Date Posted</label>
              <input type="date" value={form.date_posted} onChange={e => set('date_posted', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date Applied</label>
              <input type="date" value={form.date_applied} onChange={e => set('date_applied', e.target.value)} />
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
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>{/* spacer */}</div>
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
            {saving ? <><span className="spinner" /> Saving…</> : 'Save Application'}
          </button>
        </form>
      </div>
    </div>
  )
}
