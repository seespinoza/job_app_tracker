import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

// ── Block parsing ─────────────────────────────────────────────────────────────

function parseBlocks(content) {
  if (!content) return []
  const lines = content.split('\n')
  const blocks = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const start = i
      i++
      while (i < lines.length && !lines[i].startsWith('```')) i++
      if (i < lines.length) i++
      blocks.push({ key: key++, type: 'code', raw: lines.slice(start, i).join('\n') })
      continue
    }

    if (line.trim() === '') {
      let count = 0
      while (i < lines.length && lines[i].trim() === '') { count++; i++ }
      blocks.push({ key: key++, type: 'blank', raw: '\n'.repeat(count - 1) })
      continue
    }

    if (/^#{1,6} /.test(line)) {
      const level = line.match(/^(#+)/)[1].length
      blocks.push({ key: key++, type: 'heading', level, raw: line })
      i++
      continue
    }

    const start = i
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !/^#{1,6} /.test(lines[i])
    ) i++
    blocks.push({ key: key++, type: 'paragraph', raw: lines.slice(start, i).join('\n') })
  }

  return blocks
}

function blocksToContent(blocks) {
  return blocks.map(b => b.raw).join('\n')
}

function computeHiddenBlocks(blocks, collapsedSet) {
  const hidden = new Set()
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'heading' && collapsedSet.has(i)) {
      const level = blocks[i].level
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[j].type === 'heading' && blocks[j].level <= level) break
        hidden.add(j)
      }
    }
  }
  return hidden
}

// ── Auto-pair ─────────────────────────────────────────────────────────────────
// ( [ ` always pair; * only when text is selected (avoids breaking list syntax)

const ALWAYS_PAIR = { '(': ')', '[': ']', '`': '`' }
const SELECTION_PAIR = { '*': '*' }

function applyAutoPair(e, value, setValue) {
  const ta = e.target
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const selected = value.slice(start, end)
  const pairs = selected.length > 0 ? { ...ALWAYS_PAIR, ...SELECTION_PAIR } : ALWAYS_PAIR
  if (!(e.key in pairs)) return false

  e.preventDefault()
  const open = e.key
  const close = pairs[open]
  const newVal = value.slice(0, start) + open + selected + close + value.slice(end)
  setValue(newVal)
  // cursor: inside pair when no selection; after closing char when wrapping
  const newCursor = selected.length > 0 ? start + 1 + selected.length + 1 : start + 1
  setTimeout(() => { if (ta) { ta.selectionStart = ta.selectionEnd = newCursor } }, 0)
  return true
}

// ── Markdown component overrides ──────────────────────────────────────────────

const MD = {
  p: ({ children }) => <p style={{ margin: 0, lineHeight: 1.65 }}>{children}</p>,
  ul: ({ children }) => <ul style={{ paddingLeft: '1.5rem', margin: 0 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft: '1.5rem', margin: 0 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote style={{ borderLeft: '3px solid var(--border)', paddingLeft: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />,
  code: ({ inline, children }) => inline
    ? <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.85em', color: '#7c3aed' }}>{children}</code>
    : <code>{children}</code>,
  table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem', margin: '2px 0' }}>{children}</table>,
  thead: ({ children }) => <thead>{children}</thead>,
  th: ({ children }) => <th style={{ border: '1px solid var(--border)', padding: '5px 10px', background: 'var(--bg)', fontWeight: 600, textAlign: 'left', color: 'var(--text)' }}>{children}</th>,
  td: ({ children }) => <td style={{ border: '1px solid var(--border)', padding: '5px 10px', color: 'var(--text)' }}>{children}</td>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  h1: ({ children }) => <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{children}</h4>,
  h5: ({ children }) => <h5 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{children}</h5>,
  h6: ({ children }) => <h6 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{children}</h6>,
}

// ── Textarea auto-resize ──────────────────────────────────────────────────────

function autoResize(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.max(el.scrollHeight, 36) + 'px'
}

// ── CodeBlockView ─────────────────────────────────────────────────────────────

function CodeBlockView({ raw, onEdit }) {
  const [copied, setCopied] = useState(false)
  const lines = raw.split('\n')
  const lang = (lines[0] || '').replace(/^`+/, '').trim()
  const lastLine = lines[lines.length - 1]
  const codeLines = lines.slice(1, lastLine.startsWith('```') ? lines.length - 1 : lines.length)
  const code = codeLines.join('\n')

  function handleCopy(e) {
    e.stopPropagation()
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div onClick={onEdit} style={{ cursor: 'text', position: 'relative', margin: '2px 0', borderRadius: 6, overflow: 'hidden' }}>
      <div
        style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 2 }}
        onClick={e => e.stopPropagation()}
      >
        {lang && (
          <span style={{ fontSize: '0.65rem', color: '#94a3b8', padding: '2px 7px', background: 'rgba(255,255,255,0.06)', borderRadius: 4, fontFamily: 'monospace' }}>
            {lang}
          </span>
        )}
        <button
          onClick={handleCopy}
          style={{
            padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer', borderRadius: 4,
            background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.08)',
            color: copied ? '#86efac' : '#94a3b8',
            border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'inherit',
          }}
        >{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <pre style={{
        background: '#1e293b', color: '#e2e8f0', padding: '0.75rem 1rem',
        paddingTop: '2.25rem', margin: 0, overflow: 'auto',
        fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.6, borderRadius: 6,
      }}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

// ── BlockView (rendered, non-editing) ─────────────────────────────────────────

function BlockView({ block, blockIdx, collapsed, onActivate, onToggleCollapse, onContextMenu }) {
  const hdSizes = { 1: '1.5rem', 2: '1.25rem', 3: '1.1rem', 4: '1rem', 5: '0.95rem', 6: '0.9rem' }

  if (block.type === 'blank') {
    return <div style={{ height: '0.6rem' }} onContextMenu={e => onContextMenu(e, blockIdx)} />
  }

  if (block.type === 'code') {
    return (
      <div onContextMenu={e => onContextMenu(e, blockIdx)}>
        <CodeBlockView raw={block.raw} onEdit={() => onActivate(blockIdx)} />
      </div>
    )
  }

  if (block.type === 'heading') {
    const text = block.raw.replace(/^#+\s+/, '')
    const Tag = `h${block.level}`
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'text', padding: '1px 0' }}
        onClick={() => onActivate(blockIdx)}
        onContextMenu={e => onContextMenu(e, blockIdx)}
      >
        <button
          onClick={e => { e.stopPropagation(); onToggleCollapse(blockIdx) }}
          title={collapsed ? 'Expand section' : 'Collapse section'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
            fontSize: '0.6rem', padding: '0 3px', flexShrink: 0, lineHeight: 1,
          }}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <Tag style={{ margin: 0, fontSize: hdSizes[block.level] || '1rem', fontWeight: 700, flex: 1, lineHeight: 1.3, color: 'var(--text)' }}>
          {text}
        </Tag>
      </div>
    )
  }

  return (
    <div
      style={{ cursor: 'text', lineHeight: 1.65, fontSize: '0.95rem', padding: '1px 0', color: 'var(--text)' }}
      onClick={() => onActivate(blockIdx)}
      onContextMenu={e => onContextMenu(e, blockIdx)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
        {block.raw}
      </ReactMarkdown>
    </div>
  )
}

// ── NoteItem (sidebar) ────────────────────────────────────────────────────────

function NoteItem({ note, isActive, onClick, onDelete }) {
  const [hovered, setHovered] = useState(false)

  function fmtDate(iso) {
    if (!iso) return ''
    const d = new Date(iso.replace(' ', 'T') + 'Z')
    const now = new Date()
    const diffDays = Math.floor((now - d) / 86400000)
    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '0.45rem 0.6rem',
        paddingLeft: isActive ? 'calc(0.6rem - 3px)' : '0.6rem',
        borderRadius: 6, cursor: 'pointer',
        background: hovered ? 'rgba(128,128,128,0.08)' : 'transparent',
        borderLeft: isActive ? '3px solid var(--blue)' : '3px solid transparent',
        marginBottom: 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.8rem', fontWeight: isActive ? 600 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: 'var(--text)',
        }}>
          {note.title || 'Untitled'}
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>
          {fmtDate(note.updated_at)}
        </div>
      </div>
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete note"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.75rem', flexShrink: 0, lineHeight: 1 }}
        >✕</button>
      )}
    </div>
  )
}

// ── Table template ────────────────────────────────────────────────────────────

const TABLE_TEMPLATE = `| Column 1 | Column 2 | Column 3 |
| --- | --- | --- |
| Cell | Cell | Cell |`

// ── Main Notebook page ────────────────────────────────────────────────────────

export default function Notebook() {
  const [notes, setNotes] = useState([])
  const [activeNoteId, setActiveNoteId] = useState(null)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')

  const [activeBlockIdx, setActiveBlockIdx] = useState(null)
  const [activeBlockRaw, setActiveBlockRaw] = useState('')

  const [collapsedHeadings, setCollapsedHeadings] = useState(new Set())
  const [saveStatus, setSaveStatus] = useState('saved')
  const [contextMenu, setContextMenu] = useState(null)

  const [newBlockMode, setNewBlockMode] = useState(false)
  const [newBlockRaw, setNewBlockRaw] = useState('')

  // Raw source mode — single textarea for the whole note; enables multi-line selection
  const [rawEditMode, setRawEditMode] = useState(false)

  const activeTextareaRef = useRef(null)
  const newBlockRef = useRef(null)
  const rawEditRef = useRef(null)
  const saveTimerRef = useRef(null)

  // ── Notes list ────────────────────────────────────────────────────────────────

  const loadNotes = useCallback(async () => {
    try {
      const data = await api.notes()
      setNotes(data)
      return data
    } catch (e) {
      console.error(e)
      return []
    }
  }, [])

  useEffect(() => { loadNotes() }, [loadNotes])

  // ── Load note content ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeNoteId) return
    api.getNote(activeNoteId).then(note => {
      setNoteTitle(note.title)
      setNoteContent(note.content || '')
      setActiveBlockIdx(null)
      setActiveBlockRaw('')
      setNewBlockMode(false)
      setNewBlockRaw('')
      setCollapsedHeadings(new Set())
      setSaveStatus('saved')
    }).catch(console.error)
  }, [activeNoteId])

  // ── Auto-save ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeNoteId || saveStatus === 'saved') return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await api.updateNote(activeNoteId, { title: noteTitle, content: noteContent })
        setSaveStatus('saved')
        loadNotes()
      } catch {
        setSaveStatus('unsaved')
      }
    }, 1500)
    return () => clearTimeout(saveTimerRef.current)
  }, [noteContent, noteTitle, activeNoteId, saveStatus, loadNotes])

  // ── Dismiss context menu on outside click ─────────────────────────────────────

  useEffect(() => {
    if (!contextMenu) return
    function handler() { setContextMenu(null) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  // ── Blocks (derived from noteContent) ─────────────────────────────────────────

  const blocks = useMemo(() => parseBlocks(noteContent), [noteContent])
  const hiddenBlocks = useMemo(() => computeHiddenBlocks(blocks, collapsedHeadings), [blocks, collapsedHeadings])

  // ── Block editing ─────────────────────────────────────────────────────────────

  function activateBlock(idx) {
    if (activeBlockIdx !== null && activeBlockIdx !== idx) commitActiveBlock()
    const block = blocks[idx]
    if (!block || block.type === 'blank') return
    setActiveBlockIdx(idx)
    setActiveBlockRaw(block.raw)
  }

  function commitActiveBlock() {
    if (activeBlockIdx === null) return
    const newBlocks = blocks.map((b, i) => i === activeBlockIdx ? { ...b, raw: activeBlockRaw } : b)
    const newContent = blocksToContent(newBlocks)
    if (newContent !== noteContent) {
      setNoteContent(newContent)
      setSaveStatus('unsaved')
    }
    setActiveBlockIdx(null)
    setActiveBlockRaw('')
  }

  function commitNewBlock(raw = newBlockRaw) {
    if (raw.trim()) {
      const sep = noteContent && !noteContent.endsWith('\n\n') ? '\n\n' : ''
      setNoteContent(c => c + sep + raw)
      setSaveStatus('unsaved')
    }
    setNewBlockMode(false)
    setNewBlockRaw('')
  }

  function toggleCollapse(idx) {
    setCollapsedHeadings(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  useEffect(() => {
    if (activeBlockIdx !== null && activeTextareaRef.current) {
      const ta = activeTextareaRef.current
      ta.focus()
      autoResize(ta)
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  }, [activeBlockIdx])

  useEffect(() => {
    if (newBlockMode && newBlockRef.current) newBlockRef.current.focus()
  }, [newBlockMode])

  useEffect(() => {
    if (rawEditMode && rawEditRef.current) {
      rawEditRef.current.focus()
    }
  }, [rawEditMode])

  // ── Context menu ─────────────────────────────────────────────────────────────

  function handleContextMenu(e, blockIdx) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, blockIdx })
  }

  function insertTable() {
    if (activeBlockIdx !== null && activeTextareaRef.current) {
      const ta = activeTextareaRef.current
      const start = ta.selectionStart
      const before = activeBlockRaw.slice(0, start)
      const after = activeBlockRaw.slice(ta.selectionEnd)
      const sep = before && !before.endsWith('\n\n') ? '\n\n' : ''
      const sepAfter = after && !after.startsWith('\n\n') ? '\n\n' : ''
      setActiveBlockRaw(before + sep + TABLE_TEMPLATE + sepAfter + after)
      setTimeout(() => { if (activeTextareaRef.current) autoResize(activeTextareaRef.current) }, 0)
    } else {
      const sep = noteContent && !noteContent.endsWith('\n\n') ? '\n\n' : ''
      setNoteContent(c => c + sep + TABLE_TEMPLATE)
      setSaveStatus('unsaved')
    }
    setContextMenu(null)
  }

  // ── Note CRUD ─────────────────────────────────────────────────────────────────

  async function createNote() {
    const { id } = await api.createNote('Untitled')
    await loadNotes()
    setActiveNoteId(id)
  }

  async function deleteNote(id) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    await api.deleteNote(id)
    if (activeNoteId === id) {
      setActiveNoteId(null)
      setNoteTitle('')
      setNoteContent('')
      setActiveBlockIdx(null)
    }
    loadNotes()
  }

  // ── Shared block textarea keyDown ─────────────────────────────────────────────

  function blockKeyDown(e, value, setValue, block) {
    if (e.key === 'Escape') { e.preventDefault(); commitActiveBlock(); return }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.target
      const s = ta.selectionStart
      const newVal = value.slice(0, s) + '  ' + value.slice(ta.selectionEnd)
      setValue(newVal)
      setTimeout(() => { if (ta) { ta.selectionStart = ta.selectionEnd = s + 2 } }, 0)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && block?.type !== 'code') {
      e.preventDefault()
      const committed = blocks.map((b, i) =>
        i === activeBlockIdx ? { ...b, raw: value } : b
      )
      const newContent = blocksToContent(committed)
      let nextIdx = activeBlockIdx + 1
      while (nextIdx < committed.length && committed[nextIdx].type === 'blank') nextIdx++
      if (nextIdx < committed.length) {
        setNoteContent(newContent)
        setSaveStatus('unsaved')
        setActiveBlockIdx(nextIdx)
        setActiveBlockRaw(committed[nextIdx].raw)
      } else {
        setNoteContent(newContent)
        setSaveStatus('unsaved')
        setActiveBlockIdx(null)
        setActiveBlockRaw('')
        setNewBlockMode(true)
        setNewBlockRaw('')
      }
      return
    }
    applyAutoPair(e, value, setValue)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const wordCount = noteContent.trim() ? noteContent.trim().split(/\s+/).length : 0

  const taStyle = {
    width: '100%', border: '1px solid var(--blue)', borderRadius: 4,
    padding: '0.4rem 0.5rem', resize: 'none', overflow: 'hidden',
    fontSize: '0.95rem', lineHeight: 1.6,
    background: 'var(--bg)', color: 'var(--text)',
    minHeight: 36, fontFamily: 'inherit',
  }

  return (
    <div
      style={{ display: 'flex', height: 'calc(100vh - 4rem)', margin: '-2rem', overflow: 'hidden', background: 'var(--surface)' }}
      onKeyDown={e => {
        if (e.key === 'Escape' && activeBlockIdx !== null) commitActiveBlock()
      }}
    >
      {/* Notes sidebar */}
      <div style={{
        width: 210, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--bg)',
      }}>
        <div style={{ padding: '0.875rem', borderBottom: '1px solid var(--border)' }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem' }}
            onClick={createNote}
          >+ New Note</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
          {notes.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0.5rem', textAlign: 'center' }}>
              No notes yet.
            </p>
          )}
          {notes.map(note => (
            <NoteItem
              key={note.id}
              note={note}
              isActive={note.id === activeNoteId}
              onClick={() => { commitActiveBlock(); setActiveNoteId(note.id) }}
              onDelete={() => deleteNote(note.id)}
            />
          ))}
        </div>
      </div>

      {/* Editor */}
      {activeNoteId ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Title bar */}
          <div style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
            <input
              type="text"
              value={noteTitle}
              onChange={e => { setNoteTitle(e.target.value); setSaveStatus('unsaved') }}
              placeholder="Untitled"
              style={{
                flex: 1, fontSize: '1.1rem', fontWeight: 700, border: 'none',
                outline: 'none', background: 'transparent', color: 'var(--text)',
                padding: 0, fontFamily: 'inherit',
              }}
            />
            {/* Source / Preview toggle — Source mode supports multi-line select/delete */}
            <button
              onClick={() => {
                if (!rawEditMode) commitActiveBlock()
                setRawEditMode(r => !r)
              }}
              title={rawEditMode ? 'Switch to rendered preview' : 'Switch to raw source (supports multi-line select & delete)'}
              style={{
                padding: '0.2rem 0.6rem', fontSize: '0.7rem', cursor: 'pointer', borderRadius: 4,
                background: rawEditMode ? 'var(--blue)' : 'transparent',
                color: rawEditMode ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border)', fontFamily: 'inherit', flexShrink: 0,
                transition: 'all 0.15s',
              }}
            >
              {rawEditMode ? '◉ Preview' : '⌨ Source'}
            </button>
            <span style={{
              fontSize: '0.7rem', flexShrink: 0,
              color: saveStatus === 'saved' ? 'var(--green)' : saveStatus === 'saving' ? 'var(--orange)' : 'var(--text-muted)',
            }}>
              {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? '⟳ Saving…' : '● Unsaved'}
            </span>
          </div>

          {/* Raw source mode — full textarea, supports normal multi-line selection */}
          {rawEditMode ? (
            <textarea
              ref={rawEditRef}
              value={noteContent}
              onChange={e => { setNoteContent(e.target.value); setSaveStatus('unsaved') }}
              onKeyDown={e => {
                if (e.key === 'Escape') { setRawEditMode(false); return }
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const ta = e.target
                  const s = ta.selectionStart
                  const selEnd = ta.selectionEnd
                  const newVal = noteContent.slice(0, s) + '  ' + noteContent.slice(selEnd)
                  setNoteContent(newVal)
                  setSaveStatus('unsaved')
                  setTimeout(() => { if (rawEditRef.current) { rawEditRef.current.selectionStart = rawEditRef.current.selectionEnd = s + 2 } }, 0)
                  return
                }
                if (applyAutoPair(e, noteContent, v => { setNoteContent(v); setSaveStatus('unsaved') })) return
              }}
              style={{
                flex: 1, padding: '1.5rem', resize: 'none', border: 'none',
                outline: 'none', fontFamily: 'monospace', fontSize: '0.85rem',
                lineHeight: 1.7, background: 'var(--surface)', color: 'var(--text)',
                overflowY: 'auto',
              }}
            />
          ) : (
            /* Block editor */
            <div
              style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', paddingBottom: '3rem' }}
              onClick={e => { if (e.target === e.currentTarget) commitActiveBlock() }}
            >
              {blocks.length === 0 && (
                <div
                  style={{ color: 'var(--text-muted)', fontSize: '0.9rem', cursor: 'text', padding: '2px 0' }}
                  onClick={() => {
                    setNoteContent('# ')
                    setSaveStatus('unsaved')
                    setTimeout(() => setActiveBlockIdx(0), 50)
                  }}
                >
                  Start writing… (click or type a heading with #)
                </div>
              )}

              {blocks.map((block, idx) => {
                if (hiddenBlocks.has(idx)) return null
                const isActive = activeBlockIdx === idx
                const marginBottom = block.type === 'heading' ? '0.15rem'
                  : block.type === 'blank' ? 0 : '0.1rem'

                return (
                  <div key={block.key} style={{ marginBottom }}>
                    {isActive ? (
                      <textarea
                        ref={activeTextareaRef}
                        value={activeBlockRaw}
                        onChange={e => { setActiveBlockRaw(e.target.value); autoResize(e.target) }}
                        onBlur={commitActiveBlock}
                        onKeyDown={e => blockKeyDown(e, activeBlockRaw, setActiveBlockRaw, block)}
                        onContextMenu={e => handleContextMenu(e, idx)}
                        rows={1}
                        style={{
                          ...taStyle,
                          fontFamily: block.type === 'code' ? 'monospace' : 'inherit',
                          fontSize: block.type === 'code' ? '0.82rem'
                            : block.type === 'heading' ? ({ 1: '1.4rem', 2: '1.2rem', 3: '1.05rem' })[block.level] || '0.95rem'
                            : '0.95rem',
                          fontWeight: block.type === 'heading' ? 700 : 400,
                        }}
                      />
                    ) : (
                      <BlockView
                        block={block}
                        blockIdx={idx}
                        collapsed={collapsedHeadings.has(idx)}
                        onActivate={activateBlock}
                        onToggleCollapse={toggleCollapse}
                        onContextMenu={handleContextMenu}
                      />
                    )}
                  </div>
                )
              })}

              {newBlockMode && (
                <textarea
                  ref={newBlockRef}
                  value={newBlockRaw}
                  onChange={e => { setNewBlockRaw(e.target.value); autoResize(e.target) }}
                  onBlur={() => commitNewBlock()}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); commitNewBlock(); return }
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const s = e.target.selectionStart
                      const next = newBlockRaw.slice(0, s) + '  ' + newBlockRaw.slice(e.target.selectionEnd)
                      setNewBlockRaw(next)
                      setTimeout(() => { if (newBlockRef.current) { newBlockRef.current.selectionStart = newBlockRef.current.selectionEnd = s + 2 } }, 0)
                      return
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (newBlockRaw.trim()) {
                        const sep = noteContent && !noteContent.endsWith('\n\n') ? '\n\n' : ''
                        setNoteContent(c => c + sep + newBlockRaw)
                        setSaveStatus('unsaved')
                      }
                      setNewBlockRaw('')
                      setTimeout(() => { if (newBlockRef.current) { newBlockRef.current.focus(); autoResize(newBlockRef.current) } }, 0)
                      return
                    }
                    applyAutoPair(e, newBlockRaw, setNewBlockRaw)
                  }}
                  onContextMenu={e => handleContextMenu(e, blocks.length)}
                  rows={1}
                  style={taStyle}
                />
              )}

              <div
                style={{ minHeight: 60, cursor: 'text' }}
                onClick={() => {
                  commitActiveBlock()
                  if (!newBlockMode) { setNewBlockMode(true); setNewBlockRaw('') }
                }}
              />
            </div>
          )}

          {/* Footer */}
          <div style={{
            padding: '0.4rem 1.5rem', borderTop: '1px solid var(--border)', flexShrink: 0,
            display: 'flex', gap: '1.25rem', fontSize: '0.68rem', color: 'var(--text-muted)',
          }}>
            <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
            <span>{noteContent.length} chars</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.65rem' }}>
              {rawEditMode
                ? 'Esc → preview · Tab → indent · auto-pairs: ( [ ` wrap-*'
                : '⌨ Source → multi-line select · Right-click → table · Esc → close block'}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📓</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '0.4rem' }}>No note selected</div>
            <div style={{ fontSize: '0.8rem' }}>Create a note or select one from the sidebar</div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999,
            minWidth: 190, padding: '0.25rem',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          {[
            { label: 'Insert Markdown Table', action: insertTable },
            {
              label: 'Insert Code Block',
              action: () => {
                const template = '```python\n\n```'
                if (activeBlockIdx !== null) {
                  const sep = activeBlockRaw ? '\n\n' : ''
                  setActiveBlockRaw(r => r + sep + template)
                } else {
                  const sep = noteContent && !noteContent.endsWith('\n\n') ? '\n\n' : ''
                  setNoteContent(c => c + sep + template)
                  setSaveStatus('unsaved')
                }
                setContextMenu(null)
              },
            },
          ].map(({ label, action }) => (
            <button
              key={label}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.45rem 0.75rem', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: '0.8rem', borderRadius: 4, color: 'var(--text)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              onClick={action}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
