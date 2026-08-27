import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import MetricCard from '../components/MetricCard'

// A failure counts as "blocked" (IP flagged / rate limited / forbidden) rather
// than an ordinary scrape miss when its error mentions a refusal status code or
// wording. These are the rows worth surfacing separately — they usually mean the
// Jina Reader key is missing, invalid, or out of quota.
const BLOCKED_RE = /\b(401|403|429|451)\b|forbidden|blocked|malicious|rate limited|too many requests/i

function isBlocked(l) {
  return !l.success && BLOCKED_RE.test(l.error_message || '')
}

function JinaKeyCard() {
  const [key, setKey] = useState(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.settings().then(s => setKey(s.jina_api_key || '')).catch(console.error)
  }, [])

  async function save() {
    setSaving(true)
    try {
      const s = await api.updateSettings({ jina_api_key: key })
      setKey(s.jina_api_key || '')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (key === null) return null

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="card-title">Jina Reader API Key</div>
      <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem', marginBottom: '0.75rem' }}>
        Keyless requests to <code>r.jina.ai</code> are now rate limited and return{' '}
        <strong>HTTP 403 “malicious requests”</strong>. Paste a key from{' '}
        <a href="https://jina.ai/reader" target="_blank" rel="noreferrer">jina.ai/reader</a>{' '}
        to restore the primary fetch path. Stored locally in the app database; sent
        only to Jina as a Bearer token.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="password"
          placeholder="jina_..."
          value={key}
          onChange={e => setKey(e.target.value)}
          style={{ flex: 1, minWidth: 240, fontFamily: 'monospace' }}
        />
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span style={{ color: '#22c55e', fontSize: '0.8rem' }}>Saved ✓</span>}
      </div>
    </div>
  )
}

export default function ScraperLog() {
  const [logs, setLogs]     = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => { api.scraperLog().then(setLogs).catch(console.error) }, [])

  if (!logs) return <div className="text-muted">Loading…</div>

  if (!logs.length) return (
    <div>
      <div className="page-header"><h1 className="page-title">Scraper Log</h1></div>
      <JinaKeyCard />
      <div className="alert alert-info">No scrape attempts logged yet. Use the To-Do page to extract a job URL.</div>
    </div>
  )

  const total       = logs.length
  const successRate = (logs.filter(l => l.success).length / total * 100).toFixed(1)
  const avgLatency  = Math.round(logs.reduce((s, l) => s + (l.latency_ms || 0), 0) / total)
  const jinaCount   = logs.filter(l => l.method === 'jina').length
  const pwCount     = logs.filter(l => l.method === 'playwright').length

  const blocked = logs.filter(isBlocked)
  // One entry per distinct URL, keeping the most recent attempt (logs arrive newest-first).
  const blockedByUrl = []
  const seen = new Set()
  for (const l of blocked) {
    if (seen.has(l.url)) continue
    seen.add(l.url)
    blockedByUrl.push(l)
  }

  const methodMap = {}
  logs.forEach(l => {
    if (!methodMap[l.method]) methodMap[l.method] = { attempts: 0, successes: 0, latencySum: 0 }
    methodMap[l.method].attempts++
    if (l.success) methodMap[l.method].successes++
    methodMap[l.method].latencySum += l.latency_ms || 0
  })
  const methodStats = Object.entries(methodMap).map(([method, s]) => ({
    method,
    attempts:     s.attempts,
    successes:    s.successes,
    failures:     s.attempts - s.successes,
    success_rate: (s.successes / s.attempts * 100).toFixed(1),
    avg_latency:  Math.round(s.latencySum / s.attempts),
  }))

  const filtered = search
    ? logs.filter(l => l.url?.toLowerCase().includes(search.toLowerCase()))
    : logs

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Scraper Log</h1>
        <p className="page-subtitle">AI extraction attempt history</p>
      </div>

      <JinaKeyCard />

      <div className="metrics-row metrics-row-5">
        <MetricCard label="Total Attempts"      value={total} />
        <MetricCard label="Success Rate"        value={`${successRate}%`} color="#22c55e" />
        <MetricCard label="Blocked / Forbidden" value={blockedByUrl.length} color="#ef4444" />
        <MetricCard label="Jina Attempts"       value={jinaCount}  color="#3b82f6" />
        <MetricCard label="Playwright Attempts" value={pwCount}    color="#f59e0b" />
      </div>

      {blockedByUrl.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderLeft: '3px solid #ef4444' }}>
          <div className="card-title">
            🚫 Jobs that failed because the IP was blocked ({blockedByUrl.length})
          </div>
          <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0 0.75rem' }}>
            These URLs returned a refusal status (403/429/451) — the request was flagged
            as malicious or rate limited, not that the page was missing. Add a Jina API
            key above and re-run the extraction, or open the link and paste the text
            manually.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th><th>Method</th><th>Error</th><th>Last Attempt</th>
                </tr>
              </thead>
              <tbody>
                {blockedByUrl.map(l => (
                  <tr key={l.id}>
                    <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={l.url} target="_blank" rel="noreferrer">{l.url}</a>
                    </td>
                    <td>{l.method}</td>
                    <td className="text-muted" style={{ maxWidth: 320 }}>{l.error_message || '—'}</td>
                    <td className="text-muted">{l.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="two-col">
        <div className="card">
          <div className="card-title">Method Breakdown</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Method</th><th>Attempts</th><th>Successes</th><th>Success Rate</th><th>Avg ms</th>
                </tr>
              </thead>
              <tbody>
                {methodStats.map(s => (
                  <tr key={s.method}>
                    <td><strong>{s.method}</strong></td>
                    <td>{s.attempts}</td>
                    <td>{s.successes}</td>
                    <td>{s.success_rate}%</td>
                    <td>{s.avg_latency.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Success vs Failure by Method</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={methodStats} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="method" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="successes" name="Success" fill="#22c55e" radius={[4,4,0,0]} />
              <Bar dataKey="failures"  name="Failure" fill="#ef4444" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Raw Log</div>
        <input
          type="text"
          placeholder="Filter by URL…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: '1rem', maxWidth: '400px' }}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>URL</th><th>Method</th><th>Result</th>
                <th>Latency (ms)</th><th>Error</th><th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id}>
                  <td className="text-muted">{l.id}</td>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={l.url} target="_blank" rel="noreferrer">{l.url}</a>
                  </td>
                  <td>{l.method}</td>
                  <td>{l.success ? '✅' : (isBlocked(l) ? '🚫' : '❌')}</td>
                  <td>{l.latency_ms?.toLocaleString()}</td>
                  <td className="text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.error_message || '—'}
                  </td>
                  <td className="text-muted">{l.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
