import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import MetricCard from '../components/MetricCard'

export default function ScraperLog() {
  const [logs, setLogs]     = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => { api.scraperLog().then(setLogs).catch(console.error) }, [])

  if (!logs) return <div className="text-muted">Loading…</div>

  if (!logs.length) return (
    <div>
      <div className="page-header"><h1 className="page-title">Scraper Log</h1></div>
      <div className="alert alert-info">No scrape attempts logged yet. Use the To-Do page to extract a job URL.</div>
    </div>
  )

  const total       = logs.length
  const successRate = (logs.filter(l => l.success).length / total * 100).toFixed(1)
  const avgLatency  = Math.round(logs.reduce((s, l) => s + (l.latency_ms || 0), 0) / total)
  const jinaCount   = logs.filter(l => l.method === 'jina').length
  const pwCount     = logs.filter(l => l.method === 'playwright').length

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

      <div className="metrics-row metrics-row-5">
        <MetricCard label="Total Attempts"      value={total} />
        <MetricCard label="Success Rate"        value={`${successRate}%`} color="#22c55e" />
        <MetricCard label="Avg Latency (ms)"    value={avgLatency.toLocaleString()} />
        <MetricCard label="Jina Attempts"       value={jinaCount}  color="#3b82f6" />
        <MetricCard label="Playwright Attempts" value={pwCount}    color="#f59e0b" />
      </div>

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
                  <td>{l.success ? '✅' : '❌'}</td>
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
