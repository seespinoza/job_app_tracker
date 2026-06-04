export default function MetricCard({ label, value, color }) {
  return (
    <div className="metric-card" style={color ? { borderTop: `3px solid ${color}` } : {}}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value ?? '—'}</div>
    </div>
  )
}
