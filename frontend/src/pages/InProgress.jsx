import React, { useEffect, useState, useCallback } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { scaleLinear } from 'd3-scale'
import { api } from '../api'
import MetricCard from '../components/MetricCard'
import CommunicationsPanel from '../components/CommunicationsPanel'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

const STATUS_OPTIONS = ['applied', 'interviewing', 'offer', 'declined', 'inactive']

const JOB_TYPES = ['Data Scientist', 'Data Science Engineer', 'ML Engineer', 'AI Engineer', 'Data Engineer', 'Analytics Engineer', 'GenAI/LLM Engineer', 'Other']
const JOB_SOURCES = ['Company Site', 'LinkedIn', 'Indeed', 'Glassdoor', 'Referral', 'Handshake', 'Other']
const WORK_ARRANGEMENTS = ['remote', 'hybrid', 'onsite']

const STATE_NAME_TO_ABBR = {
  Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',
  Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',
  Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',
  Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',
  Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',
  Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ',
  'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',
  Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI',
  'South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',
  Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',
  Wisconsin:'WI',Wyoming:'WY','District of Columbia':'DC',
}

const STATE_ABBRS = Object.values(STATE_NAME_TO_ABBR).sort()

function daysSince(dateStr) {
  if (!dateStr) return null
  // SQLite datetime strings ("YYYY-MM-DD HH:MM:SS") have no timezone marker and are UTC.
  // Without the 'Z', JS parses them as local time → wrong result for non-UTC users.
  const iso = dateStr.length > 10 ? dateStr.replace(' ', 'T') + 'Z' : dateStr
  return Math.floor((Date.now() - new Date(iso)) / 86400000)
}

function AgeBadge({ days }) {
  if (days === null) return <span className="text-muted">—</span>
  const bg = days >= 90 ? '#dc2626' : days >= 60 ? '#ea580c' : days >= 30 ? '#ca8a04' : '#16a34a'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: bg, color: '#fff', borderRadius: '9999px',
      fontSize: '0.68rem', fontWeight: 700, minWidth: '1.6rem', height: '1.6rem',
      padding: '0 0.3rem', letterSpacing: '-0.01em',
    }}>
      {days}
    </span>
  )
}

function toggleItem(arr, val) {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
}

function SortTh({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label} <span style={{ opacity: active ? 1 : 0.3, fontSize: '0.7em' }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲▼'}</span>
    </th>
  )
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      className={`btn btn-ghost${active ? ' chip-active' : ''}`}
      onClick={onClick}
    >{label}</button>
  )
}

function EditModal({ app, onSave, onCancel }) {
  const [form, setForm] = useState({
    company: app.company || '',
    org_team: app.org_team || '',
    job_title: app.job_title || '',
    job_type: app.job_type || '',
    date_posted: app.date_posted || '',
    date_applied: app.date_applied || '',
    locations: app.locations?.length ? app.locations.map(l => ({ ...l })) : [{ city: '', state: '' }],
    work_arrangement: app.work_arrangement || '',
    salary_min: app.salary_min ?? '',
    salary_max: app.salary_max ?? '',
    salary_currency: app.salary_currency || 'USD',
    job_link: app.job_link || '',
    job_source: app.job_source || '',
    status: app.status || 'applied',
    notes: app.notes || '',
    summary: app.summary || '',
    raw_text: app.raw_text || '',
  })
  const [saving, setSaving] = useState(false)
  const [rescraping, setRescraping] = useState(false)
  const [rescrapeError, setRescrapeError] = useState(null)

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
  }

  function setLoc(i, field, val) {
    setForm(f => {
      const locs = [...f.locations]
      locs[i] = { ...locs[i], [field]: val }
      return { ...f, locations: locs }
    })
  }

  function addLoc() {
    setForm(f => ({ ...f, locations: [...f.locations, { city: '', state: '' }] }))
  }

  function removeLoc(i) {
    setForm(f => ({ ...f, locations: f.locations.filter((_, idx) => idx !== i) }))
  }

  async function handleSave() {
    if (!form.company || !form.job_title) return
    setSaving(true)
    try {
      await onSave({
        ...form,
        salary_min: form.salary_min !== '' ? parseInt(form.salary_min) : null,
        salary_max: form.salary_max !== '' ? parseInt(form.salary_max) : null,
        locations: form.locations.filter(l => l.city || l.state),
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleRescrape() {
    if (!form.job_link) return
    if (!window.confirm('Re-scrape this job link? This will overwrite the job details below with freshly extracted data.')) return
    setRescraping(true)
    setRescrapeError(null)
    try {
      const { data, error } = await api.extract(form.job_link)
      if (error) {
        setRescrapeError(error)
        return
      }
      setForm(f => ({
        ...f,
        company: data.company || f.company,
        org_team: data.org_team ?? f.org_team,
        job_title: data.job_title || f.job_title,
        job_type: data.job_type ?? f.job_type,
        locations: data.locations?.length ? data.locations : f.locations,
        work_arrangement: data.work_arrangement ?? f.work_arrangement,
        salary_min: data.salary_min ?? f.salary_min,
        salary_max: data.salary_max ?? f.salary_max,
        salary_currency: data.salary_currency || f.salary_currency,
        job_source: data.job_source ?? f.job_source,
        summary: data.summary ?? f.summary,
        raw_text: data.raw_text ?? f.raw_text,
      }))
    } catch (e) {
      setRescrapeError(e.message)
    } finally {
      setRescraping(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '1rem',
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: '1.5rem',
        width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Edit Application</h2>
          <button className="btn btn-ghost" onClick={onCancel} style={{ padding: '0.3rem 0.6rem' }}>✕</button>
        </div>

        <div className="form-grid-2" style={{ gap: '0.875rem' }}>
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
              <option value="">—</option>
              {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select
              value={form.status}
              className={`status-${form.status}`}
              onChange={e => set('status', e.target.value)}
              style={{ fontWeight: 600 }}
            >
              {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Job Source</label>
            <select value={form.job_source} onChange={e => set('job_source', e.target.value)}>
              <option value="">—</option>
              {JOB_SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Date Applied</label>
            <input type="date" value={form.date_applied} onChange={e => set('date_applied', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Date Posted</label>
            <input type="date" value={form.date_posted} onChange={e => set('date_posted', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Work Arrangement</label>
            <select value={form.work_arrangement} onChange={e => set('work_arrangement', e.target.value)}>
              <option value="">—</option>
              {WORK_ARRANGEMENTS.map(w => <option key={w}>{w}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Job Link</label>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="url" value={form.job_link} onChange={e => set('job_link', e.target.value)} style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleRescrape}
                disabled={rescraping || !form.job_link}
                title="Re-run the full extraction pipeline against this link"
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {rescraping ? 'Rescraping…' : 'Rescrape ↻'}
              </button>
            </div>
            {rescrapeError && (
              <div style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '0.25rem' }}>{rescrapeError}</div>
            )}
          </div>
          <div className="form-group">
            <label>Salary Min</label>
            <input type="number" value={form.salary_min} onChange={e => set('salary_min', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Salary Max</label>
            <input type="number" value={form.salary_max} onChange={e => set('salary_max', e.target.value)} />
          </div>

          <div className="form-group full">
            <label>Locations</label>
            {form.locations.map((loc, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                <input
                  type="text" placeholder="City" value={loc.city || ''}
                  onChange={e => setLoc(i, 'city', e.target.value)}
                  style={{ flex: 2 }}
                />
                <select
                  value={loc.state || ''} onChange={e => setLoc(i, 'state', e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">State</option>
                  {STATE_ABBRS.map(s => <option key={s}>{s}</option>)}
                </select>
                {form.locations.length > 1 && (
                  <button type="button" className="btn btn-ghost" onClick={() => removeLoc(i)}
                    style={{ padding: '0.3rem 0.5rem', flexShrink: 0 }}>✕</button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-ghost" onClick={addLoc}
              style={{ marginTop: '0.25rem', fontSize: '0.75rem' }}>+ Add Location</button>
          </div>

          <div className="form-group full">
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} />
          </div>

          <div className="form-group full">
            <label>Full Job Description</label>
            <textarea
              value={form.raw_text}
              onChange={e => set('raw_text', e.target.value)}
              rows={12}
              placeholder="Paste or edit the full job description here…"
              style={{ fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical' }}
            />
          </div>
        </div>

        <CommunicationsPanel applicationId={app.id} />

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary" onClick={handleSave}
            disabled={saving || !form.company || !form.job_title}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function InProgress() {
  const [apps, setApps] = useState([])
  const [allApps, setAllApps] = useState([])
  const [todos, setTodos] = useState([])
  const [statusFilter, setStatusFilter] = useState(['applied', 'interviewing', 'offer'])
  const [typeFilter, setTypeFilter]     = useState([])
  const [viewMode, setViewMode]         = useState('list')
  const [pending, setPending]           = useState({})
  const [saving, setSaving]             = useState(false)
  const [editMode, setEditMode]         = useState(false)
  const [editingApp, setEditingApp]     = useState(null)
  const [sort, setSort]                 = useState({ key: 'date_applied', dir: 'desc' })
  const [expandedIds, setExpandedIds]   = useState(new Set())

  const load = useCallback(() => {
    const sf = statusFilter.length ? statusFilter.join(',') : null
    api.applications(sf).then(setApps).catch(console.error)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.applications().then(setAllApps).catch(console.error)
    api.todos().then(setTodos).catch(console.error)
  }, [])

  const totalActive = allApps.filter(a => !['declined', 'inactive'].includes(a.status))
  const totalInterviewing = allApps.filter(a => a.status === 'interviewing')
  const totalOffers = allApps.filter(a => a.status === 'offer')

  const filtered = typeFilter.length
    ? apps.filter(a => typeFilter.includes(a.job_type))
    : apps

  const active = filtered.filter(a => !['declined', 'inactive'].includes(a.status))
  const stale90 = active.filter(a => daysSince(a.updated_at) >= 90)
  const stale60 = active.filter(a => { const d = daysSince(a.updated_at); return d >= 60 && d < 90 })
  const stale30 = active.filter(a => { const d = daysSince(a.updated_at); return d >= 30 && d < 60 })

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  function sortKey(a) {
    if (sort.key === 'date_applied') return a.date_applied || ''
    if (sort.key === 'date_posted') return a.date_posted || ''
    if (sort.key === 'company') return (a.company || '').toLowerCase()
    if (sort.key === 'location') {
      const loc = (a.locations || [])[0] || {}
      return `${loc.state || ''}|${loc.city || ''}`.toLowerCase()
    }
    return ''
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = sortKey(a), bv = sortKey(b)
    if (av < bv) return sort.dir === 'asc' ? -1 : 1
    if (av > bv) return sort.dir === 'asc' ? 1 : -1
    return 0
  })

  const stateCounts = {}
  filtered.forEach(a => {
    (a.locations || []).forEach(loc => {
      if (loc.state) stateCounts[loc.state] = (stateCounts[loc.state] || 0) + 1
    })
  })
  const maxCount = Math.max(1, ...Object.values(stateCounts))
  const colorScale = scaleLinear().domain([0, maxCount]).range(['#dbeafe', '#1d4ed8'])

  async function saveStatuses() {
    setSaving(true)
    try {
      await Promise.all(
        Object.entries(pending).map(([id, status]) => api.updateStatus(parseInt(id), status))
      )
      setPending({})
      load()
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateApp(formData) {
    await api.updateApplication(editingApp.id, formData)
    setEditingApp(null)
    load()
  }

  async function handleDeleteApp(id) {
    if (!window.confirm('Delete this application? This cannot be undone.')) return
    await api.deleteApplication(id)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{filtered.length} application(s) shown</p>
      </div>

      <div className="metrics-row metrics-row-5">
        <MetricCard label="Total Applied"  value={allApps.length}           color="#3b82f6" />
        <MetricCard label="Active"         value={totalActive.length}       color="#22c55e" />
        <MetricCard label="Interviewing"   value={totalInterviewing.length} color="#f59e0b" />
        <MetricCard label="Offers"         value={totalOffers.length}       color="#a855f7" />
        <MetricCard label="To-Do Queue"    value={todos.length}             color="#64748b" />
      </div>

      {stale90.length > 0 && <div className="alert alert-danger">🔴 <strong>{stale90.length} stale 90+ days:</strong> {stale90.map(a => a.company).join(', ')}</div>}
      {stale60.length > 0 && <div className="alert alert-warning">🟠 <strong>{stale60.length} stale 60–89 days:</strong> {stale60.map(a => a.company).join(', ')}</div>}
      {stale30.length > 0 && <div className="alert alert-warning" style={{ background: '#fefce8', borderColor: '#fde68a', color: '#854d0e' }}>🟡 <strong>{stale30.length} stale 30–59 days:</strong> {stale30.map(a => a.company).join(', ')}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div className="card-title" style={{ marginBottom: '0.5rem' }}>Status</div>
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map(s => (
                <FilterChip key={s} label={s} active={statusFilter.includes(s)}
                  onClick={() => setStatusFilter(prev => toggleItem(prev, s))} />
              ))}
            </div>
          </div>
          <div>
            <div className="card-title" style={{ marginBottom: '0.5rem' }}>Job Type</div>
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
              {JOB_TYPES.map(t => (
                <FilterChip key={t} label={t} active={typeFilter.includes(t)}
                  onClick={() => setTypeFilter(prev => toggleItem(prev, t))} />
              ))}
            </div>
          </div>
          <div>
            <div className="card-title" style={{ marginBottom: '0.5rem' }}>View</div>
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              <FilterChip label="List" active={viewMode === 'list'} onClick={() => setViewMode('list')} />
              <FilterChip label="Map"  active={viewMode === 'map'}  onClick={() => setViewMode('map')} />
            </div>
          </div>
          <div>
            <div className="card-title" style={{ marginBottom: '0.5rem' }}>Edit</div>
            <button
              className="btn btn-ghost"
              style={editMode
                ? { background: '#fef3c7', borderColor: '#f59e0b', color: '#92400e' }
                : {}}
              onClick={() => setEditMode(e => !e)}
            >
              {editMode ? 'Exit Edit Mode' : 'Edit Mode'}
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="card">
          {Object.keys(pending).length > 0 && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
              <span className="text-muted">{Object.keys(pending).length} pending change(s)</span>
              <button className="btn btn-primary" onClick={saveStatuses} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button className="btn btn-ghost" onClick={() => setPending({})}>Discard</button>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh label="Age"    sortKey="date_applied" sort={sort} onSort={toggleSort} />
                  <SortTh label="Posted" sortKey="date_posted"  sort={sort} onSort={toggleSort} />
                  <SortTh label="Company"  sortKey="company"      sort={sort} onSort={toggleSort} />
                  <th>Title</th><th>Type</th>
                  <SortTh label="Location" sortKey="location"     sort={sort} onSort={toggleSort} />
                  <th>Days</th><th>Status</th><th>Link</th>
                  {editMode && <th>Actions</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(a => {
                  const days = daysSince(a.date_applied)
                  const currentStatus = pending[a.id] ?? a.status
                  const locStr = (a.locations || [])
                    .map(l => [l.city, l.state].filter(Boolean).join(', '))
                    .filter(Boolean)
                    .join(' · ') || '—'
                  const badgeClass = a.work_arrangement === 'remote' ? 'badge badge-remote'
                    : a.work_arrangement === 'hybrid' ? 'badge badge-hybrid'
                    : 'badge badge-onsite'
                  const isExpanded = expandedIds.has(a.id)
                  const totalCols = editMode ? 11 : 10
                  return (
                    <React.Fragment key={a.id}>
                      <tr className={isExpanded ? 'row-expanded' : ''}>
                        <td><AgeBadge days={daysSince(a.date_applied)} /></td>
                        <td><AgeBadge days={daysSince(a.date_posted)} /></td>
                        <td>
                          <strong>{a.company}</strong>
                          {a.org_team && <div className="text-muted">{a.org_team}</div>}
                        </td>
                        <td>{a.job_title}</td>
                        <td className="text-muted">{a.job_type}</td>
                        <td title={locStr} style={{ maxWidth: '160px' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {locStr}
                          </div>
                          {a.work_arrangement && (
                            <div>
                              <span className={badgeClass}>
                                {a.work_arrangement.charAt(0).toUpperCase() + a.work_arrangement.slice(1)}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="text-muted">{days ?? '—'}</td>
                        <td>
                          <select
                            value={currentStatus}
                            className={`status-${currentStatus}`}
                            onChange={e => setPending(p => ({ ...p, [a.id]: e.target.value }))}
                            style={{ padding: '0.25rem 1.5rem 0.25rem 0.4rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>
                          {a.job_link
                            ? <a href={a.job_link} target="_blank" rel="noreferrer">↗</a>
                            : <span className="text-muted">—</span>}
                        </td>
                        {editMode && (
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button
                              className="btn btn-ghost"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginRight: '0.25rem' }}
                              onClick={() => setEditingApp(a)}
                            >Edit</button>
                            <button
                              className="btn btn-danger"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => handleDeleteApp(a.id)}
                            >Delete</button>
                          </td>
                        )}
                        <td>
                          <button
                            className="btn btn-ghost"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                            onClick={() => toggleExpand(a.id)}
                            style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', lineHeight: 1 }}
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="row-detail">
                          <td colSpan={totalCols} style={{ padding: '0 0.75rem 0.6rem 0.75rem' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '0.25rem' }}>
                              {a.job_source && <span><strong style={{ color: 'var(--text)' }}>Source:</strong> {a.job_source}</span>}
                              {(a.salary_min || a.salary_max) && (
                                <span><strong style={{ color: 'var(--text)' }}>Salary:</strong> {a.salary_min ? '$' + a.salary_min.toLocaleString() : '?'}–{a.salary_max ? '$' + a.salary_max.toLocaleString() : '?'}</span>
                              )}
                              {a.date_applied && <span><strong style={{ color: 'var(--text)' }}>Applied:</strong> {a.date_applied}</span>}
                              {a.date_posted && <span><strong style={{ color: 'var(--text)' }}>Posted:</strong> {a.date_posted}</span>}
                              {(a.locations || []).length > 0 && (
                                <span style={{ flexBasis: '100%' }}>
                                  <strong style={{ color: 'var(--text)' }}>Locations:</strong>{' '}
                                  {a.locations.map(l => [l.city, l.state].filter(Boolean).join(', ')).join(' · ')}
                                </span>
                              )}
                              {a.notes && <span style={{ flexBasis: '100%' }}><strong style={{ color: 'var(--text)' }}>Notes:</strong> {a.notes}</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={editMode ? 11 : 10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                      No applications match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="two-col">
          <div className="card">
            <div className="card-title">Applications by State</div>
            <ComposableMap projection="geoAlbersUsa" style={{ width: '100%', height: 320 }}>
              <Geographies geography={GEO_URL}>
                {({ geographies }) =>
                  geographies.map(geo => {
                    const abbr  = STATE_NAME_TO_ABBR[geo.properties.name]
                    const count = stateCounts[abbr] || 0
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={count > 0 ? colorScale(count) : '#e2e8f0'}
                        stroke="#fff"
                        strokeWidth={0.5}
                        style={{
                          default: { outline: 'none' },
                          hover:   { fill: '#f59e0b', outline: 'none' },
                          pressed: { outline: 'none' },
                        }}
                        title={`${geo.properties.name}: ${count}`}
                      />
                    )
                  })
                }
              </Geographies>
            </ComposableMap>
          </div>
          <div className="card">
            <div className="card-title">Work Arrangement</div>
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
              <div>
                <div className="metric-value" style={{ fontSize: '1.5rem' }}>{filtered.filter(a => a.work_arrangement === 'remote').length}</div>
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>Remote</div>
              </div>
              <div>
                <div className="metric-value" style={{ fontSize: '1.5rem' }}>{filtered.filter(a => a.work_arrangement === 'hybrid').length}</div>
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>Hybrid</div>
              </div>
            </div>
            <div className="card-title">Top States</div>
            {Object.entries(stateCounts)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([state, count]) => (
                <div key={state} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.825rem' }}>
                  <span>{state}</span><strong>{count}</strong>
                </div>
              ))}
            {Object.keys(stateCounts).length === 0 && <span className="text-muted">No state data yet.</span>}
          </div>
        </div>
      )}

      {editingApp && (
        <EditModal
          app={editingApp}
          onSave={handleUpdateApp}
          onCancel={() => setEditingApp(null)}
        />
      )}
    </div>
  )
}
