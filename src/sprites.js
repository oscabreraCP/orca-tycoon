// Pixel sprites for a top-down office, drawn through a painter p(x, y, w, h, color) whose origin
// is the sprite's top-left corner. One seat is SEAT_W x SEAT_H art pixels: a person behind a
// desk, their monitor facing the viewer so its screen shows what they are doing.

export const SEAT_W = 20
export const SEAT_H = 22

const SKIN = ['#f3cfae', '#e3b07a', '#c68642', '#8d5524', '#5c3a21', '#ffdcb5']
const HAIR = ['#2b1d14', '#5a3825', '#d8a73a', '#b3492a', '#23202f', '#e6e0d2', '#7b5bb5', '#2f6f8f']
const SHIRT = ['#5b8cff', '#ff7a6b', '#47c98f', '#f2b134', '#a66bff', '#2cc4d4', '#ef6aa8', '#e8e3d6']

export const C = {
  ink: '#1b1822',
  white: '#fbf7ee',
  wood: '#d49a5a',
  woodTop: '#e6b276',
  woodDark: '#9c6534',
  chair: '#4b4a5e',
  chairDark: '#36354a',
  frame: '#2a2833',
  screen: '#121722',
  green: '#4be08f',
  amber: '#f6b23c',
  red: '#ff5468',
  blue: '#73b3ff',
  steam: '#e8e4f2',
  plantPot: '#b4643c',
  plant: '#4f9d5a',
  plantDark: '#3a7a45'
}

export const GLYPHS = {
  '?': ['111', '001', '011', '000', '010'],
  '!': ['010', '010', '010', '000', '010'],
  z: ['111', '001', '010', '100', '111']
}

export const STATE_LABEL = {
  working: 'working',
  monitoring: 'watching background tasks',
  waiting: 'waiting for you',
  blocked: 'blocked',
  done: 'done',
  idle: 'idle'
}

function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pick(list, seed, shift = 0) {
  return list[(hash(seed) >>> shift) % list.length]
}

export function look(seed) {
  return { skin: pick(SKIN, seed), hair: pick(HAIR, seed, 8), shirt: pick(SHIRT, seed, 16) }
}

export function painter(ctx, ox = 0, oy = 0) {
  return (x, y, w, h, color) => {
    ctx.fillStyle = color
    ctx.fillRect(ox + x, oy + y, w, h)
  }
}

export function glyph(p, ch, x, y, color) {
  const rows = GLYPHS[ch]
  if (!rows) return
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) if (row[rx] === '1') p(x + rx, y + ry, 1, 1, color)
  })
}

/** A desk surface `w` wide; seats sit on it at multiples of SEAT_W from x = 2. */
export function desk(p, w) {
  p(0, 13, w, 4, C.woodTop)
  p(0, 17, w, 2, C.wood)
  p(0, 19, w, 1, C.woodDark)
  p(1, 20, 2, 2, C.woodDark)
  p(w - 3, 20, 2, 2, C.woodDark)
}

/** Chair and person, drawn before the desk so the desk hides their lap. */
export function person(p, staff, t, away = false) {
  const { skin, hair, shirt } = look(staff.id || 'x')
  const s = staff.state
  const sleepy = s === 'done' || s === 'idle'
  const bob = s === 'working' ? t % 2 : 0
  const dy = sleepy ? 2 : 0
  // chair back
  p(4, 4, 12, 9, C.chair)
  p(4, 4, 12, 1, C.chairDark)
  if (away) return
  // shoulders and head
  p(5, 9 + dy, 10, 5, shirt)
  p(7, 2 + dy - bob, 6, 6, skin)
  p(7, 1 + dy - bob, 6, 2, hair)
  p(6, 2 + dy - bob, 1, 3, hair)
  p(13, 2 + dy - bob, 1, 3, hair)
  if (sleepy) {
    p(8, 5 + dy, 1, 1, C.ink)
    p(11, 5 + dy, 1, 1, C.ink)
  } else if (t % 30 !== 0) {
    p(8, 4 + dy - bob, 1, 2, C.ink)
    p(11, 4 + dy - bob, 1, 2, C.ink)
  }
}

/** Monitor facing the viewer plus hands and props, drawn after the desk. */
export function workstation(p, staff, t) {
  const s = staff.state
  const { skin } = look(staff.id || 'x')
  // monitor
  p(5, 9, 10, 7, C.frame)
  p(6, 10, 8, 5, C.screen)
  if (s === 'working') {
    const colors = [C.green, C.blue, C.amber]
    for (let line = 0; line < 3; line++) {
      const len = 2 + ((t + line * 5) % 6)
      p(7, 10 + Math.floor(line * 1.5), Math.min(len, 6), 1, colors[(line + (t >> 2)) % 3])
    }
  } else if (s === 'monitoring') {
    p(7, 12, 6, 1, C.chairDark)
    p(7, 12, t % 7, 1, C.green)
    p(7 + ((t >> 1) % 6), 10, 1, 1, C.blue)
  } else if (s === 'waiting') {
    p(6, 10, 8, 5, '#3a2a10')
    if ((t >> 2) % 2) glyph(p, '?', 9, 10, C.amber)
  } else if (s === 'blocked') {
    p(6, 10, 8, 5, (t >> 1) % 2 ? C.red : '#8a2232')
    glyph(p, '!', 9, 10, C.white)
  } else if (s === 'done') {
    p(7 + (t % 6), 10 + ((t >> 3) % 4), 1, 1, '#3c4660')
  }
  // keyboard and hands
  p(6, 16, 8, 1, '#c8c6d4')
  if (s === 'working') {
    p(5 + (t % 2), 15, 2, 1, skin)
    p(13 - (t % 2), 15, 2, 1, skin)
  }
  if (s === 'monitoring') {
    // mug with steam
    p(16, 14, 2, 3, C.white)
    if (t % 6 < 4) p(16 + (t % 2), 12 - ((t >> 1) % 2), 1, 1, C.steam)
  }
  // overhead marks
  if (s === 'done' || s === 'idle') {
    const z = t % 16
    if (z < 12) glyph(p, 'z', 14 + (z >> 2), 2 - (z >> 2), C.white)
  }
}

/** A small subagent figure, 5 x 9, walking between `x0` and `x0 + range`. */
export function intern(p, item, x0, range, t, seed) {
  const { skin, hair, shirt } = look(item.id || 'intern')
  const s = item.state
  const busy = s === 'working'
  const sit = s === 'done' || s === 'idle'
  const phase = (t + seed * 7) % (range * 2 || 1)
  const x = busy ? x0 + (phase < range ? phase : range * 2 - phase) : x0 + Math.floor(range / 2)
  const top = sit ? 2 : busy && t % 2 ? -1 : 0
  p(x, top, 5, 2, hair)
  p(x, top + 2, 5, 2, skin)
  p(x, top + 4, 5, 3, shirt)
  p(x + 4, top + 5, 2, 2, C.white) // clipboard
  if (!sit) {
    const step = busy ? t % 2 : 0
    p(x + (step ? 0 : 1), top + 7, 1, 2, '#30324a')
    p(x + (step ? 4 : 3), top + 7, 1, 2, '#30324a')
  }
  if (s === 'waiting') glyph(p, '?', x + 1, top - 6, C.amber)
  if (s === 'blocked') glyph(p, '!', x + 1, top - 6, C.red)
}

export function plant(p) {
  p(1, 5, 5, 4, C.plantPot)
  p(0, 1, 7, 4, C.plant)
  p(2, 0, 3, 2, C.plantDark)
  p(1, 3, 2, 1, C.plantDark)
}

export function bookshelf(p) {
  p(0, 0, 12, 9, C.woodDark)
  const books = ['#c4453c', '#4f7cff', '#f2b134', '#47c98f', '#a66bff', '#e8e3d6']
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 5; i++) p(1 + i * 2, 1 + row * 4, 1, 3, books[(i + row * 2) % books.length])
  }
}

/** Whiteboard with one sticky note per agent state in the room. */
export function whiteboard(p, w, notes) {
  p(0, 0, w, 7, '#b9bccb')
  p(1, 1, w - 2, 5, '#f4f5fa')
  notes.slice(0, Math.floor((w - 2) / 4)).forEach((color, i) => p(2 + i * 4, 2, 3, 3, color))
}

export function kitchen(p, w) {
  p(0, 4, w, 8, '#9aa0b4')
  p(0, 4, w, 2, '#c3c8d6')
  for (let x = 12; x < w - 14; x += 14) p(x, 7, 1, 5, '#7d8296')
  // sink and fridge
  p(14, 6, 8, 2, '#6f7488')
  p(w - 10, -6, 9, 18, '#e4e6ee')
  p(w - 10, 2, 9, 1, '#b9bccb')
}

export function lounge(p, w) {
  // rug, sofa, coffee table
  p(2, 2, w - 4, 16, '#5d6b8e')
  p(4, 3, w - 8, 14, '#6b7aa0')
  const mid = Math.floor(w / 2)
  p(mid - 10, 5, 20, 5, '#8a3d3d')
  p(mid - 10, 5, 20, 2, '#a44c4c')
  p(mid - 4, 12, 8, 3, C.woodDark)
}

/** Coffee machine, 9 x 14, on its own little cabinet. */
export function coffeeMachine(p, t) {
  p(0, 8, 9, 6, C.woodDark)
  p(1, 0, 7, 8, '#3a3b46')
  p(1, 0, 7, 2, '#55566a')
  p(2, 3, 5, 2, '#1d1e26')
  p(6, 1, 1, 1, t % 8 < 4 ? C.red : '#5a2028')
  p(3, 6, 3, 2, C.white)
  if (t % 6 < 4) p(4 + (t % 2), 4 - ((t >> 1) % 2), 1, 1, C.steam)
}

/** Water dispenser, 7 x 16: a blue bottle on a white stand. */
export function waterCooler(p, t) {
  p(1, 0, 5, 6, '#8fd0f0')
  p(2, 0, 3, 1, '#c4ecfb')
  p(2, 2 + (t % 12 < 6 ? 0 : 1), 1, 1, '#e8f8ff')
  p(0, 6, 7, 10, '#e9ebf2')
  p(0, 6, 7, 1, '#c9ccd8')
  p(2, 9, 1, 2, C.blue)
  p(4, 9, 1, 2, C.red)
}

/** A standing person, 8 x 15, for walking to the coffee corner and lingering there. */
export function walker(p, staff, t, moving, left) {
  const { skin, hair, shirt } = look(staff.id || 'x')
  const bob = moving ? t % 2 : 0
  p(1, 0 - bob, 6, 2, hair)
  p(1, 2 - bob, 6, 4, skin)
  p(0, 2 - bob, 1, 2, hair)
  p(7, 2 - bob, 1, 2, hair)
  if (t % 30 !== 0) {
    p(left ? 2 : 3, 3 - bob, 1, 2, C.ink)
    p(left ? 4 : 5, 3 - bob, 1, 2, C.ink)
  }
  p(1, 6 - bob, 6, 5, shirt)
  p(0, 7 - bob, 1, 3, shirt)
  p(7, 7 - bob, 1, 3, shirt)
  if (!moving) {
    // a mug in hand, steaming
    p(left ? -1 : 7, 8, 2, 2, C.white)
    if (t % 6 < 3) p(left ? -1 : 8, 6 - ((t >> 1) % 2), 1, 1, C.steam)
  }
  const step = moving ? t % 2 : 0
  p(2, 11, 4, 1, '#30324a')
  p(2, 12, 1, 3 - step, '#30324a')
  p(5, 12, 1, 2 + step, '#30324a')
  p(1, 14 - step, 2, 1, C.ink)
  p(5, 13 + step, 2, 1, C.ink)
}

export { SKIN }
