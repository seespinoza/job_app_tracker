import { useEffect, useState } from 'react'
import { api } from '../api'

const TODAY = new Date().toISOString().split('T')[0]

function emptyForm() {
  return {
    contact_name: '', platform: '', direction: 'outbound',
    comm_date: TODAY, note: '', follow_up_date: '',
  }
}

export default function CommunicationsPanel({ applicationId }) {
  const [config, setConfig] = useState(null)
  const [entries, setEntries] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function loadEntries() {
    api.communications(applicationId).then(setEntries).catch(err => setError(err.message))
  }

  useEffect(() => {
    api.config().then(setConfig).catch(err => setError(err.message))
    loadEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId])

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleAdd() {
    setSaving(true)
    setError(null)
    try {
      await api.createCommunication(applicationId, form)
      setForm(emptyForm())
      setAdding(false)
      loadEntries()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(commId) {
    if (!window.confirm('Delete this communication entry?')) return
    try {
      await api.deleteCommunication(commId)
      loadEntries()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="form-group full">
      <label>Communications</label>

      {error && <div className="alert alert-danger" style={{ marginBottom: '0.5rem' }}>{error}</div>}

      {entries === null ? (
        <div className="text-muted">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-muted" style={{ fontSize: '0.85rem' }}>No communications logged yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {entries.map(c => (
            <div key={c.id} style={{
              border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.75rem',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  {c.contact_name || 'Unknown contact'}
                  {c.platform && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {c.platform}</span>}
                  {c.direction && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {c.direction}</span>}
                  {c.comm_date && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {c.comm_date}</span>}
                </div>
                {c.note && <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', whiteSpace: 'pre-wrap' }}>{c.note}</div>}
                {c.follow_up_date && (
                  <span style={{
                    display: 'inline-block', marginTop: '0.35rem', fontSize: '0.7rem',
                    background: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: 9999, fontWeight: 600,
                  }}>
                    Follow up: {c.follow_up_date}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleDelete(c.id)}
                style={{ padding: '0.2rem 0.5rem', flexShrink: 0 }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {!adding ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setAdding(true)}
          style={{ fontSize: '0.8rem', border: '1px dashed var(--border)' }}
        >+ Add Communication</button>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.75rem' }}>
          <div className="form-grid-2" style={{ gap: '0.6rem', marginBottom: '0.6rem' }}>
            <div className="form-group">
              <label>Contact Name</label>
              <input type="text" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Platform</label>
              <select value={form.platform} onChange={e => set('platform', e.target.value)}>
                <option value="">—</option>
                {config?.comm_platforms?.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Direction</label>
              <select value={form.direction} onChange={e => set('direction', e.target.value)}>
                {config?.comm_directions?.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={form.comm_date} onChange={e => set('comm_date', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Follow Up By (optional)</label>
              <input type="date" value={form.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: '0.6rem' }}>
            <label>Note</label>
            <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={2} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setAdding(false); setForm(emptyForm()) }}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
