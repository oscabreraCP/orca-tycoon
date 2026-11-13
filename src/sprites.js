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
  thinFrame: '#c9ccd8',
  thinEdge: '#8e92a6',
  thinBox: '#e4e6ee',
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
  '+': ['000', '010', '111', '010', '000'],
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

/**
 * Monitor facing the viewer plus hands and props, drawn after the desk. An agent on a paired
 * Orca server works on a thin client: a pale terminal and a slim box on the desk beside it,
 * whose link light blinks while the far machine is busy.
 */
export function workstation(p, staff, t, away = false, remote = false) {
  const s = staff.state
  const { skin } = look(staff.id || 'x')
  // monitor
  if (remote) {
    p(5, 9, 10, 7, C.thinFrame)
    p(5, 15, 10, 1, C.thinEdge)
    p(2, 10, 2, 6, C.thinBox)
    p(2, 15, 2, 1, C.thinEdge)
    const busy = s === 'working' || s === 'monitoring'
    p(2, 11, 1, 1, busy && (t >> 1) % 2 ? C.blue : C.thinEdge)
  } else {
    p(5, 9, 10, 7, C.frame)
  }
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
  if ((s === 'done' || s === 'idle') && !away) {
    const z = t % 16
    if (z < 12) glyph(p, 'z', 14 + (z >> 2), 2 - (z >> 2), C.white)
  } else if (s === 'waiting' && !away) {
    // beside the head where the z floats, inside the seat so it never paints over the row above
    glyph(p, '?', 15, (t >> 2) % 2, C.amber)
  }
}

const ROLE_COLORS = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#c77dff', '#f3722c']

/** One colour per specialist role, the same across the whole office. */
export function roleColor(role) {
  const name = role || 'specialist'
  let n = 0
  for (let i = 0; i < name.length; i++) n = (n * 31 + name.charCodeAt(i)) >>> 0
  return ROLE_COLORS[n % ROLE_COLORS.length]
}

/** A stool, 7 x 7, pulled up to the end of a desk. */
export function stool(p) {
  p(0, 0, 7, 2, '#b88a5a')
  p(0, 0, 7, 1, '#d4a670')
  p(3, 2, 1, 4, '#6b4a2e')
  p(1, 6, 5, 1, '#6b4a2e')
}

/** A specialist on a stool, seen side-on, leaning in toward the agent's screen on the left. */
export function specialist(p, spec, t) {
  const { skin, hair, shirt } = look(spec.id || 'specialist')
  const lean = spec.state === 'working' && (t >> 2) % 2 ? -1 : 0
  p(1 + lean, 0, 5, 2, hair)
  p(1 + lean, 2, 5, 4, skin)
  p(5 + lean, 1, 1, 3, hair)
  p(2 + lean, 3, 1, 1, C.ink)
  p(1, 6, 6, 5, shirt)
  p(3, 7, 2, 2, roleColor(spec.role))
  p(-1 + lean, 8, 2, 1, skin)
  if (spec.state === 'waiting') glyph(p, '?', 2, -6, C.amber)
  if (spec.state === 'blocked') glyph(p, '!', 2, -6, C.red)
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

/** The lounge: a rug, a long sofa with seats every 9 pixels from x = 6, a coffee table. */
export function lounge(p, w) {
  p(0, 0, w, 26, '#5d6b8e')
  p(2, 1, w - 4, 24, '#6b7aa0')
  // sofa: back, seat cushions, arms
  p(4, 3, w - 8, 6, '#8a3d3d')
  p(4, 3, w - 8, 1, '#a44c4c')
  p(4, 9, w - 8, 4, '#a44c4c')
  for (let x = 13; x < w - 6; x += 9) p(x, 9, 1, 4, '#8a3d3d')
  p(2, 5, 3, 9, '#7a3434')
  p(w - 5, 5, 3, 9, '#7a3434')
  // coffee table with a magazine
  const mid = Math.floor(w / 2)
  p(mid - 8, 17, 16, 4, C.woodDark)
  p(mid - 8, 17, 16, 1, C.wood)
  p(mid - 3, 18, 5, 2, '#e8e3d6')
}

/** An agent on the sofa, 8 x 13: napping (`nap`), with a coffee (`coffee`) or reading (`read`). */
export function lounger(p, staff, t, pose = 'nap') {
  const { skin, hair, shirt } = look(staff.id || 'x')
  const slump = pose === 'nap' ? (t >> 3) % 2 : 0
  p(1, 1 + slump, 6, 2, hair)
  p(1, 3 + slump, 6, 3, skin)
  if (pose === 'nap') {
    p(2, 4 + slump, 1, 1, C.ink)
    p(5, 4 + slump, 1, 1, C.ink)
  } else if (t % 30 !== 0) {
    p(2, 3 + (pose === 'read' ? 1 : 0), 1, 2, C.ink)
    p(5, 3 + (pose === 'read' ? 1 : 0), 1, 2, C.ink)
  }
  p(0, 6, 8, 5, shirt)
  p(1, 11, 2, 2, '#30324a')
  p(5, 11, 2, 2, '#30324a')
  if (pose === 'nap') {
    const z = t % 16
    if (z < 12) glyph(p, 'z', 6 + (z >> 2), -2 - (z >> 2), C.white)
  } else if (pose === 'coffee') {
    p(6, 7, 2, 2, C.white)
    if (t % 8 < 4) p(6 + ((t >> 1) % 2), 5, 1, 1, C.steam)
  } else if (pose === 'read') {
    // an open book; a page turns now and then
    const cover = pick(['#c4453c', '#4f7cff', '#47c98f', '#f2b134'], staff.id || 'x')
    p(1, 7, 6, 3, cover)
    p(2, 7, 4, 2, C.white)
    if (t % 40 < 3) p(4, 6, 2, 2, C.white)
  }
}

/** Foosball table, 28 x 14: green field, rods with little players, the ball moving when in play. */
export function foosball(p, t, playing) {
  p(0, 12, 2, 4, C.woodDark)
  p(26, 12, 2, 4, C.woodDark)
  p(0, 0, 28, 13, C.woodDark)
  p(1, 1, 26, 11, '#3f8f4a')
  p(13, 1, 1, 11, '#cfe8d2')
  p(1, 5, 1, 3, C.white)
  p(26, 5, 1, 3, C.white)
  const rods = [5, 10, 17, 22]
  rods.forEach((x, i) => {
    p(x, -2, 1, 17, '#b9bccb')
    p(x, -3, 1, 1, '#1d1e26')
    p(x, 15, 1, 1, '#1d1e26')
    const shift = playing ? ((t + i * 2) >> 1) % 3 - 1 : 0
    const color = i % 2 ? '#4f7cff' : C.red
    for (const y of [3, 8]) p(x - 1, y + shift, 3, 2, color)
  })
  if (playing) {
    const phase = t % 20
    const bx = 3 + (phase < 10 ? phase : 20 - phase) * 2.2
    p(Math.round(bx), 6 + ((t >> 2) % 2), 1, 1, C.white)
  }
}

/** Calling booth, 13 x 24: a glass box with a little shelf. Draw `boothGlass` over its caller. */
export function booth(p) {
  p(0, 0, 13, 24, '#2a2833')
  p(1, 1, 11, 22, '#3b4660')
  p(1, 12, 11, 1, '#4a5578')
  p(8, 14, 4, 1, C.woodDark)
}

export function boothGlass(p) {
  p(1, 1, 11, 22, 'rgba(170, 210, 235, 0.22)')
  p(2, 2, 1, 8, 'rgba(255, 255, 255, 0.35)')
  p(0, 0, 13, 1, '#55566a')
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
/** `pose`: 'mug' (default), 'phone' (on a call), 'play' (hands on the foosball rods, facing you)
 * or 'playBack' (at the near side of the table, back to you). */
export function walker(p, staff, t, moving, left, badge = null, pose = 'mug') {
  const { skin, hair, shirt } = look(staff.id || 'x')
  const bob = moving ? t % 2 : 0
  p(1, 0 - bob, 6, 2, hair)
  p(1, 2 - bob, 6, 4, pose === 'playBack' ? hair : skin)
  p(0, 2 - bob, 1, 2, hair)
  p(7, 2 - bob, 1, 2, hair)
  if (t % 30 !== 0 && pose !== 'playBack') {
    p(left ? 2 : 3, 3 - bob, 1, 2, C.ink)
    p(left ? 4 : 5, 3 - bob, 1, 2, C.ink)
  }
  p(1, 6 - bob, 6, 5, shirt)
  p(0, 7 - bob, 1, 3, shirt)
  p(7, 7 - bob, 1, 3, shirt)
  if (badge) p(2, 7 - bob, 2, 2, badge)
  else if (!moving && pose === 'phone') {
    p(left ? 0 : 6, 2, 2, 3, '#1d1e26')
    p(left ? 0 : 6, 5, 2, 2, skin)
    if (t % 12 < 8) {
      const dots = (t >> 2) % 3
      for (let i = 0; i <= dots; i++) p((left ? -4 : 9) + i * 2, -3, 1, 1, C.white)
    }
  } else if (!moving && (pose === 'play' || pose === 'playBack')) {
    // both hands on the rods, working them
    const jiggle = t % 2
    const y = pose === 'play' ? 10 : 6
    p(0, y + jiggle, 2, 1, skin)
    p(6, y + 1 - jiggle, 2, 1, skin)
  } else if (!moving) {
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

// ---- Palú, the office dog ------------------------------------------------------------------
// A white, fluffy, curly bichon with floppy ears, dark eyes and nose, and a red collar with a
// little gold tag.

const FUR = '#f8f5ee'
const FUR_SHADE = '#e3dccf'
const COLLAR = '#c4302b'
const TAG = '#f2b134'

/** Draws in a box `w` wide, mirrored when facing left. */
function facing(p, w, left) {
  return (x, y, pw, ph, color) => p(left ? w - x - pw : x, y, pw, ph, color)
}

/** Palú trotting, side-on, 18 x 10: long and low, short legs going. */
export function paluWalk(p, t, left) {
  const m = facing(p, 18, left)
  const step = t % 2
  const wag = (t >> 1) % 2
  // his little stub of a tail, wiggling
  m(1, 3 - wag, 1, 2, FUR)
  // long fluffy body
  m(2, 3, 12, 4, FUR)
  m(3, 2, 10, 1, FUR)
  m(3, 6, 11, 1, FUR_SHADE)
  // short legs, stepping
  m(3 + step, 7, 2, 2, FUR)
  m(11 - step, 7, 2, 2, FUR)
  m(3 + step, 8, 2, 1, FUR_SHADE)
  m(11 - step, 8, 2, 1, FUR_SHADE)
  // round fluffy head, floppy ear, face
  m(12, 0, 5, 5, FUR)
  m(13, -1, 3, 1, FUR)
  m(12, 1, 2, 4, FUR_SHADE)
  m(15, 2, 1, 1, C.ink)
  m(17, 3, 1, 1, C.ink)
  // red collar with a gold tag
  m(12, 5, 3, 1, COLLAR)
  m(13, 6, 1, 1, TAG)
}

/** Palú sniffing something, side-on, 18 x 10: standing still, head down, nose twitching. */
export function paluSniff(p, t, left) {
  const m = facing(p, 18, left)
  const wag = t % 2
  const twitch = (t >> 1) % 3 === 0 ? 1 : 0
  // stub going fast: something smells interesting
  m(1, 3 - wag, 1, 2, FUR)
  m(2, 3, 12, 4, FUR)
  m(3, 2, 10, 1, FUR)
  m(3, 6, 11, 1, FUR_SHADE)
  m(3, 7, 2, 2, FUR)
  m(11, 7, 2, 2, FUR)
  m(3, 8, 2, 1, FUR_SHADE)
  m(11, 8, 2, 1, FUR_SHADE)
  // head lowered to the ground, nose out
  m(12, 2, 5, 5, FUR)
  m(13, 1, 3, 1, FUR)
  m(12, 3, 2, 4, FUR_SHADE)
  m(15, 4, 1, 1, C.ink)
  m(17, 6 - twitch, 1, 1, C.ink)
  m(12, 6, 2, 1, COLLAR)
}

/** Palú trotting toward you, 10 x 11: round face first, short legs stepping under him. */
export function paluWalkFront(p, t) {
  const step = t % 2
  // his body behind his head, legs going
  p(2, 5, 6, 3, FUR)
  p(2, 7, 6, 1, FUR_SHADE)
  p(2, 8, 2, 1 + step, FUR)
  p(6, 8, 2, 2 - step, FUR)
  p(2, 8 + step, 2, 1, FUR_SHADE)
  p(6, 9 - step, 2, 1, FUR_SHADE)
  // round fluffy head, floppy ears, face
  p(2, 0, 6, 5, FUR)
  p(3, -1, 4, 1, FUR)
  p(1, 1, 2, 4, FUR_SHADE)
  p(7, 1, 2, 4, FUR_SHADE)
  if (t % 36 !== 0) {
    p(3, 2, 1, 1, C.ink)
    p(6, 2, 1, 1, C.ink)
  }
  p(4, 3, 2, 1, C.ink)
  p(3, 5, 4, 1, COLLAR)
  p(4, 6, 1, 1, TAG)
}

/** Palú trotting away from you, 10 x 11: the back of his head, his collar and his stub. */
export function paluWalkBack(p, t) {
  const step = t % 2
  const wag = (t >> 1) % 2
  // head first, his back and rump in front of it
  p(2, 0, 6, 4, FUR)
  p(3, -1, 4, 1, FUR)
  p(1, 1, 2, 4, FUR_SHADE)
  p(7, 1, 2, 4, FUR_SHADE)
  p(3, 4, 4, 1, COLLAR)
  p(2, 5, 6, 3, FUR)
  p(2, 7, 6, 1, FUR_SHADE)
  p(2, 8, 2, 1 + step, FUR)
  p(6, 8, 2, 2 - step, FUR)
  p(2, 8 + step, 2, 1, FUR_SHADE)
  p(6, 9 - step, 2, 1, FUR_SHADE)
  // the little stub of a tail on his rump, wiggling side to side
  p(4 + wag, 6, 2, 2, FUR_SHADE)
  p(4 + wag, 6, 2, 1, FUR)
}

/** Palú sitting, facing you, 10 x 9: low to the ground. */
export function paluSit(p, t) {
  // his stub of a tail peeks out on one side, wiggling
  const wag = (t >> 1) % 2
  p(8, 6 - wag, 1, 1, FUR)
  p(2, 5, 6, 3, FUR)
  p(2, 7, 6, 1, FUR_SHADE)
  p(2, 8, 2, 1, FUR)
  p(6, 8, 2, 1, FUR)
  p(2, 0, 6, 5, FUR)
  p(3, -1, 4, 1, FUR)
  p(1, 1, 2, 4, FUR_SHADE)
  p(7, 1, 2, 4, FUR_SHADE)
  if (t % 36 !== 0) {
    p(3, 2, 1, 1, C.ink)
    p(6, 2, 1, 1, C.ink)
  }
  p(4, 3, 2, 1, C.ink)
  p(3, 5, 4, 1, COLLAR)
  p(4, 6, 1, 1, TAG)
}

/** Palú lying down, 18 x 6: asleep (with a z) or awake with his stub wiggling. */
export function paluLie(p, t, asleep, left = false) {
  const m = facing(p, 18, left)
  const wag = (t >> 1) % 2
  m(0, 3 - (asleep ? 0 : wag), 1, 2, FUR)
  m(1, 2, 14, 4, FUR)
  m(2, 1, 11, 1, FUR)
  m(1, 5, 14, 1, FUR_SHADE)
  m(12, 0, 5, 5, FUR)
  m(12, 1, 2, 4, FUR_SHADE)
  if (asleep) m(14, 2, 2, 1, C.ink)
  else m(15, 2, 1, 1, C.ink)
  m(17, 3, 1, 1, C.ink)
  m(12, 4, 2, 1, COLLAR)
  if (asleep) {
    const z = t % 20
    if (z < 14) glyph(p, 'z', (left ? 0 : 13) + (z >> 2), -4 - (z >> 2), C.white)
  }
}

/** Palú's dog bed, 24 x 9: a long cushion with a raised rim, to fit a long dog. */
/** Palú's bowls, 13 x 4: kibble in the red one, water in the steel one. */
export function dogBowls(p, t) {
  p(0, 1, 6, 1, '#d65c4c')
  p(1, 1, 4, 1, '#9a6a3a')
  p(2, 0, 2, 1, '#b88350')
  p(0, 2, 6, 1, '#c8483a')
  p(1, 3, 4, 1, '#9e3328')
  p(7, 1, 6, 1, '#a9b4c3')
  p(8, 1, 4, 1, '#6fb7e0')
  p(8 + ((t >> 2) % 4), 1, 1, 1, '#c4e6f7')
  p(7, 2, 6, 1, '#8e9aab')
  p(8, 3, 4, 1, '#6e7b8c')
}

export function dogBed(p) {
  p(2, 1, 20, 7, '#8a5a3c')
  p(0, 3, 24, 4, '#8a5a3c')
  p(1, 2, 22, 6, '#8a5a3c')
  p(3, 3, 18, 4, '#d29a6c')
  p(4, 3, 16, 1, '#e3b287')
}

export { SKIN }
