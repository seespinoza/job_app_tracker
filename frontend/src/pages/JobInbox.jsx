import { useState, useRef, useCallback } from 'react'
import { api } from '../api'

const TODAY = new Date().toISOString().split('T')[0]

function salaryDisplay(job) {
  const lo = job.salary_min, hi = job.salary_max
  if (!lo && !hi) return null
  const fmt = (n) => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`
  if (lo && hi) return `${fmt(lo)}–${fmt(hi)}`
  if (lo) return `${fmt(lo)}+`
  return `up to ${fmt(hi)}`
}

function locDisplay(job) {
  const locs = (job.locations || [])
    .map(l => [l.city, l.state].filter(Boolean).join(', '))
    .filter(Boolean)
  const arr = job.work_arrangement
  const parts = locs.length ? locs : []
  if (arr) parts.push(arr)
  return parts.join(' · ') || null
}

function JobCard({ job, onSaveTodo, onSaveApplied }) {
  const [state, setState] = useState('pending') // pending | saving | todo | applied | error
  const [applyDate, setApplyDate] = useState(TODAY)
  const [showApplyDate, setShowApplyDate] = useState(false)
  const sal = salaryDisplay(job)
  const loc = locDisplay(job)

  async function handleTodo() {
    setState('saving')
    try {
      await onSaveTodo(job)
      setState('todo')
    } catch {
      setState('error')
    }
  }

  async function handleApplied() {
    if (!showApplyDate) { setShowApplyDate(true); return }
    setState('saving')
    try {
      await onSaveApplied(job, applyDate)
      setState('applied')
    } catch {
      setState('error')
    }
  }

  const isSaved = state === 'todo' || state === 'applied'

  return (
    <div style={{
      border: `1px solid ${isSaved ? 'var(--border)' : 'var(--border)'}`,
      borderLeft: `3px solid ${state === 'todo' ? '#2563eb' : state === 'applied' ? '#16a34a' : state === 'error' ? '#dc2626' : 'var(--border)'}`,
      borderRadius: 6,
      padding: '0.9rem 1rem',
      background: 'var(--card-bg)',
      opacity: isSaved ? 0.6 : 1,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.15rem' }}>
            {job.company || <span style={{ color: 'var(--text-muted)' }}>Unknown Company</span>}
            {job.org_team && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}> · {job.org_team}</span>}
          </div>
          <div style={{ fontSize: '0.88rem', marginBottom: '0.35rem' }}>
            {job.job_title || <span style={{ color: 'var(--text-muted)' }}>—</span>}
            {job.job_type && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: 'var(--tag-bg, #e5e7eb)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 9999 }}>{job.job_type}</span>}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {loc && <span>{loc}</span>}
            {sal && <span style={{ color: '#16a34a', fontWeight: 600 }}>{sal}</span>}
            {job.date_posted && <span>Posted {job.date_posted}</span>}
          </div>
          {job.summary && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.45 }}>
              {job.summary}
            </div>
          )}
          {job.extraction_error && (
            <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.3rem' }}>
              ⚠ AI extraction failed — sparse data
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-end', flexShrink: 0 }}>
          {job.job_link && (
            <a href={job.job_link} target="_blank" rel="noreferrer"
               style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textDecoration: 'none' }}>
              View ↗
            </a>
          )}

          {state === 'pending' && (
            <>
              <button
                onClick={handleTodo}
                style={{ fontSize: '0.75rem', padding: '3px 10px', background: 'none', border: '1px solid #2563eb', borderRadius: 4, cursor: 'pointer', color: '#2563eb', whiteSpace: 'nowrap' }}>
                + To-Do
              </button>
              {!showApplyDate ? (
                <button
                  onClick={handleApplied}
                  style={{ fontSize: '0.75rem', padding: '3px 10px', background: 'none', border: '1px solid #16a34a', borderRadius: 4, cursor: 'pointer', color: '#16a34a', whiteSpace: 'nowrap' }}>
                  ✓ Applied
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end' }}>
                  <input type="date" value={applyDate} onChange={e => setApplyDate(e.target.value)}
                    style={{ fontSize: '0.75rem', padding: '2px 6px', width: '130px' }} />
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button onClick={() => setShowApplyDate(false)}
                      style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}>
                      Cancel
                    </button>
                    <button onClick={handleApplied}
                      style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'none', border: '1px solid #16a34a', borderRadius: 4, cursor: 'pointer', color: '#16a34a' }}>
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {state === 'saving' && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Saving…</span>}
          {state === 'todo' && <span style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 600 }}>Added to To-Do ✓</span>}
          {state === 'applied' && <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>Saved as Applied ✓</span>}
          {state === 'error' && <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>Save failed</span>}
        </div>
      </div>
    </div>
  )
}

export default function JobInbox() {
  const [status, setStatus]       = useState('idle')  // idle | resolving | running | done | error
  const [progress, setProgress]   = useState(null)
  const [jobs, setJobs]           = useState([])
  const [warnings, setWarnings]   = useState([])
  const [doneCount, setDoneCount] = useState(null)
  const esRef = useRef(null)

  const startFetch = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
    }

    setJobs([])
    setWarnings([])
    setDoneCount(null)
    setProgress(null)
    setStatus('resolving')

    const es = new EventSource('/api/inbox/stream')
    esRef.current = es

    es.onmessage = (e) => {
      const event = JSON.parse(e.data)

      if (event.type === 'location_warn') {
        setWarnings(w => [...w, event.message + ` (${event.location})`])
      } else if (event.type === 'start') {
        setStatus('running')
        setProgress({ label: 'Starting…', n: 0, total: event.total })
      } else if (event.type === 'searching') {
        setProgress({ label: event.label, n: event.n, total: event.total })
      } else if (event.type === 'extracting') {
        setProgress(p => p ? { ...p, label: `Extracting: ${event.url}` } : p)
      } else if (event.type === 'job') {
        setJobs(prev => [event.data, ...prev])
      } else if (event.type === 'search_error') {
        // non-fatal, just continue
      } else if (event.type === 'done') {
        setDoneCount(event.found)
        setStatus('done')
        setProgress(null)
        es.close()
      }
    }

    es.onerror = () => {
      if (status !== 'done') setStatus('error')
      es.close()
    }
  }, [status])

  const stopFetch = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setStatus('idle')
    setProgress(null)
  }

  async function handleSaveTodo(job) {
    await api.inboxSaveTodo({
      company: job.company || null,
      org_team: job.org_team || null,
      job_title: job.job_title || null,
      job_type: job.job_type || null,
      locations: job.locations || [],
      work_arrangement: job.work_arrangement || null,
      salary_min: job.salary_min || null,
      salary_max: job.salary_max || null,
      salary_currency: job.salary_currency || 'USD',
      job_link: job.job_link || null,
      job_source: job.job_source || 'hiring.cafe',
      summary: job.summary || null,
      raw_text: job.raw_text || null,
      date_posted: job.date_posted || null,
      extracted_by_ai: true,
    })
  }

  async function handleSaveApplied(job, date_applied) {
    await api.inboxSaveApplied({
      company: job.company || null,
      org_team: job.org_team || null,
      job_title: job.job_title || null,
      job_type: job.job_type || null,
      locations: job.locations || [],
      work_arrangement: job.work_arrangement || null,
      salary_min: job.salary_min || null,
      salary_max: job.salary_max || null,
      salary_currency: job.salary_currency || 'USD',
      job_link: job.job_link || null,
      job_source: job.job_source || 'hiring.cafe',
      summary: job.summary || null,
      raw_text: job.raw_text || null,
      date_posted: job.date_posted || null,
      date_applied,
      status: 'applied',
    })
  }

  const isRunning = status === 'running' || status === 'resolving'
  const pct = progress && progress.total > 0 ? Math.round((progress.n / progress.total) * 100) : 0

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Job Inbox</h1>
        <p className="page-subtitle">
          Fetches new DS / ML / AI jobs from hiring.cafe across 9 locations · deduped against your existing tracker
        </p>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          {!isRunning ? (
            <button className="btn btn-primary" onClick={startFetch} style={{ minWidth: 120 }}>
              Fetch Jobs
            </button>
          ) : (
            <button
              onClick={stopFetch}
              style={{ minWidth: 120, padding: '0.45rem 1rem', background: 'none', border: '1px solid #dc2626', borderRadius: 6, cursor: 'pointer', color: '#dc2626', fontFamily: 'inherit', fontSize: '0.875rem' }}>
              Stop
            </button>
          )}

          {isRunning && progress && (
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className="spinner" style={{ marginRight: '0.4rem' }} />
                {progress.label}
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: '#2563eb', borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {progress.n} / {progress.total} combinations
              </div>
            </div>
          )}

          {status === 'resolving' && !progress && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span className="spinner" style={{ marginRight: '0.4rem' }} />
              Resolving location IDs…
            </span>
          )}

          {status === 'done' && (
            <span style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
              Done — {doneCount} new job{doneCount !== 1 ? 's' : ''} found
            </span>
          )}

          {status === 'error' && (
            <span style={{ fontSize: '0.85rem', color: '#dc2626' }}>Stream error — try again</span>
          )}

          {jobs.length > 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {jobs.length} card{jobs.length !== 1 ? 's' : ''} loaded
            </span>
          )}
        </div>

        {warnings.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontSize: '0.78rem', color: '#b45309', padding: '0.25rem 0' }}>⚠ {w}</div>
            ))}
          </div>
        )}
      </div>

      {/* Job cards */}
      {jobs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {jobs.map((job, i) => (
            <JobCard
              key={`${job.job_link || ''}-${i}`}
              job={job}
              onSaveTodo={handleSaveTodo}
              onSaveApplied={handleSaveApplied}
            />
          ))}
        </div>
      )}

      {status === 'idle' && jobs.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
          Press <strong>Fetch Jobs</strong> to pull new listings from hiring.cafe
        </div>
      )}
    </div>
  )
}
