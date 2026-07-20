import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { api } from '../api'
import MetricCard from '../components/MetricCard'

const TODAY = new Date().toISOString().split('T')[0]

// Mirrors hiring_cafe_client.LOCATIONS order (grouped by state), so the
// filter dropdown doesn't scatter same-state cities via alphabetical sort.
const LOCATION_ORDER = [
  'Remote',
  'Charlotte, NC', 'Raleigh/Durham, NC', 'Winston-Salem, NC', 'Chapel Hill, NC',
  'Charleston, SC',
  'Charlottesville, VA', 'Richmond, VA',
  'Nashville, TN',
  'Atlanta, GA',
]

// Job tracks selected by default when the page loads (mirrors discovery.JOB_TRACKS
// labels); "Analytics Engineer" is left off by default but can still be toggled on.
const DEFAULT_TRACKS = [
  'Data Scientist', 'Data Science Engineer', 'AI Engineer', 'ML Engineer', 'GenAI/LLM Engineer',
]

const RECENT_SEARCHES_KEY = 'jobDiscovery.recentSearches'
const MAX_RECENT_SEARCHES = 8

function loadRecentSearches() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

// Ascending seniority — covers hiring.cafe's known labels; unrecognized/missing
// values always sort last regardless of direction.
const SENIORITY_ORDER = [
  'internship',
  'no prior experience required',
  'entry level',
  'junior level',
  'mid level',
  'senior level',
  'lead level',
  'staff level',
  'principal level',
  'director level',
  'executive level',
]

function seniorityRank(level) {
  if (!level) return -1
  const idx = SENIORITY_ORDER.indexOf(level.trim().toLowerCase())
  return idx
}

function compareSeniority(a, b, dir) {
  const ra = seniorityRank(a.seniority_level)
  const rb = seniorityRank(b.seniority_level)
  if (ra === -1 && rb === -1) return 0
  if (ra === -1) return 1
  if (rb === -1) return -1
  return dir === 'asc' ? ra - rb : rb - ra
}

function parseSqliteUTC(s) {
  if (!s) return null
  return new Date(s.replace(' ', 'T') + 'Z')
}

function timeAgo(iso) {
  const d = parseSqliteUTC(iso)
  if (!d) return null
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (diffSec < 60) return 'just now'
  const m = Math.floor(diffSec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatRunLabel(run) {
  const d = parseSqliteUTC(run.started_at)
  if (!d) return `Batch #${run.id}`
  const now = new Date()
  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  let dayStr
  if (dayDiff === 0) dayStr = 'Today'
  else if (dayDiff === 1) dayStr = 'Yesterday'
  else dayStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const suffix = run.status !== 'done' ? ` (${run.status})` : ''
  return `${dayStr}, ${timeStr} — ${run.jobs_new ?? 0} new${suffix}`
}

function fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '—'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

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
  const parts = locs.length ? [...locs] : []
  if (job.work_arrangement) parts.push(job.work_arrangement)
  return parts.join(' · ') || null
}

function jobPayload(job) {
  return {
    company: job.company || null,
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
  }
}

function tokenize(text) {
  return (text || '').toLowerCase().match(/[a-z0-9]+/g) || []
}

function jobSearchText(job) {
  return `${job.job_title || ''} ${job.summary || ''}`
}

// Simple BM25 ranking over job_title + summary. Query terms match tokens by
// substring (not exact equality) so "eval" ranks docs containing "evaluation".
const BM25_K1 = 1.5
const BM25_B = 0.75

function bm25Rank(docs, getText, query) {
  const terms = tokenize(query)
  if (terms.length === 0) return docs.map(doc => ({ doc, score: 0 }))

  const docTokens = docs.map(d => tokenize(getText(d)))
  const docLens = docTokens.map(t => t.length)
  const N = docs.length
  const avgdl = docLens.reduce((a, b) => a + b, 0) / (N || 1)

  const df = new Map()
  for (const term of terms) {
    let count = 0
    for (const tokens of docTokens) {
      if (tokens.some(t => t.includes(term))) count++
    }
    df.set(term, count)
  }

  return docs.map((doc, i) => {
    const tokens = docTokens[i]
    const docLen = docLens[i]
    let score = 0
    for (const term of terms) {
      const tf = tokens.filter(t => t.includes(term)).length
      if (tf === 0) continue
      const idf = Math.log((N - df.get(term) + 0.5) / (df.get(term) + 0.5) + 1)
      score += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgdl)))
    }
    return { doc, score }
  })
}

function TagEditor({ job, onUpdateTags }) {
  const [showInput, setShowInput] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const tags = job.tags || []

  function addTag() {
    const t = tagInput.trim()
    if (!t) return
    onUpdateTags(job, [...new Set([...tags, t])])
    setTagInput('')
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center', marginTop: '0.4rem' }}>
      {tags.map(tag => (
        <span key={tag} style={{ fontSize: '0.72rem', background: '#ede9fe', color: '#6d28d9', padding: '1px 6px', borderRadius: 9999, display: 'flex', alignItems: 'center', gap: '3px' }}>
          {tag}
          <button
            onClick={() => onUpdateTags(job, tags.filter(t => t !== tag))}
            title={`Remove tag "${tag}"`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6d28d9', fontSize: '0.7rem', padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
      {showInput ? (
        <span style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input
            autoFocus
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addTag()
              else if (e.key === 'Escape') { setTagInput(''); setShowInput(false) }
            }}
            placeholder="tag, Enter to add"
            style={{ fontSize: '0.72rem', padding: '1px 6px', width: 120 }}
          />
          <button
            onClick={() => { setTagInput(''); setShowInput(false) }}
            style={{ fontSize: '0.7rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          style={{ fontSize: '0.72rem', padding: '1px 8px', background: 'none', border: '1px dashed var(--border)', borderRadius: 9999, cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          + tag
        </button>
      )}
    </div>
  )
}

function JobCard({ job, onSaveTodo, onSaveApplied, onDismiss, onUpdateTags }) {
  const [state, setState] = useState('pending') // pending | saving | todo | applied | error
  const [applyDate, setApplyDate] = useState(TODAY)
  const [showApplyDate, setShowApplyDate] = useState(false)
  const sal = salaryDisplay(job)
  const loc = locDisplay(job)

  async function handleTodo() {
    setState('saving')
    try { await onSaveTodo(job); setState('todo') } catch { setState('error') }
  }

  async function handleApplied() {
    if (!showApplyDate) { setShowApplyDate(true); return }
    setState('saving')
    try { await onSaveApplied(job, applyDate); setState('applied') } catch { setState('error') }
  }

  const isSaved = state === 'todo' || state === 'applied'
  const failedEnrichment = job.phase2_status === 'error'

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${state === 'todo' ? '#2563eb' : state === 'applied' ? '#16a34a' : state === 'error' ? '#dc2626' : failedEnrichment ? '#b45309' : 'var(--border)'}`,
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
          </div>
          <div style={{ fontSize: '0.88rem', marginBottom: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            {job.job_title || <span style={{ color: 'var(--text-muted)' }}>—</span>}
            {job.job_type && <span style={{ fontSize: '0.75rem', background: 'var(--tag-bg, #e5e7eb)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 9999 }}>{job.job_type}</span>}
            {job.seniority_level && <span style={{ fontSize: '0.75rem', background: 'var(--tag-bg, #e5e7eb)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 9999 }}>{job.seniority_level}</span>}
            {job.min_yoe != null && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{job.min_yoe}+ YOE</span>}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {loc && <span>{loc}</span>}
            {sal && <span style={{ color: '#16a34a', fontWeight: 600 }}>{sal}</span>}
            {job.date_posted && <span>Posted {job.date_posted}</span>}
            {job.search_location && <span>Matched: {job.search_location}</span>}
          </div>
          {job.summary && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.45 }}>
              {job.summary}
            </div>
          )}
          {failedEnrichment && (
            <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.3rem' }}>
              ⚠ Enrichment failed — {job.phase2_error || 'sparse data'}
            </div>
          )}
          <TagEditor job={job} onUpdateTags={onUpdateTags} />
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
              <button onClick={handleTodo}
                style={{ fontSize: '0.75rem', padding: '3px 10px', background: 'none', border: '1px solid #2563eb', borderRadius: 4, cursor: 'pointer', color: '#2563eb', whiteSpace: 'nowrap' }}>
                + To-Do
              </button>
              {!showApplyDate ? (
                <button onClick={handleApplied}
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
              <button onClick={() => onDismiss(job)}
                style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}>
                Dismiss
              </button>
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

function PhaseBar({ label, n, total, active, color }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        <span>{active && <span className="spinner spinner-dark" style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />}{label}</span>
        <span>{n} / {total}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function JobDiscovery() {
  const [jobs, setJobs] = useState([])
  const [runs, setRuns] = useState([]) // batch history, most recent first
  const lastRun = runs[0] || null

  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [phase, setPhase] = useState(null)      // null | phase1 | phase2
  const [phase1, setPhase1] = useState({ n: 0, total: 0 })
  const [phase2, setPhase2] = useState({ n: 0, total: 0 })
  const [currentLabel, setCurrentLabel] = useState('')
  const [locationWarnings, setLocationWarnings] = useState([])
  const [comboErrors, setComboErrors] = useState([])
  const [enrichErrors, setEnrichErrors] = useState([])
  const [runSummary, setRunSummary] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [startedAt, setStartedAt] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const [view, setView] = useState('results')
  const [trackFilters, setTrackFilters] = useState(DEFAULT_TRACKS) // empty = all tracks
  const [locationFilter, setLocationFilter] = useState('')
  const [seniorityDir, setSeniorityDir] = useState(null) // null | 'asc' | 'desc'
  const [batchFilter, setBatchFilter] = useState('') // '' = all batches, else a run id
  const [tagFilters, setTagFilters] = useState([]) // empty = all tagged jobs (Tagged view)
  const [searchQuery, setSearchQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches)
  const [showRecent, setShowRecent] = useState(false)

  const esRef = useRef(null)

  function commitSearch(q) {
    const trimmed = q.trim()
    if (!trimmed) return
    setRecentSearches(prev => {
      const next = [trimmed, ...prev.filter(s => s.toLowerCase() !== trimmed.toLowerCase())]
        .slice(0, MAX_RECENT_SEARCHES)
      try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  useEffect(() => {
    api.discoveryJobs().then(setJobs).catch(() => {})
    api.discoveryRuns().then(setRuns).catch(() => {})
  }, [])

  useEffect(() => {
    if (status !== 'running' || !startedAt) return
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 500)
    return () => clearInterval(id)
  }, [status, startedAt])

  const startRun = useCallback(() => {
    if (esRef.current) esRef.current.close()

    setJobs([])
    setLocationWarnings([]); setComboErrors([]); setEnrichErrors([])
    setPhase(null); setPhase1({ n: 0, total: 0 }); setPhase2({ n: 0, total: 0 })
    setRunSummary(null); setErrorMessage('')
    setStatus('running')
    setStartedAt(Date.now())
    setCurrentLabel('Starting…')

    const es = new EventSource('/api/discovery/stream')
    esRef.current = es

    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      switch (event.type) {
        case 'location_warn':
          setLocationWarnings(w => [...w, `${event.message} (${event.location})`])
          break
        case 'fatal_error':
          setStatus('error'); setErrorMessage(event.message); es.close()
          break
        case 'start':
          setPhase('phase1'); setPhase1({ n: 0, total: event.total })
          break
        case 'searching':
          setCurrentLabel(event.label); setPhase1(p => ({ ...p, n: event.n - 1 }))
          break
        case 'job':
          setJobs(prev => [event.data, ...prev])
          break
        case 'combo_done':
          setPhase1(p => ({ ...p, n: event.n }))
          break
        case 'combo_error':
          setComboErrors(errs => [...errs, { label: event.label, error: event.error }])
          break
        case 'phase2_start':
          setPhase('phase2'); setPhase2({ n: 0, total: event.total }); setCurrentLabel('Enriching sparse listings…')
          break
        case 'enriching':
          setCurrentLabel(`Enriching: ${event.url}`); setPhase2(p => ({ ...p, n: event.n - 1 }))
          break
        case 'enriched':
          setPhase2(p => ({ ...p, n: p.n + 1 }))
          setJobs(prev => prev.map(j => j.id === event.job_id ? { ...j, phase2_status: 'enriched' } : j))
          break
        case 'enrich_error':
          setPhase2(p => ({ ...p, n: p.n + 1 }))
          setEnrichErrors(errs => [...errs, { job_id: event.job_id, error: event.error }])
          setJobs(prev => prev.map(j => j.id === event.job_id ? { ...j, phase2_status: 'error', phase2_error: event.error } : j))
          break
        case 'done':
          setStatus('done'); setPhase(null); setCurrentLabel('')
          setRunSummary({
            jobs_found: event.jobs_found, jobs_new: event.jobs_new,
            jobs_enriched: event.jobs_enriched, jobs_failed: event.jobs_failed,
          })
          api.discoveryRuns().then(setRuns).catch(() => {})
          es.close()
          break
      }
    }

    es.onerror = () => {
      setStatus(s => (s === 'done' ? s : 'error'))
      es.close()
    }
  }, [])

  const stopRun = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setStatus('idle'); setPhase(null); setCurrentLabel('')
  }

  async function handleSaveTodo(job) {
    await api.discoverySaveTodo({ discovered_job_id: job.id, ...jobPayload(job), extracted_by_ai: true })
  }
  async function handleSaveApplied(job, date_applied) {
    await api.discoverySaveApplied({ discovered_job_id: job.id, ...jobPayload(job), date_applied, status: 'applied' })
  }
  async function handleDismiss(job) {
    await api.discoveryDismiss(job.id)
    setJobs(prev => prev.filter(j => j.id !== job.id))
  }
  async function handleUpdateTags(job, tags) {
    const cleaned = [...new Set(tags.map(t => t.trim()).filter(Boolean))]
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, tags: cleaned } : j))
    try { await api.discoverySetTags(job.id, cleaned) } catch { /* ignore */ }
  }

  const isRunning = status === 'running'

  const trackOptions = useMemo(
    () => [...new Set(jobs.map(j => j.job_type).filter(Boolean))].sort(),
    [jobs]
  )
  const locationOptions = useMemo(() => {
    const present = new Set(jobs.map(j => j.search_location).filter(Boolean))
    return LOCATION_ORDER.filter(l => present.has(l))
  }, [jobs])

  const facetFilteredJobs = useMemo(() => jobs.filter(j =>
    (trackFilters.length === 0 || trackFilters.includes(j.job_type)) &&
    (!locationFilter || j.search_location === locationFilter) &&
    (!batchFilter || String(j.run_id) === String(batchFilter))
  ), [jobs, trackFilters, locationFilter, batchFilter])

  const visibleJobs = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) {
      const arr = [...facetFilteredJobs]
      if (seniorityDir) arr.sort((a, b) => compareSeniority(a, b, seniorityDir))
      return arr
    }
    return bm25Rank(facetFilteredJobs, jobSearchText, q)
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.doc)
  }, [facetFilteredJobs, searchQuery, seniorityDir])

  // Location totals respect the track selection + current batch, but deliberately
  // ignore the location filter and search box — this is meant to show the full spread.
  const locationCounts = useMemo(() => {
    const filtered = jobs.filter(j =>
      (trackFilters.length === 0 || trackFilters.includes(j.job_type)) &&
      (!batchFilter || String(j.run_id) === String(batchFilter))
    )
    const counts = new Map()
    for (const j of filtered) {
      const loc = j.search_location || 'Unknown'
      counts.set(loc, (counts.get(loc) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [jobs, trackFilters, batchFilter])

  // Tag counts/options come from the facet-filtered set (track/location/batch),
  // so the Tagged view's pill list matches whatever's currently in scope.
  const tagCounts = useMemo(() => {
    const counts = new Map()
    for (const j of facetFilteredJobs) {
      for (const t of (j.tags || [])) counts.set(t, (counts.get(t) || 0) + 1)
    }
    return counts
  }, [facetFilteredJobs])
  const allTags = useMemo(() => [...tagCounts.keys()].sort(), [tagCounts])
  const taggedJobs = useMemo(() => facetFilteredJobs.filter(j =>
    (j.tags || []).length > 0 &&
    (tagFilters.length === 0 || tagFilters.some(t => (j.tags || []).includes(t)))
  ), [facetFilteredJobs, tagFilters])

  const failedJobs = jobs.filter(j => j.phase2_status === 'error')

  const overallDone = phase1.n + (phase2.total ? phase2.n : 0)
  const overallTotal = phase1.total + (phase2.total || 0)
  const overallPct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0
  const avgPerUnit = overallDone > 0 ? elapsedMs / overallDone : null
  const etaMs = avgPerUnit != null ? avgPerUnit * Math.max(0, overallTotal - overallDone) : null

  const liveNew = runSummary?.jobs_new ?? jobs.length
  const liveEnriched = runSummary?.jobs_enriched ?? jobs.filter(j => j.phase2_status === 'enriched').length
  const liveFailed = runSummary?.jobs_failed ?? failedJobs.length

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Job Discovery</h1>
        <p className="page-subtitle">
          Pulls DS / AI / ML postings from hiring.cafe across 6 job tracks × 11 locations (66 combinations),
          deduped against your tracker · posted in the last 3 days
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: isRunning || phase ? '0.9rem' : 0 }}>
          {!isRunning ? (
            <button className="btn btn-primary" onClick={startRun} style={{ minWidth: 140 }}>
              Run Discovery
            </button>
          ) : (
            <button onClick={stopRun}
              style={{ minWidth: 140, padding: '0.45rem 1rem', background: 'none', border: '1px solid #dc2626', borderRadius: 6, cursor: 'pointer', color: '#dc2626', fontFamily: 'inherit', fontSize: '0.875rem' }}>
              Stop
            </button>
          )}

          {isRunning && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Elapsed {fmtDuration(elapsedMs)} · ETA {fmtDuration(etaMs)} · {overallPct}% overall
            </div>
          )}

          {status === 'done' && runSummary && (
            <span style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
              Done — {runSummary.jobs_new} new job{runSummary.jobs_new !== 1 ? 's' : ''} found
            </span>
          )}

          {status === 'error' && (
            <span style={{ fontSize: '0.85rem', color: '#dc2626' }}>{errorMessage || 'Stream error — try again'}</span>
          )}

          {status === 'idle' && lastRun && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Last run {timeAgo(lastRun.finished_at || lastRun.started_at)} · {lastRun.jobs_new ?? 0} new jobs found
            </span>
          )}
        </div>

        {(isRunning || phase) && (
          <>
            <div className="combo-current" key={currentLabel} style={{ fontSize: '0.82rem', marginBottom: '0.6rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentLabel}
            </div>
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
              <PhaseBar label="Phase 1 · Discovery" n={phase1.n} total={phase1.total} active={phase === 'phase1'} color="#2563eb" />
              <PhaseBar label="Phase 2 · Enrichment" n={phase2.n} total={phase2.total} active={phase === 'phase2'} color="#a855f7" />
            </div>
          </>
        )}

        {locationWarnings.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            {locationWarnings.map((w, i) => (
              <div key={i} style={{ fontSize: '0.78rem', color: '#b45309', padding: '0.15rem 0' }}>⚠ {w}</div>
            ))}
          </div>
        )}
      </div>

      <div className="metrics-row metrics-row-5" style={{ marginBottom: '1rem' }}>
        <MetricCard label="New Jobs"          value={liveNew}              color="#3b82f6" />
        <MetricCard label="Total Matched"     value={runSummary?.jobs_found ?? jobs.length} color="#64748b" />
        <MetricCard label="Enriched OK"       value={liveEnriched}         color="#16a34a" />
        <MetricCard label="Enrichment Failed" value={liveFailed}           color="#b45309" />
        <MetricCard label="Combo Errors"      value={comboErrors.length}   color="#dc2626" />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button className={`tab-pill${view === 'results' ? ' active' : ''}`} onClick={() => setView('results')}>
          Results ({visibleJobs.length})
        </button>
        <button className={`tab-pill${view === 'tagged' ? ' active' : ''}`} onClick={() => setView('tagged')}>
          Tagged ({taggedJobs.length})
        </button>
        <button className={`tab-pill${view === 'failed' ? ' active' : ''}`} onClick={() => setView('failed')}>
          Failed ({failedJobs.length + comboErrors.length})
        </button>
      </div>

      {view === 'results' && (
        <>
          {jobs.length > 0 && (
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {trackOptions.map(t => (
                  <button
                    key={t}
                    className={`tab-pill${trackFilters.includes(t) ? ' active' : ''}`}
                    onClick={() => setTrackFilters(prev =>
                      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
                    )}
                  >
                    {t}
                  </button>
                ))}
                {trackFilters.length > 0 && (
                  <button
                    onClick={() => setTrackFilters([])}
                    style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All locations</option>
                {locationOptions.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <button
                className={`tab-pill${seniorityDir ? ' active' : ''}`}
                onClick={() => setSeniorityDir(d => d === null ? 'asc' : d === 'asc' ? 'desc' : null)}
              >
                Seniority {seniorityDir === 'asc' ? '↑ Junior first' : seniorityDir === 'desc' ? '↓ Senior first' : '(unsorted)'}
              </button>
              {runs.length > 0 && (
                <select value={batchFilter} onChange={e => setBatchFilter(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">All batches</option>
                  {runs.map(r => <option key={r.id} value={r.id}>{formatRunLabel(r)}</option>)}
                </select>
              )}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search titles & descriptions…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => setShowRecent(true)}
                  onBlur={() => setTimeout(() => setShowRecent(false), 150)}
                  onKeyDown={e => { if (e.key === 'Enter') commitSearch(searchQuery) }}
                  style={{ width: 240, fontSize: '0.8rem', padding: '4px 26px 4px 8px' }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                    style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}
                  >
                    ✕
                  </button>
                )}
                {showRecent && !searchQuery && recentSearches.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--card-bg)',
                    border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    zIndex: 10, minWidth: 200, overflow: 'hidden',
                  }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>
                      Recent searches
                    </div>
                    {recentSearches.map(s => (
                      <div
                        key={s}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setSearchQuery(s); commitSearch(s); setShowRecent(false) }}
                        style={{ fontSize: '0.78rem', padding: '5px 10px', cursor: 'pointer' }}
                      >
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {jobs.length > 0 && (
            <div className="card" style={{ marginBottom: '0.75rem', padding: '0.75rem 1rem' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Jobs per location — current batch, respecting selected track filters
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {locationCounts.length > 0 ? locationCounts.map(([loc, count]) => (
                  <span key={loc} style={{ fontSize: '0.78rem', background: 'var(--tag-bg, #e5e7eb)', padding: '3px 10px', borderRadius: 9999 }}>
                    {loc}: <strong>{count}</strong>
                  </span>
                )) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No jobs match the current track/batch selection.</span>
                )}
              </div>
            </div>
          )}

          {visibleJobs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {visibleJobs.map((job, i) => (
                <JobCard
                  key={job.id ?? `${job.job_link || ''}-${i}`}
                  job={job}
                  onSaveTodo={handleSaveTodo}
                  onSaveApplied={handleSaveApplied}
                  onDismiss={handleDismiss}
                  onUpdateTags={handleUpdateTags}
                />
              ))}
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
              {status === 'idle'
                ? <>Press <strong>Run Discovery</strong> to pull new listings from hiring.cafe</>
                : 'No matching results yet…'}
            </div>
          )}
        </>
      )}

      {view === 'tagged' && (
        <div>
          {allTags.length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
              {allTags.map(t => (
                <button
                  key={t}
                  className={`tab-pill${tagFilters.includes(t) ? ' active' : ''}`}
                  onClick={() => setTagFilters(prev =>
                    prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
                  )}
                >
                  {t} ({tagCounts.get(t) || 0})
                </button>
              ))}
              {tagFilters.length > 0 && (
                <button
                  onClick={() => setTagFilters([])}
                  style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {taggedJobs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {taggedJobs.map((job, i) => (
                <JobCard
                  key={job.id ?? `${job.job_link || ''}-${i}`}
                  job={job}
                  onSaveTodo={handleSaveTodo}
                  onSaveApplied={handleSaveApplied}
                  onDismiss={handleDismiss}
                  onUpdateTags={handleUpdateTags}
                />
              ))}
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
              No tagged jobs yet — add a tag from a job card in Results to see it here.
            </div>
          )}
        </div>
      )}

      {view === 'failed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {comboErrors.length === 0 && failedJobs.length === 0 && (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
              Nothing failed — nice.
            </div>
          )}

          {comboErrors.map((e, i) => (
            <div key={`combo-${i}`} className="card" style={{ borderLeft: '3px solid #dc2626' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Combo search failed: {e.label}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{e.error}</div>
            </div>
          ))}

          {failedJobs.map(job => (
            <div key={job.id} className="card" style={{ borderLeft: '3px solid #b45309' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                {job.company} — {job.job_title}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Enrichment failed: {job.phase2_error || 'unknown error'}
              </div>
              {job.job_link && (
                <a href={job.job_link} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem' }}>View posting ↗</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
