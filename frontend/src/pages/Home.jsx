import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import MetricCard from '../components/MetricCard'

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000)
}

export default function Home() {
  const [apps, setApps] = useState([])
  const [todos, setTodos] = useState([])

  useEffect(() => {
    api.applications().then(setApps).catch(console.error)
    api.todos().then(setTodos).catch(console.error)
  }, [])

  const active = apps.filter(a => !['declined', 'inactive'].includes(a.status))
  const interviewing = apps.filter(a => a.status === 'interviewing')
  const offers = apps.filter(a => a.status === 'offer')

  const stale90 = active.filter(a => daysSince(a.updated_at) >= 90)
  const stale60 = active.filter(a => {
    const d = daysSince(a.updated_at)
    return d >= 60 && d < 90
  })
  const stale30 = active.filter(a => {
    const d = daysSince(a.updated_at)
    return d >= 30 && d < 60
  })

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Home</h1>
        <p className="page-subtitle">Overview of your job search</p>
      </div>

      <div className="metrics-row metrics-row-5">
        <MetricCard label="Total Applied"  value={apps.length}          color="#3b82f6" />
        <MetricCard label="Active"         value={active.length}        color="#22c55e" />
        <MetricCard label="Interviewing"   value={interviewing.length}  color="#f59e0b" />
        <MetricCard label="Offers"         value={offers.length}        color="#a855f7" />
        <MetricCard label="To-Do Queue"    value={todos.length}         color="#64748b" />
      </div>

      {stale90.length > 0 && (
        <div className="alert alert-danger">
          <span>🔴</span>
          <div><strong>{stale90.length} app(s) stale 90+ days:</strong> {stale90.map(a => a.company).join(', ')}</div>
        </div>
      )}
      {stale60.length > 0 && (
        <div className="alert alert-warning">
          <span>🟠</span>
          <div><strong>{stale60.length} app(s) stale 60–89 days:</strong> {stale60.map(a => a.company).join(', ')}</div>
        </div>
      )}
      {stale30.length > 0 && (
        <div className="alert alert-warning" style={{ background: '#fefce8', borderColor: '#fde68a', color: '#854d0e' }}>
          <span>🟡</span>
          <div><strong>{stale30.length} app(s) stale 30–59 days:</strong> {stale30.map(a => a.company).join(', ')}</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Quick Navigation</div>
        <table>
          <thead>
            <tr><th>Page</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr><td><Link to="/new">New Application</Link></td><td>Log a completed job application</td></tr>
            <tr><td><Link to="/in-progress">Dashboard</Link></td><td>View and update active applications; US map view</td></tr>
            <tr><td><Link to="/todo">To-Do</Link></td><td>Save jobs to apply to later; AI URL extraction</td></tr>
            <tr><td><Link to="/analyze">Analyze</Link></td><td>Charts: by type, status, company, salary, timeline</td></tr>
            <tr><td><Link to="/scraper-log">Scraper Log</Link></td><td>AI extraction attempt history and stats</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
