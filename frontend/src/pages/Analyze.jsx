import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
  AreaChart, Area, ReferenceLine,
} from 'recharts'
import { api } from '../api'
import MetricCard from '../components/MetricCard'

const STATUS_COLORS = {
  applied: '#4A90D9', interviewing: '#F5A623', offer: '#27AE60',
  declined: '#E74C3C', inactive: '#95A5A6',
}
const PALETTE = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6','#f97316','#6366f1']

function objToArr(obj) {
  return Object.entries(obj || {}).map(([name, value]) => ({ name, value }))
}

function SalaryBins({ data }) {
  if (!data?.length) return null
  const vals = data.map(d => d.value).filter(v => v != null)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const step = (max - min) / 15 || 10000
  const buckets = {}
  vals.forEach(v => {
    const b = Math.floor((v - min) / step)
    const key = `$${Math.round((min + b * step) / 1000)}k`
    buckets[key] = (buckets[key] || 0) + 1
  })
  const bins = Object.entries(buckets).map(([name, count]) => ({ name, count }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={bins} margin={{ top: 5, right: 20, bottom: 30, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" name="Count" fill="#a855f7" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function Analyze() {
  const [data, setData] = useState(null)

  useEffect(() => { api.analytics().then(setData).catch(console.error) }, [])

  if (!data) return <div className="text-muted">Loading…</div>
  if (data.empty) return (
    <div>
      <div className="page-header"><h1 className="page-title">Analyze</h1></div>
      <div className="alert alert-info">No applications logged yet.</div>
    </div>
  )

  const byStatus  = objToArr(data.by_status)
  const byType    = objToArr(data.by_job_type)
  const bySource  = objToArr(data.by_source)
  const byCompany = objToArr(data.by_company).sort((a, b) => b.value - a.value)
  const remoteData = [
    { name: 'Remote',  value: data.remote_count },
    { name: 'Hybrid',  value: data.hybrid_count },
    { name: 'On-site', value: data.onsite_count },
  ]

  const total         = data.total
  const interviewing  = data.by_status?.interviewing || 0
  const offers        = data.by_status?.offer || 0
  const flexiblePct   = total ? Math.round((data.remote_count + data.hybrid_count) / total * 100) : 0
  const interviewRate = total ? (interviewing / total * 100).toFixed(1) : 0
  const offerRate     = total ? (offers / total * 100).toFixed(1) : 0

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Analyze</h1>
        <p className="page-subtitle">
          Funnel: {total} applied → {interviewing} interviewing ({interviewRate}%) → {offers} offer(s) ({offerRate}%)
        </p>
      </div>

      <div className="metrics-row metrics-row-4">
        <MetricCard label="Total Applied"  value={total}          color="#3b82f6" />
        <MetricCard label="Interviewing"   value={interviewing}   color="#f59e0b" />
        <MetricCard label="Offers"         value={offers}         color="#22c55e" />
        <MetricCard label="Remote/Hybrid %"  value={`${flexiblePct}%`} color="#a855f7" />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">By Job Type</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byType} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" name="Count" radius={[4,4,0,0]}>
                {byType.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-title">By Status</div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} label>
                {byStatus.map((entry, i) => (
                  <Cell key={i} fill={STATUS_COLORS[entry.name] || PALETTE[i]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">Top Companies</div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byCompany} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 90 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
              <Tooltip />
              <Bar dataKey="value" name="Count" fill="#3b82f6" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-title">By Job Source</div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={bySource} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" name="Count" fill="#22c55e" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {data.weekly?.length > 0 && (
        <>
          <hr className="divider" />
          <div className="card">
            <div className="card-title">Weekly Application Rate</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Applications submitted per week — each point is the Sunday ending that week
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.weekly} margin={{ top: 5, right: 20, bottom: 35, left: 0 }}>
                <defs>
                  <linearGradient id="rateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={(v) => [v, 'Applications']} />
                <ReferenceLine
                  y={15}
                  stroke="#22c55e"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  label={{ value: 'Goal: 15/wk', position: 'insideTopRight', fontSize: 11, fill: '#22c55e' }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Applications"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#rateGrad)"
                  dot={{ r: 4, fill: '#3b82f6' }}
                  activeDot={{ r: 6 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-title">Weekly Applications</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.weekly} margin={{ top: 5, right: 20, bottom: 30, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Applications" fill="#3b82f6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="card-title">Cumulative Applications</div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.weekly} margin={{ top: 5, right: 20, bottom: 30, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="cumulative" name="Total" stroke="#3b82f6" dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {data.salary && (
        <>
          <hr className="divider" />
          <div className="card">
            <div className="card-title">Salary Distribution (midpoint)</div>
            <SalaryBins data={data.salary.data} />
            <div className="metrics-row metrics-row-3" style={{ marginTop: '1rem' }}>
              <MetricCard label="Median Salary" value={data.salary.median ? `$${Math.round(data.salary.median).toLocaleString()}` : '—'} />
              <MetricCard label="Min (low end)"  value={data.salary.min  ? `$${Math.round(data.salary.min).toLocaleString()}`  : '—'} />
              <MetricCard label="Max (high end)" value={data.salary.max  ? `$${Math.round(data.salary.max).toLocaleString()}`  : '—'} />
            </div>
          </div>
        </>
      )}

      <hr className="divider" />
      <div className="card" style={{ maxWidth: 420 }}>
        <div className="card-title">Work Arrangement</div>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={remoteData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} label>
              <Cell fill="#3b82f6" />
              <Cell fill="#22c55e" />
              <Cell fill="#94a3b8" />
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
