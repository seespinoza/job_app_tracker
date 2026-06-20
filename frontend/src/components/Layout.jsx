import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'

const nav = [
  { to: '/',            label: 'Home',            icon: '◈' },
  { to: '/new',         label: 'New Application', icon: '+' },
  { to: '/in-progress', label: 'Dashboard',       icon: '◷' },
  { to: '/todo',        label: 'To-Do',           icon: '☐' },
  { to: '/analyze',     label: 'Analyze',         icon: '◎' },
  { to: '/scraper-log', label: 'Scraper Log',     icon: '⟳' },
  { to: '/notebook',    label: 'Notebook',        icon: '✎' },
  { to: '/resumes',     label: 'Resumes',         icon: '⊞' },
]

const THEMES = [
  { key: 'default',      label: 'Default',       icon: '◑' },
  { key: 'gruvbox-dark', label: 'Gruvbox Dark',  icon: '●' },
  { key: 'gruvbox-light',label: 'Gruvbox Light', icon: '○' },
]

export default function Layout({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('app-theme') || 'gruvbox-light')

  useEffect(() => {
    if (theme === 'default') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    localStorage.setItem('app-theme', theme)
  }, [theme])

  function cycleTheme() {
    setTheme(t => {
      const idx = THEMES.findIndex(x => x.key === t)
      return THEMES[(idx + 1) % THEMES.length].key
    })
  }

  const current = THEMES.find(x => x.key === theme) || THEMES[0]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">
          Job <span>Tracker</span>
        </div>
        <nav className="nav-section">
          <div className="nav-section-label">Navigation</div>
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', padding: '1rem 0.75rem', borderTop: '1px solid var(--sidebar-border)' }}>
          <button
            onClick={cycleTheme}
            title="Cycle color theme"
            style={{
              width: '100%', padding: '0.4rem 0.75rem', borderRadius: 6,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--sidebar-text)', cursor: 'pointer', fontSize: '0.75rem',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.5rem',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
          >
            <span style={{ fontSize: '0.9rem' }}>{current.icon}</span>
            <span>{current.label}</span>
          </button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  )
}
