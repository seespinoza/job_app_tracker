// Little pixel-art Premier Ball shown next to a company name when that company
// already appears in your tracker (job_applications). Handy cue that you probably
// already have a login / account there and don't need to make a new one.

// Loose normalization so "Acme, Inc." and "acme" collapse to the same key. Good
// enough for a personal tracker — favors catching matches over being strict.
export function normalizeCompany(name) {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// 16x16 sprite. '.' = transparent, K = outline, W = white shell,
// G = shaded side, R = the Premier Ball's red band + button ring.
const PIXELS = [
  '......KKKK......',
  '....KKWWWWKK....',
  '...KWWWWWWWGK...',
  '..KWWWWWWWWGGK..',
  '..KWWWWWWWWGGK..',
  '.KWWWWWWWWWGGGK.',
  '.KRRWWWRRWWGRRK.',
  '.KRRRRRWWRRRRRK.',
  '.KRRRRRWWRRRRRK.',
  '.KWWWWWRRWGGGGK.',
  '.KWWWWWWWGGGGGK.',
  '..KWWWWWGGGGGK..',
  '..KWWWWGGGGGGK..',
  '...KWWGGGGGGK...',
  '....KKWGGGKK....',
  '......KKKK......',
]

const COLORS = { K: '#181818', W: '#ffffff', G: '#9aa0a6', R: '#e05a52' }

export default function AppliedBadge({ company, count = 1 }) {
  const who = company || 'this company'
  const label = count > 1
    ? `Already in your tracker — you've applied to ${who} ${count} times. Reuse your existing account.`
    : `Already in your tracker — you've applied to ${who} before. Reuse your existing account.`

  return (
    <span
      title={label}
      aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, cursor: 'help' }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        role="img"
        aria-hidden="true"
        shapeRendering="crispEdges"
        style={{ display: 'block' }}
      >
        {PIXELS.flatMap((row, y) =>
          row.split('').map((ch, x) =>
            ch === '.' ? null : (
              <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={COLORS[ch]} />
            )
          )
        )}
      </svg>
    </span>
  )
}
