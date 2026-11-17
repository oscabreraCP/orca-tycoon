// The loft: the office seen from the front and above, like a doll's house with the front
// wall taken off. One concrete hall: the far wall is a tall steel window onto the garden; every team
// sits in a room closed at the back by a navy curtain, rooms two side by side and open toward each
// other, and a curtain line with a column and a gap ends each row of rooms. The hangout fills the
// far end. Desks stand in fixed islands of six that stay put while seats empty and fill, and every
// sprite gets a dark outline from one extra pass in the painter.
//
// The panel keeps the mechanics (breaks, specialists coming and going, Palú, clicks); this file
// owns where things are and how they look.

import { C, XMAS, christmasTree, crown, festive, festiveHeadgear, glyph, holidayLights, look, lounger, roleColor, walker } from './sprites.js'

const INK = '#1d1b26'
export const OUTER = 4 // the side walls
const WALL = 34 // the window band across the top
const SPINE = 24 // a column and the walkway beside it, where the curtain lines open
// Furniture is sized to the people: a monitor about one and a half shoulders wide, a desk wide
// enough for its agent and a specialist on a stool at either side.
const IW = 36 // one desk of an island, across
const ID = 18 // one desk of an island, deep
const HALF = IW / 2
const MON = 16 // a monitor, across
const MON_X = (IW - MON) / 2
const ISL_W = IW * 3
const ISL_PITCH = 76 // from one island to the next one down
const ROOM_PAD = 6
const ROOM_MIN = ISL_W + ROOM_PAD * 2
/** Narrower than this and not even one room fits beside the walkway. */
export const LOFT_MIN_W = ROOM_MIN + SPINE + OUTER * 2 + 4
const HANG_WIDE = 270 // the hangout spreads out from this width, else it stacks
// Fill order inside an island: the front row first, its screens face you; then the back row.
const FILL = [3, 4, 5, 0, 1, 2]
const NAVY = ['#3c516d', '#4a6283', '#5b7597', '#33465f']
const LIGHT = { working: '#4be08f', monitoring: '#73b3ff', waiting: '#f6b23c', blocked: '#ff5468', done: '#3c4660', idle: '#3c4660' }

// ---- painting -----------------------------------------------------------------------------------

/** Draws the rectangles `draw` paints with a one-pixel ink outline around every solid one. */
function ol(p, draw) {
  const rects = []
  draw((x, y, w, h, c) => rects.push([x, y, w, h, c]))
  for (const [x, y, w, h, c] of rects) if (c[0] === '#') p(x - 1, y - 1, w + 2, h + 2, INK)
  for (const [x, y, w, h, c] of rects) p(x, y, w, h, c)
}
const at = (p, ox, oy) => (x, y, w, h, c) => p(ox + x, oy + y, w, h, c)
/** Mirrors left and right around the vertical line x = `mid`. */
const flip = (p, mid) => (x, y, w, h, c) => p(2 * mid - x - w, y, w, h, c)
const shadow = (p, x, y, w, h) => p(x, y, w, h, 'rgba(25,22,45,0.20)')

function hash(n) {
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  n ^= n >>> 13
  n = Math.imul(n, 0xc2b2ae35)
  return (n ^ (n >>> 16)) >>> 0
}
function hashText(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return hash(h)
}

// ---- desks that stay put ----------------------------------------------------------------------
// Every worktree of a team owns a desk, one per agent when it runs several, and keeps it while it
// sleeps: an empty chair with its nameplate. Desks fill in order, the front row of an island first;
// a desk keeps its place until its worktree goes, and nobody moves up. A new worktree takes the
// first free desk, or the one beside the previous desk of its family when that one is free, so a
// stack of worktrees still reads as one line.

const slotMemory = new Map() // repo -> Map(desk key -> fill index)

function assignSlots(floor, { families }) {
  const order = []
  families(floor.desks).forEach((family, fam) => {
    for (const desk of family) {
      const staff = [...desk.staff].sort((a, b) => a.id.localeCompare(b.id))
      for (let i = 0; i < Math.max(1, staff.length); i++) order.push({ desk, staff: staff[i] ?? null, fam, unit: `${desk.id}#${i}` })
    }
  })
  const memory = slotMemory.get(floor.repo) ?? new Map()
  slotMemory.set(floor.repo, memory)
  const live = new Set(order.map((u) => u.unit))
  for (const key of memory.keys()) if (!live.has(key)) memory.delete(key)
  const used = new Set(memory.values())
  order.forEach((u, i) => {
    if (memory.has(u.unit)) return
    let n = null
    const prev = order[i - 1]
    if (prev && prev.fam === u.fam && memory.has(prev.unit)) {
      const s = memory.get(prev.unit)
      if (s % 3 !== 2 && !used.has(s + 1)) n = s + 1
    }
    for (let k = 0; n === null; k++) if (!used.has(k)) n = k
    memory.set(u.unit, n)
    used.add(n)
  })
  return order.map((u) => ({ ...u, n: memory.get(u.unit) }))
}

// ---- layout ---------------------------------------------------------------------------------

const FULL_BLOCK = 80 // a full island and the floor around it, in a room
const HALF_BLOCK = 58 // a half island (one row of three) with its team's name over it

/**
 * The office at one scale. A team of up to three desks gets half an island, a bigger one full
 * islands of six; two small teams share a room. Rooms go two to a row when the floor is wide
 * enough, else one; each row of rooms ends in a curtain line; the hangout sits halfway.
 */
export function layoutLoft(snapshot, cssW, scale, helpers) {
  const artW = Math.max(LOFT_MIN_W, Math.floor(cssW / scale))
  const x0 = OUTER + 2
  const floorW = artW - OUTER * 2 - 4
  const cols = floorW >= ROOM_MIN * 2 + SPINE ? 2 : 1
  const colW = Math.floor((floorW - SPINE) / cols)
  const spineX = x0 + colW
  const colX = [x0, spineX + SPINE]
  const perRow = Math.max(1, Math.floor((colW - ROOM_PAD * 2 + 8) / (ISL_W + 8)))

  const busy = (floor) => floor.desks.some((d) => d.staff.length > 0)
  const teams = (snapshot?.floors ?? [])
    .filter(busy)
    .map((floor) => {
      const units = assignSlots(floor, helpers)
      const last = Math.max(0, ...units.map((u) => u.n))
      const half = last < 3
      const islands = half ? 1 : Math.ceil((last + 1) / 6)
      const rows = half ? 1 : Math.ceil(islands / perRow)
      return { floor, units, half, islands, rows, h: half ? HALF_BLOCK : rows * FULL_BLOCK }
    })
    .sort((a, b) => b.units.length - a.units.length || a.floor.repo.localeCompare(b.floor.repo))

  // Rooms: a big team has one to itself; small teams pair up, two to a room.
  const roomPlans = []
  const small = []
  for (const team of teams) (team.half ? small : roomPlans).push([team])
  for (let i = 0; i < small.length; i += 2) roomPlans.push(small.slice(i, i + 2).map((t) => t[0]))
  const contentH = (plan) => plan.reduce((n, t) => n + t.h, 0)

  // Rows of rooms, then the row that puts the hangout halfway: half the rooms above it, half below,
  // so nobody walks far for a coffee.
  const bands = []
  for (let b = 0; b < roomPlans.length; b += cols) {
    const band = roomPlans.slice(b, b + cols)
    bands.push({ band, h: 26 + Math.max(...band.map(contentH)) })
  }
  let split = bands.length
  let best = Infinity
  for (let k = 1; k <= bands.length; k++) {
    const above = bands.slice(0, k).reduce((n, b) => n + b.h, 0)
    const below = bands.slice(k).reduce((n, b) => n + b.h, 0)
    if (Math.abs(above - below) < best) {
      best = Math.abs(above - below)
      split = k
    }
  }

  const rooms = []
  const seats = []
  const lines = [] // curtain lines: the floor row each one stands on
  let common = null
  let top = WALL
  for (let b = 0; b <= bands.length; b++) {
    if (b === split) {
      common = hangout(x0, top, floorW)
      top = common.y + common.h
      // the rooms below get their back curtain, far enough down that its column stays clear
      if (b < bands.length) {
        top += cols === 1 ? 26 : 46
        lines.push(top)
      }
    }
    if (b === bands.length) break
    const bottom = top + bands[b].h
    bands[b].band.forEach((plan, c) => {
      const room = { x: colX[c], y: top, w: colW, h: bottom - top, name: plan.map((t) => t.floor.repo).join(' · '), first: top === WALL, islands: [] }
      let cursor = top
      for (const team of plan) {
        const ref = { name: team.floor.repo }
        const isles = []
        if (team.half) {
          const isl = { x: room.x + Math.floor((colW - ISL_W) / 2), y: cursor + 14, half: true, cells: Array(3).fill(null), team: plan.length > 1 ? team.floor.repo : null }
          isles.push(isl)
        } else {
          for (let i = 0; i < team.islands; i++) {
            const row = Math.floor(i / perRow)
            const inRow = Math.min(perRow, team.islands - row * perRow)
            const rowW = inRow * ISL_W + (inRow - 1) * 8
            const ix = room.x + Math.floor((colW - rowW) / 2) + (i % perRow) * (ISL_W + 8)
            isles.push({ x: ix, y: cursor + 22 + row * FULL_BLOCK, half: false, cells: Array(6).fill(null), team: null })
          }
        }
        room.islands.push(...isles)
        for (const u of team.units) {
          const island = team.half ? isles[0] : isles[Math.floor(u.n / 6)]
          const cell = team.half ? u.n : FILL[u.n % 6]
          const front = team.half || cell >= 3
          const row0 = team.half ? 0 : ID
          const cx = island.x + (cell % 3) * IW + HALF
          const iy = island.y
          if (!u.staff) {
            island.cells[cell] = { vacant: true, key: u.unit, desk: u.desk, label: u.desk.label || u.desk.name, front, cx, island, row0 }
            continue
          }
          const sy = front ? iy + row0 + 8 : iy - 22
          const seat = {
            key: `${u.desk.id}|${u.staff.id}`,
            // the desk's own key: its mat and things stay the same whether it sleeps or works
            unit: u.unit,
            slot: u.n,
            desk: u.desk,
            staff: u.staff,
            room: ref,
            island,
            front,
            row0,
            cx,
            // the box the panel's shared code reads, roughly where the agent is
            x: cx - 10,
            y: front ? iy + row0 - 4 : iy - 18,
            stools: [
              // a clear step from the chair, so the specialist sits beside the agent, not on them
              { x: cx + 9, y: sy },
              { x: cx - 17, y: sy, flip: true }
            ],
            overflow: Math.max(0, helpers.activeSpecialists(u.staff).length - 2)
          }
          island.cells[cell] = seat
          seats.push(seat)
        }
        cursor += team.h
      }
      room.drawers = drawerBlocks(room)
      rooms.push(room)
    })
    // a curtain line when anything follows, another row of rooms or the hangout
    if (b < bands.length - 1 || split === bands.length) {
      lines.push(bottom)
      top = bottom
    } else top = bottom - 22
  }

  const h = top + 6
  const building = { w: artW, h, doorY: common.doorY, x0, floorW, spineX, cols }
  return { theme: 'loft', artW, artH: h, scale, building, rooms, seats, common, lines, teamCount: teams.length }
}

const DRAWER_W = 12

/**
 * The yellow drawer blocks: one in a room's back corner, against the curtain or the window, when the
 * corner has room beside the islands. Which corners get one, how tall, and what stands on top comes
 * from the room's name, so a room keeps its look.
 */
function drawerBlocks(room) {
  const left = Math.min(...room.islands.map((i) => i.x))
  const right = Math.max(...room.islands.map((i) => i.x + ISL_W))
  const spots = []
  if (left - room.x >= DRAWER_W + 2) spots.push(room.x + 1)
  if (room.x + room.w - right >= DRAWER_W + 2) spots.push(room.x + room.w - DRAWER_W - 1)
  return spots
    .map((x, i) => ({ x, roll: hashText(`${room.name}|drawer|${i}`) }))
    .filter(({ roll }) => roll % 100 < 60)
    .map(({ x, roll }) => ({ x, base: room.y + 24, h: roll % 3 === 0 ? 22 : 30, top: [null, 'retro', 'plant', 'books'][(roll >>> 8) % 4] }))
}

/** The hangout: phone booths, the coffee corner, the sofa on the pink rug, foosball, a bar. */
const HANG_MAX = 330 // wider than this, the hangout keeps its size in the middle of the floor

function hangout(fx, y, fw) {
  const w = Math.min(fw, HANG_MAX)
  const x = fx + Math.floor((fw - w) / 2)
  const R = x + w
  const c = { x, y, w, things: [] }
  const add = (kind, props) => {
    const thing = { kind, ...props }
    c.things.push(thing)
    return thing
  }
  const wide = w >= HANG_WIDE
  if (wide) {
    c.h = 104
    const booths = [add('booth', { x: x + 4, floor: y + 50 }), add('booth', { x: x + 27, floor: y + 50 })]
    const counter = add('counter', { x: R - 110, y: y + 6, w: 80 })
    add('fridge', { x: R - 28, floor: y + 21 })
    add('cooler', { x: R - 120, floor: y + 22 })
    const rug = add('rug', { x: x + 56, y: y + 18, w: Math.min(124, w - 166), h: 74 })
    const sofa = add('sofa', { x: rug.x + 16, y: rug.y + 4, w: Math.max(40, rug.w - 68) })
    add('coffeeTable', { x: sofa.x + Math.floor(sofa.w / 2) - 12, y: rug.y + 24 })
    const chairs = tableGroup(add, rug.x + rug.w - 48, y + 56)
    const foos = add('foosball', { x: R - 120, y: y + 50 })
    add('tree', { x: R - 82, y: y + 47 }) // in season, between the foosball and the high table
    add('barStool', { x: R - 60, y: y + 54 })
    add('barStool', { x: R - 14, y: y + 54 })
    add('barTable', { x: R - 48, y: y + 48 })
    add('barStool', { x: R - 45, y: y + 62 })
    add('barStool', { x: R - 29, y: y + 62 })
    add('plant', { x: rug.x + 2, y: y + 2 })
    add('plant', { x: R - 22, y: y + 86 })
    c.bed = { x: x + 20, y: y + 86 }
    c.bowls = { x: x + 4, y: y + 91 }
    c.doorY = y + 56
    finish(c, { booths, counter, sofa, foos, chairs })
  } else {
    // The right edge stays clear: it lines up with the gaps in the curtain lines, so people walk
    // straight down from their rooms. Booth, fridge and counter stand against the curtain, the
    // sofa corner below them, foosball and Palú's corner below that.
    c.h = 140
    const clear = R - 34
    const booths = [add('booth', { x: x + 4, floor: y + 46 })]
    add('fridge', { x: x + 28, floor: y + 21 })
    add('cooler', { x: x + 44, floor: y + 22 })
    const counter = add('counter', { x: x + 54, y: y + 6, w: Math.max(30, clear - 12 - (x + 54)) })
    add('plant', { x: clear - 10, y: y + 6 })
    const rug = add('rug', { x: x + 4, y: y + 52, w: clear - x - 4, h: 38 })
    const sofaW = Math.max(40, Math.min(56, rug.w - 58))
    const sofa = add('sofa', { x: rug.x + 6, y: rug.y + 4, w: sofaW })
    add('coffeeTable', { x: sofa.x + Math.floor(sofa.w / 2) - 12, y: rug.y + 24 })
    const chairs = tableGroup(add, rug.x + rug.w - 40, rug.y + 2)
    // the last row: foosball, Palú's corner, and the high table with its stools when it fits
    const foos = add('foosball', { x: x + 12, y: y + 112 })
    c.bed = { x: x + 50, y: y + 118 }
    c.bowls = { x: x + 52, y: y + 108 }
    if (clear - (x + 80) >= 50) {
      const bx = clear - 40
      add('barStool', { x: bx - 10, y: y + 104 })
      add('barStool', { x: bx + 33, y: y + 104 })
      add('barTable', { x: bx + 2, y: y + 98 })
      add('barStool', { x: bx + 5, y: y + 112 })
      add('barStool', { x: bx + 21, y: y + 112 })
    }
    // in season, the tree stands between Palú's corner and the high table, or the right edge
    const treeL = x + 76
    const treeR = clear - (x + 80) >= 50 ? clear - 50 : clear
    if (treeR - treeL >= 17) add('tree', { x: Math.round((treeL + treeR) / 2) - 7, y: y + 97 })
    c.doorY = y + 94
    finish(c, { booths, counter, sofa, foos, chairs })
  }
  return c
}

/** The round white table with four tulip chairs: two behind it facing you, two in front. */
function tableGroup(add, tx, ty) {
  const chairs = [add('tulip', { x: tx, y: ty, facing: true }), add('tulip', { x: tx + 28, y: ty, facing: true })]
  add('roundTable', { x: tx + 8, y: ty + 12 })
  chairs.push(add('tulip', { x: tx - 4, y: ty + 22, facing: false }), add('tulip', { x: tx + 32, y: ty + 22, facing: false }))
  return chairs
}

/** The spots people take on a break, in the pools the panel hands out. */
function finish(c, { booths, counter, sofa, foos, chairs }) {
  // a seat at the table for a chat: stand by the chair, then sit down on it
  c.table = chairs.map((chair) => ({ x: chair.x, y: chair.y - 4, kind: 'table', chair, left: chair.x > chairs[0].x + 10 }))
  c.booths = booths.map((b) => ({ x: b.x + 6, y: b.floor - 19, kind: 'booth', left: true, bx: b.x, floor: b.floor }))
  c.spots = []
  for (let sx = counter.x + 14; sx + 8 <= counter.x + counter.w; sx += 9) c.spots.push({ x: sx, y: counter.y + 5, kind: 'coffee' })
  c.sofa = []
  for (let i = 0; i < Math.floor((sofa.w - 6) / 10); i++) c.sofa.push({ x: sofa.x + 3 + i * 10, y: sofa.y - 3, kind: 'lounge', sofa })
  c.foos = [
    { x: foos.x + 10, y: foos.y - 16, kind: 'foosball', left: false, back: false },
    { x: foos.x + 10, y: foos.y + 20, kind: 'foosball', left: false, back: true }
  ]
  // Palú wanders along the hangout's last row
  c.laneTop = c.y + c.h - 30
  c.laneBottom = c.y + c.h - 22
}

// ---- where people stand, for the panel's walking ------------------------------------------------

export const loftGeometry = {
  /** Where an agent stands when it gets up: just behind or in front of its chair. */
  homeOf(seat) {
    return seat.front ? { x: seat.cx - 4, y: seat.island.y + seat.row0 + 25 } : { x: seat.cx - 4, y: seat.island.y - 32 }
  },
  /** The aisle spot before a stool, and the stool itself. */
  stoolStops(seat, stool) {
    const aisle = seat.front ? seat.island.y + seat.row0 + 25 : seat.island.y - 32
    return { aisle: { x: stool.x, y: aisle }, on: { x: stool.x, y: stool.y + 3 } }
  },
  /** Palú naps on the floor just in front of a front-row chair. */
  paluDeskSpot(seat) {
    return { x: seat.cx - 9, y: seat.island.y + seat.row0 + 37 }
  },
  visitable: (seat) => seat.front,
  /** The box that is this seat, for clicks and the selection frame. */
  seatBox(seat) {
    return seat.front ? [seat.cx - 9, seat.island.y + seat.row0 - 4, 18, 37] : [seat.cx - 9, seat.island.y - 18, 18, 28]
  },
  seatAnchor(seat) {
    return seat.front ? { x: seat.cx, y: seat.island.y + seat.row0 + 9 } : { x: seat.cx, y: seat.island.y - 16 }
  },
  /** Floor that nobody walks through: [x, y, w, h]. */
  obstacles(layout) {
    const { artW, building: b } = layout
    const boxes = [[0, 0, artW, WALL + 2]]
    for (const room of layout.rooms) for (const isl of room.islands) boxes.push(isl.half ? [isl.x - 8, isl.y - 6, ISL_W + 16, 42] : [isl.x - 8, isl.y - 10, ISL_W + 16, ID + 46])
    for (const line of layout.lines) {
      boxes.push(...curtainSegments(layout).map(([sx, w]) => [sx, line - 3, w, 3]))
      boxes.push([b.spineX, line - 4, 10, 5])
    }
    const c = layout.common
    for (const t of c.things) {
      const box = footprint(t)
      if (box) boxes.push(box)
    }
    boxes.push([c.bowls.x, c.bowls.y + 1, 13, 3])
    for (const room of layout.rooms) for (const d of room.drawers ?? []) boxes.push([d.x, d.base - 6, DRAWER_W, 6])
    return boxes
  },
  /** Places worth a sniff for Palú: where he stands with his nose to them. */
  sniffSpots(layout) {
    const fromRight = (x, base) => ({ x, y: base - 9, left: true })
    const fromLeft = (x, base) => ({ x: x - 18, y: base - 9, left: false })
    const spots = []
    for (const line of layout.lines) spots.push(fromLeft(layout.building.spineX, line + 3))
    for (const t of layout.common.things) {
      if (t.kind === 'plant') spots.push(fromRight(t.x + 9, t.y + 15))
      else if (t.kind === 'sofa') spots.push(fromLeft(t.x - 3, t.y + 13), fromRight(t.x + t.w + 3, t.y + 13))
      else if (t.kind === 'foosball') spots.push(fromLeft(t.x, t.y + 18), fromRight(t.x + 28, t.y + 18))
      else if (t.kind === 'cooler' || t.kind === 'fridge') spots.push(fromLeft(t.x, t.floor))
      else if (t.kind === 'booth') spots.push(fromRight(t.x + 20, t.floor))
    }
    return spots
  }
}

function curtainSegments(layout) {
  const { x0, floorW, spineX } = layout.building
  return [
    [x0 - 2, spineX - x0 + 2],
    [spineX + SPINE, x0 + floorW - spineX - SPINE + 2]
  ].filter(([, w]) => w > 0)
}

/** The floor a piece of hangout furniture stands on. */
function footprint(t) {
  switch (t.kind) {
    case 'booth':
      return [t.x, t.floor - 8, 20, 8]
    case 'counter':
      return [t.x, t.y + 6, t.w, 9]
    case 'fridge':
      return [t.x, t.floor - 6, 13, 6]
    case 'cooler':
      return [t.x, t.floor - 5, 7, 5]
    case 'sofa':
      return [t.x - 3, t.y + 4, t.w + 6, 9]
    case 'coffeeTable':
      return [t.x, t.y + 2, 24, 6]
    case 'roundTable':
      return [t.x, t.y + 6, 16, 5]
    case 'tulip':
      return [t.x, t.y + 7, 7, 4]
    case 'foosball':
      return [t.x, t.y + 6, 28, 12]
    case 'barTable':
      return [t.x, t.y + 14, 28, 6]
    case 'barStool':
      return [t.x, t.y + 10, 7, 4]
    case 'plant':
      return [t.x + 1, t.y + 10, 8, 5]
    case 'tree':
      return festive() ? [t.x + 2, t.y + 17, 11, 4] : null
    default:
      return null
  }
}

// ---- the desk mats ------------------------------------------------------------------------------
// Every mat has the colours of the real one, cream, sage, pink and purple, in a pattern of its own,
// picked from the seat's key so a desk keeps its mat. Each mat is painted once into a little canvas.

const MAT = ['#f4eedf', '#c9d3b8', '#ea9c90', '#7b4a78']
const PATTERNS = {
  waves(i, j, k) {
    if ((i > k.w - 7 && j < 3) || (i < 6 && j > k.h - 4)) return 3
    const v = j + k.amp * Math.sin(i / k.f + k.ph) - i / 14
    return v < 1.5 ? 0 : v < 3.5 ? 1 : v < 5.6 ? 2 : 0
  },
  hills(i, j, k) {
    const top = k.h - 2 - k.amp * Math.abs(Math.sin(i / k.f + k.ph)) * 1.6
    const back = k.h - 4 - k.amp * Math.abs(Math.sin(i / (k.f * 1.7) + k.ph * 2))
    return j > top ? 2 : j > back ? 1 : (i * 7 + j * 3) % 23 === 0 ? 3 : 0
  },
  stripes(i, j, k) {
    return Math.floor((i + j * 2 + k.ph * 9) / k.f) % 3 === 0 ? 1 + (Math.floor((i + j * 2) / (k.f * 3)) % 3) : 0
  },
  terrazzo(i, j, k) {
    const h = hash(i * 131 + j * 977 + Math.round(k.ph * 100))
    return h % 9 === 0 ? 1 + ((h >>> 8) % 3) : 0
  },
  sun(i, j, k) {
    const d = Math.hypot(i - (k.ph > 3 ? k.w : 0), j - k.h) / (k.f * 0.7)
    return d < 1 ? 3 : d < 2 ? 2 : d < 3 ? 1 : 0
  },
  blobs(i, j, k) {
    const a = Math.hypot(i - k.w * 0.25, (j - 3) * 2) < k.f + 2
    const b = Math.hypot(i - k.w * 0.7, (j - 6) * 2) < k.f + 4
    return a && b ? 3 : a ? 1 : b ? 2 : 0
  }
}
const mats = new Map()

function mat(key, w, h) {
  const id = `${key}|${w}|${h}`
  let canvas = mats.get(id)
  if (canvas) {
    // the latest used last, so the one to go is the one off screen the longest
    mats.delete(id)
    mats.set(id, canvas)
    return canvas
  }
  let s = hashText(key) || 1
  const r = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
  const names = Object.keys(PATTERNS)
  const pattern = PATTERNS[names[Math.floor(r() * names.length)]]
  const k = { amp: 1.6 + r() * 2, f: 3.5 + r() * 4, ph: r() * 6, w, h }
  canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      g.fillStyle = MAT[pattern(i, j, k)]
      g.fillRect(i, j, 1, 1)
    }
  }
  // Only the desks on screen are drawn, far fewer than this, so a big office never repaints its
  // mats every frame the way clearing them all did once it had more desks than the cache held.
  if (mats.size >= 400) mats.delete(mats.keys().next().value)
  mats.set(id, canvas)
  return canvas
}

// ---- monitors and people ----------------------------------------------------------------------

/** A screen's contents by state; `light` is a pale editor theme, some desks have one. */
function screen(p, x, y, w, h, state, t, light) {
  p(x, y, w, h, light ? '#f4f1e6' : '#121722')
  if (state === 'working') {
    if (light) {
      p(x, y, 3, h, '#e2dccb')
      p(x + w - 5, y, 5, h, '#c9a56a')
    }
    const cols = light ? ['#3c4660', '#7b5bb5', '#2f8f6a'] : [C.green, C.blue, C.amber]
    const inner = w - (light ? 10 : 3)
    for (let line = 0; line < h - 1; line += 2) {
      const len = 2 + ((t + line * 3) % Math.max(1, inner - 2))
      p(x + (light ? 4 : 2) + ((line >> 1) % 3 === 1 ? 2 : 0), y + 1 + line, Math.max(1, Math.min(len, inner - 2)), 1, cols[((line >> 1) + (t >> 2)) % 3])
    }
  } else if (state === 'waiting') {
    p(x, y, w, h, '#3a2a10')
    if ((t >> 2) % 2) glyph(p, '?', x + (w >> 1) - 1, y + (h >> 1) - 2, C.amber)
  } else if (state === 'blocked') {
    p(x, y, w, h, (t >> 1) % 2 ? C.red : '#8a2232')
    glyph(p, '!', x + (w >> 1) - 1, y + (h >> 1) - 2, C.white)
  } else if (state === 'done' || state === 'idle') {
    p(x + (t % (w - 2)) + 1, y + 1 + ((t >> 3) % (h - 2)), 1, 1, '#3c4660')
  } else if (state === 'monitoring') {
    p(x + 2, y + (h >> 1), w - 4, 1, '#36354a')
    p(x + 2, y + (h >> 1), t % (w - 4), 1, C.green)
  }
}

/** A front-row monitor, facing you on its riser: a title bar for the nameplate over the screen. */
function monitorFront(p, x, y, seat, t) {
  const remote = Boolean(seat?.desk.environment)
  ol(p, (q) => {
    q(x + 3, y + 10, MON - 6, 3, '#e0533f')
    q(x + 3, y + 10, MON - 6, 1, '#ef6a55')
    q(x + 5, y + 11, MON - 10, 1, '#e5c38f')
    q(x, y, MON, 10, remote ? C.thinFrame : '#23212b')
  })
  p(x + 1, y + 1, MON - 2, 2, seat ? '#2f3a52' : '#1b1f2a')
  const light = seat ? hashText(seat.key) % 5 < 2 : false
  screen(p, x + 1, y + 3, MON - 2, 6, seat ? seat.staff.state : 'off', t, light)
}

/** The back of a back-row monitor: a plain panel, a status light, room for the nameplate. */
function monitorBack(p, x, y, seat, t) {
  const s = seat ? seat.staff.state : 'off'
  ol(p, (q) => {
    q(x + MON / 2 - 1, y + 8, 2, 2, '#4b4a5e')
    q(x, y, MON, 8, seat?.desk.environment ? '#8e92a6' : '#3a3946')
    q(x, y, MON, 1, '#4f4e5e')
  })
  const blink = s === 'waiting' ? (t >> 2) % 2 : s === 'blocked' ? (t >> 1) % 2 : 1
  // on the top edge, above the nameplate
  p(x + MON - 4, y + 1, 3, 1, blink && LIGHT[s] ? LIGHT[s] : '#2a2833')
}

function chairBack(q, cx, y) {
  q(cx - 6, y + 15, 12, 8, '#eeece8')
  q(cx - 5, y + 16, 10, 6, '#7f8ea3')
  q(cx - 3, y + 19, 6, 2, '#3e4656')
  q(cx - 1, y + 23, 2, 3, '#c9c8cf')
  q(cx - 6, y + 26, 12, 1, '#e3e2e6')
  q(cx - 6, y + 27, 2, 1, '#6b6a75')
  q(cx + 4, y + 27, 2, 1, '#6b6a75')
}

/** A front-row agent in an office chair, back to you, looking at the screen. */
export function frontAgent(p, cx, y, staff, t, away) {
  if (away || !staff) return ol(p, (q) => chairBack(q, cx, y))
  const { skin, hair, shirt, costume } = look(staff.id || 'x')
  const s = staff.state
  const sleepy = s === 'done' || s === 'idle'
  const facing = s === 'waiting'
  const bob = s === 'working' ? t % 2 : 0
  const dy = sleepy ? 2 : 0
  ol(p, (q) => {
    q(cx - 5, y + 11 + dy, 10, 6, shirt)
    if (s === 'working') {
      q(cx - 7, y + 11, 2, 3, shirt)
      q(cx + 5, y + 11, 2, 3, shirt)
      q(cx - 7 + (t % 2), y + 9, 2, 2, skin)
      q(cx + 5 - (t % 2), y + 9, 2, 2, skin)
    }
    if (s === 'blocked') {
      q(cx - 6, y + 6, 2, 6, shirt)
      q(cx + 4, y + 6, 2, 6, shirt)
      q(cx - 5, y + 4, 2, 2, skin)
      q(cx + 3, y + 4, 2, 2, skin)
    }
    if (s === 'monitoring') {
      q(cx + 5, y + 11, 2, 3, shirt)
      q(cx + 5, y + 9, 2, 2, C.white)
    }
    if (facing) {
      q(cx - 3, y + 5, 6, 6, skin)
      q(cx - 3, y + 4, 6, 2, hair)
      q(cx - 4, y + 5, 1, 3, hair)
      q(cx + 3, y + 5, 1, 3, hair)
      if (t % 30 !== 0) {
        q(cx - 2, y + 7, 1, 2, INK)
        q(cx + 1, y + 7, 1, 2, INK)
      }
    } else {
      q(cx - 3, y + 5 + dy - bob, 6, 6, hair)
      q(cx - 3, y + 4 + dy - bob, 6, 1, hair)
      q(cx - 4, y + 7 + dy - bob, 1, 2, skin)
      q(cx + 3, y + 7 + dy - bob, 1, 2, skin)
      if (sleepy) q(cx - 3, y + 10 + dy, 6, 1, skin)
    }
    chairBack(q, cx, y)
    if (festive()) festiveHeadgear(q, cx - 3, facing ? y + 4 : y + 4 + dy - bob, costume, !facing, Boolean(staff.isLeader))
    else if (staff.isLeader) crown(q, cx - 3, (facing ? y + 4 : y + 4 + dy - bob) - 1)
  })
  marks(p, cx, y + 5, s, t, facing)
  if (s === 'monitoring' && t % 6 < 4) p(cx + 5 + (t % 2), y + 7 - ((t >> 1) % 2), 1, 1, C.steam)
}

/** A back-row agent behind the desk, facing you over the monitor. */
export function backAgent(p, cx, y, staff, t, away) {
  ol(p, (q) => {
    q(cx - 6, y - 18, 12, 11, '#eeece8')
    q(cx - 5, y - 17, 10, 9, '#7f8ea3')
  })
  if (away || !staff) return
  const { skin, hair, shirt, costume } = look(staff.id || 'x')
  const s = staff.state
  const sleepy = s === 'done' || s === 'idle'
  const bob = s === 'working' ? t % 2 : 0
  const dy = sleepy ? 3 : 0
  ol(p, (q) => {
    q(cx - 5, y - 7 + dy, 10, 8, shirt)
    if (s === 'blocked') {
      q(cx - 6, y - 13, 2, 7, shirt)
      q(cx + 4, y - 13, 2, 7, shirt)
      q(cx - 5, y - 15, 2, 2, skin)
      q(cx + 3, y - 15, 2, 2, skin)
    }
    if (s === 'waiting') {
      q(cx + 5, y - 13, 2, 7, shirt)
      q(cx + 5, y - 15, 2, 2, skin)
    }
    if (s === 'monitoring') {
      q(cx - 7, y - 6, 2, 4, shirt)
      q(cx - 7, y - 8, 2, 2, C.white)
    }
    q(cx - 3, y - 13 + dy - bob, 6, 6, skin)
    q(cx - 3, y - 14 + dy - bob, 6, 2, hair)
    q(cx - 4, y - 13 + dy - bob, 1, 3, hair)
    q(cx + 3, y - 13 + dy - bob, 1, 3, hair)
    if (sleepy) {
      q(cx - 2, y - 10 + dy, 1, 1, INK)
      q(cx + 1, y - 10 + dy, 1, 1, INK)
    } else if (t % 30) {
      q(cx - 2, y - 11 - bob, 1, 2, INK)
      q(cx + 1, y - 11 - bob, 1, 2, INK)
    }
    if (festive()) festiveHeadgear(q, cx - 3, y - 14 + dy - bob, costume, false, Boolean(staff.isLeader))
    else if (staff.isLeader) crown(q, cx - 3, y - 14 + dy - bob - 1)
  })
  marks(p, cx, y - 14, s, t, s === 'waiting')
  if (s === 'monitoring' && t % 6 < 4) p(cx - 7 + (t % 2), y - 10 - ((t >> 1) % 2), 1, 1, C.steam)
}

/** A Santa cap, or an elf's green one, on a 5-wide head seen side-on, its top row at (x, y). */
function cap(q, x, y, costume) {
  q(x, y, 5, 1, C.white)
  q(x, y - 2, 4, 2, costume === 'elf' ? XMAS.elfGreen : XMAS.santaRed)
  q(x + 4, y - 1, 1, 1, C.white)
}

/** The ? over someone waiting, the ! over someone stuck, the z over someone dozing. */
function marks(p, cx, head, s, t, waiting) {
  if (waiting && (t >> 2) % 2) ol(p, (q) => glyph(q, '?', cx - 1, head - 8, C.amber))
  if (s === 'blocked') ol(p, (q) => glyph(q, '!', cx - 1, head - 8, C.red))
  if (s === 'done' || s === 'idle') {
    const z = t % 16
    if (z < 12) ol(p, (q) => glyph(q, 'z', cx + 4 + (z >> 2), head - 3 - (z >> 2), C.white))
  }
}

/** The orange metal stool, with a specialist on it leaning in toward the agent's screen. */
function stoolSpecialist(p, x, y, spec, t, mirrored) {
  const q0 = mirrored ? flip(p, x + 3.5) : p
  shadow(p, x, y + 24, 9, 2)
  q0(x + 2, y + 18, 1, 5, '#a8381c')
  q0(x + 5, y + 18, 1, 5, '#a8381c')
  ol(q0, (q) => {
    q(x, y + 18, 1, 3, '#d9502a')
    q(x - 1, y + 21, 1, 3, '#d9502a')
    q(x + 7, y + 18, 1, 3, '#d9502a')
    q(x + 8, y + 21, 1, 3, '#d9502a')
    q(x, y + 15, 8, 3, '#ef6a3e')
    q(x, y + 15, 8, 1, '#f58a62')
    q(x, y + 17, 8, 1, '#c94a26')
    q(x + 3, y + 16, 2, 1, '#8a2e16')
  })
  if (!spec) return
  const { skin, hair, shirt, costume } = look(spec.id || 'specialist')
  const lean = spec.state === 'working' && (t >> 2) % 2 ? -1 : 0
  ol(q0, (q) => {
    q(x + 1 + lean, y + 4, 5, 2, hair)
    q(x + 1 + lean, y + 6, 5, 4, skin)
    q(x + 5 + lean, y + 5, 1, 3, hair)
    q(x + 2 + lean, y + 7, 1, 1, INK)
    q(x + 1, y + 10, 6, 6, shirt)
    q(x + 3, y + 11, 2, 2, roleColor(spec.role))
    q(x - 1 + lean, y + 12, 2, 1, skin)
    if (festive()) cap(q, x + 1 + lean, y + 4, costume)
  })
  if (spec.state === 'waiting' && (t >> 2) % 2) ol(p, (q) => glyph(q, '?', x + 2, y - 3, C.amber))
  if (spec.state === 'blocked') ol(p, (q) => glyph(q, '!', x + 2, y - 3, C.red))
}

/** One island: six desks pushed together, the back row facing you, the front row facing away. */
function island(p, g, isl, world) {
  const { x, y, cells, half } = isl
  const t = world.tick
  const W = ISL_W
  const D2 = ID * (half ? 1 : 2)
  const row0 = half ? 0 : ID
  // a cell is an agent's seat, a sleeping worktree's desk (vacant), or a spare desk (null)
  const staffed = (cell) => (cell && !cell.vacant ? cell : null)
  const kicks = (seat) => {
    if (!seat) return
    world.seatedAt(seat).forEach(({ spec, index }) => {
      const st = seat.stools[index]
      stoolSpecialist(p, st.x, st.y, spec, t, st.flip)
    })
    if (seat.overflow) ol(p, (q) => glyph(q, '+', seat.stools[1].x + 2, seat.stools[1].y - 2, C.white))
  }
  if (!half) {
    for (let i = 0; i < 3; i++) {
      const seat = staffed(cells[i])
      kicks(seat)
      backAgent(p, x + i * IW + HALF, y, seat?.staff, t, seat && world.away(seat))
    }
  }
  shadow(p, x + 1, y + D2 + 13, W, 3)
  ol(p, (q) => {
    for (const lx of [2, W - 5]) {
      q(x + lx, y + D2 + 2, 3, 11, '#e8e8ec')
      q(x + lx - 2, y + D2 + 13, 7, 1, '#c9cad2')
    }
    q(x + W / 2 - 1, y + D2 + 2, 3, 11, '#e8e8ec')
    q(x + W / 2 - 3, y + D2 + 13, 7, 1, '#c9cad2')
  })
  ol(p, (q) => {
    q(x, y, W, D2, '#f3f2ef')
    q(x, y + D2, W, 2, '#d3d1cc')
  })
  if (!half) p(x, y + ID, W, 1, '#dcdad5')
  for (let i = 1; i < 3; i++) p(x + i * IW, y, 1, D2, '#dcdad5')
  cells.forEach((cell, i) => {
    const row = half || i < 3 ? 0 : 1
    g.drawImage(mat(cell ? cell.unit ?? cell.key : `empty|${x}|${y}|${i}`, IW - 6, ID - 4), x + (i % 3) * IW + 3, y + row * ID + 2)
  })
  // a computer only where a worktree has its desk; a spare desk is just the desk
  if (!half) for (let i = 0; i < 3; i++) if (cells[i]) monitorBack(p, x + i * IW + MON_X, y + 2, staffed(cells[i]), t)
  for (let i = 0; i < 3; i++) {
    const cell = cells[half ? i : i + 3]
    const seat = staffed(cell)
    if (cell) monitorFront(p, x + i * IW + MON_X, y + row0 - 4, seat, t)
    if (cell) deskProp(p, x + i * IW, y + row0 + 5, cell.unit ?? cell.key)
    frontAgent(p, x + i * IW + HALF, y + row0 + 6, seat?.staff, t, seat && world.away(seat))
    kicks(seat)
  }
}

// ---- the hall ------------------------------------------------------------------------------------

function buildingWindow(p, artW, spineX) {
  p(0, 0, artW, WALL, '#dde5ea')
  // the brick building across the garden, with its white band and windows
  p(0, 8, artW, 10, '#dbc38f')
  for (let y = 9; y < 18; y += 2) p(0, y, artW, 1, '#ceb47f')
  p(0, 16, artW, 5, '#e8e8e3')
  for (let x = 8; x < artW; x += 24) p(x, 17, 12, 3, '#5d6670')
  // the garden: grasses, and a couple of birches turning yellow
  p(0, 21, artW, WALL - 21, '#9db07c')
  for (let i = 0; i < artW / 3; i++) {
    const h = hash(i * 6151)
    p(h % artW, 21 + ((h >>> 9) % (WALL - 24)), 1, 2 + ((h >>> 4) % 3), ['#c9b56a', '#7e9a5c', '#b08a52', '#d8c98a'][(h >>> 14) % 4])
  }
  for (const tx of [Math.round(artW * 0.2), Math.round(artW * 0.63)]) {
    p(tx, 5, 1, 18, '#f1f0ea')
    p(tx, 9, 1, 1, '#4b4a5e')
    p(tx, 15, 1, 1, '#4b4a5e')
    for (let i = 0; i < 26; i++) {
      const h = hash(tx * 97 + i)
      p(tx - 6 + (h % 13), 2 + ((h >>> 8) % 14), 2, 2, ['#d6c04a', '#9bb54c', '#e2b23c'][(h >>> 16) % 3])
    }
  }
  // the steel frame
  const FR = '#4d5a53'
  p(0, 0, artW, 1, FR)
  p(0, 13, artW, 1, FR)
  p(0, 24, artW, 1, FR)
  for (let x = 6; x < artW; x += 20) p(x, 0, 1, WALL - 3, FR)
  // concrete columns with their rusty edges, one over the walkway
  for (const [cx, cw] of [
    [0, 6],
    [spineX, 10],
    [artW - 6, 6]
  ]) {
    p(cx, 0, cw, WALL - 3, '#b4afa5')
    for (let i = 0; i < 6; i++) {
      const h = hash(cx * 13 + i)
      p(cx + 1 + (h % Math.max(1, cw - 2)), (h >>> 8) % (WALL - 4), 1, 1, '#9f998e')
    }
    p(cx, 0, 1, WALL - 3, '#c0632e')
    p(cx + cw - 1, 0, 1, WALL - 3, '#c0632e')
  }
  p(0, WALL - 3, artW, 3, '#8e9590')
  p(0, WALL, artW, 1, '#6f7672')
}

/** Polished concrete: soft blotches and a sheen from the windows. */
function concrete(p, w, y0, y1) {
  p(0, y0, w, y1 - y0, '#cbc7bf')
  const n = Math.floor((w * (y1 - y0)) / 280)
  for (let i = 0; i < n; i++) {
    const h = hash(i * 7919 + 3)
    const by = y0 + ((h >>> 9) % (y1 - y0))
    p(h % w, by, Math.min(6 + ((h >>> 3) % 16), w), Math.min(2 + ((h >>> 5) % 3), y1 - by), (h >>> 12) % 3 === 0 ? '#d8d5ce' : '#c1bdb4')
  }
  for (let i = 0; i < n / 12; i++) {
    const h = hash(i * 31337)
    p(h % w, y0 + ((h >>> 9) % (y1 - y0)), 18, 1, 'rgba(255,255,255,0.25)')
  }
}

/** The side walls, concrete with a rusty edge, and the front door in the left one. */
function walls(p, artW, h, doorY) {
  for (const x of [0, artW - OUTER]) {
    p(x, WALL, OUTER, h - WALL, '#b4afa5')
    p(x ? x : OUTER - 1, WALL, 1, h - WALL, '#c0632e')
  }
  p(0, h - 3, artW, 3, '#a39e94')
  p(0, doorY - 2, OUTER, 19, '#cbc7bf')
  p(0, doorY - 3, OUTER, 1, '#6f7672')
  p(0, doorY + 17, OUTER, 1, '#6f7672')
  p(OUTER, doorY + 1, 3, 14, '#5d6670')
}

function backCurtain(p, x0, w, floor) {
  const h = 26
  const top = floor - h
  for (let x = x0; x < x0 + w; x += 4) {
    p(x, top, 2, h, NAVY[1])
    p(x + 2, top, 1, h, NAVY[3])
    p(x + 3, top, 1, h, NAVY[2])
  }
  p(x0, top, w, 1, INK)
  p(x0, floor - 2, w, 1, NAVY[3])
  p(x0, floor, w, 2, 'rgba(25,22,45,0.18)')
}

function pillar(p, x, floor, h = 42) {
  shadow(p, x + 2, floor, 12, 3)
  ol(p, (q) => {
    q(x, floor - h - 3, 10, 3, '#cdc8be')
    q(x, floor - h, 10, h, '#b4afa5')
    for (let i = 0; i < 10; i++) {
      const hh = hash(x + i * 17)
      q(x + 1 + (hh % 8), floor - h + ((hh >>> 8) % h), 1, 1, '#9f998e')
    }
    q(x, floor - h, 1, h, '#c0632e')
    q(x + 9, floor - h, 1, h, '#c0632e')
    q(x + 1, floor - 12, 1, 6, '#d47a40')
    q(x + 8, floor - 30, 1, 9, '#d47a40')
    q(x + 4, floor - 16, 3, 7, '#23212b')
    q(x + 5, floor - 14, 1, 1, '#4b4a5e')
    q(x + 5, floor - 12, 1, 1, '#4b4a5e')
  })
}

function sign(p, x, y, w) {
  ol(p, (q) => {
    q(x, y, w, 9, '#23212b')
    q(x, y, w, 1, '#3d394c')
  })
}

// ---- the hangout's furniture ------------------------------------------------------------------

function rug(p, { x, y, w, h }) {
  p(x + 3, y, w - 6, h, '#d99aa3')
  p(x, y + 3, w, h - 6, '#d99aa3')
  p(x + 1, y + 1, w - 2, h - 2, '#d99aa3')
  p(x + 4, y + 2, w - 8, h - 4, '#e8b7bd')
  p(x + 2, y + 4, w - 4, h - 8, '#e8b7bd')
}

function sofa(p, { x, y, w }) {
  shadow(p, x - 2, y + 13, w + 6, 3)
  ol(p, (q) => {
    q(x - 3, y + 3, 3, 9, '#7f9468')
    q(x + w, y + 3, 3, 9, '#7f9468')
    q(x, y, w, 6, '#8fa37a')
    q(x, y, w, 1, '#a7b993')
    q(x, y + 6, w, 6, '#9fb08a')
    q(x + (w >> 1), y + 6, 1, 6, '#7f9468')
  })
}

function coffeeTable(p, { x, y }) {
  shadow(p, x + 1, y + 8, 24, 2)
  ol(p, (q) => {
    q(x, y, 24, 4, '#d4a670')
    q(x, y + 4, 24, 2, '#9c6d3e')
    q(x + 1, y + 6, 1, 2, '#6b4a2e')
    q(x + 22, y + 6, 1, 2, '#6b4a2e')
    q(x + 7, y + 1, 6, 2, '#e8e3d6')
    q(x + 16, y + 1, 2, 2, C.white)
  })
}

function counter(p, { x, y, w }, t) {
  shadow(p, x + 1, y + 15, w, 3)
  ol(p, (q) => {
    q(x, y, w, 4, '#ecebe6')
    q(x, y + 4, w, 11, '#7d9a8f')
    for (let i = 12; i < w; i += 12) {
      q(x + i, y + 5, 1, 9, '#5f7c72')
      q(x + i - 3, y + 8, 2, 1, '#eceef2')
    }
    q(x + w - 18, y + 1, 9, 2, '#a9b4c3')
  })
  // the coffee machine and two mugs on it
  ol(p, (q) => {
    q(x + 4, y - 9, 8, 9, '#3a3b46')
    q(x + 4, y - 9, 8, 2, '#55566a')
    q(x + 6, y - 6, 4, 2, '#1d1e26')
    q(x + 10, y - 8, 1, 1, t % 8 < 4 ? C.red : '#5a2028')
    q(x + 7, y - 3, 2, 2, C.white)
    q(x + 22, y - 3, 3, 3, C.white)
    q(x + 28, y - 3, 3, 3, '#e0533f')
  })
  if (t % 6 < 4) p(x + 7 + (t % 2), y - 5 - ((t >> 1) % 2), 1, 1, C.steam)
}

function fridge(p, { x, floor }) {
  shadow(p, x + 1, floor, 14, 3)
  ol(p, (q) => {
    q(x, floor - 30, 13, 30, '#eef0f3')
    q(x, floor - 19, 13, 1, '#c9ccd8')
    q(x + 10, floor - 27, 1, 5, '#9aa0b4')
    q(x + 10, floor - 16, 1, 6, '#9aa0b4')
  })
}

function cooler(p, { x, floor }, t) {
  shadow(p, x, floor, 8, 2)
  ol(p, (q) => {
    q(x + 1, floor - 16, 5, 6, '#8fd0f0')
    q(x + 2, floor - 16, 3, 1, '#c4ecfb')
    q(x + 2, floor - 14 + (t % 12 < 6 ? 0 : 1), 1, 1, '#e8f8ff')
    q(x, floor - 10, 7, 10, '#e9ebf2')
    q(x + 2, floor - 7, 1, 2, C.blue)
    q(x + 4, floor - 7, 1, 2, C.red)
  })
}

function foosball(p, { x, y }, t, playing) {
  shadow(p, x + 1, y + 18, 28, 2)
  ol(p, (q) => {
    q(x + 1, y + 12, 2, 6, '#6b4a2e')
    q(x + 25, y + 12, 2, 6, '#6b4a2e')
    q(x, y, 28, 12, '#9c6534')
    q(x + 1, y + 1, 26, 8, '#3f8f4a')
    q(x + 13, y + 1, 1, 8, '#cfe8d2')
    q(x, y + 9, 28, 3, '#7a4e28')
  })
  ;[5, 10, 17, 22].forEach((rx, i) => {
    p(x + rx, y - 2, 1, 13, '#b9bccb')
    p(x + rx, y - 3, 1, 1, INK)
    p(x + rx, y + 11, 1, 2, INK)
    const shift = playing ? ((t + i * 2) >> 1) % 3 - 1 : 0
    const c = i % 2 ? '#4f7cff' : '#ff5468'
    p(x + rx - 1, y + 2 + shift, 3, 2, c)
    p(x + rx - 1, y + 6 + shift, 3, 2, c)
  })
  if (playing) {
    const ph = t % 20
    p(x + 3 + Math.round((ph < 10 ? ph : 20 - ph) * 2.2), y + 4 + ((t >> 2) % 2), 1, 1, C.white)
  }
}

/** The mauve phone booth; its caller is drawn between its back and its glass door. */
function boothBack(p, { x, floor }) {
  shadow(p, x + 2, floor, 20, 3)
  ol(p, (q) => {
    q(x, floor - 38, 20, 3, '#c7a3aa')
    q(x, floor - 35, 20, 35, '#b8939a')
    q(x + 4, floor - 32, 12, 30, '#7d8f99')
  })
}
function boothGlass(p, { x, floor }) {
  p(x + 4, floor - 32, 12, 30, 'rgba(170, 210, 235, 0.25)')
  p(x + 5, floor - 31, 2, 12, 'rgba(255, 255, 255, 0.35)')
  p(x + 14, floor - 18, 1, 4, INK)
}

function tulip(p, { x, y }) {
  ol(p, (q) => {
    q(x, y, 7, 5, '#f4f2ec')
    q(x + 1, y + 5, 5, 2, '#e3e0d8')
    q(x + 3, y + 7, 1, 3, '#c9c6be')
    q(x + 1, y + 10, 5, 1, '#c9c6be')
  })
}

function roundTable(p, { x, y }) {
  shadow(p, x + 2, y + 11, 14, 2)
  ol(p, (q) => {
    q(x + 1, y, 14, 1, '#f4f2ec')
    q(x, y + 1, 16, 3, '#f4f2ec')
    q(x + 1, y + 4, 14, 1, '#dcd8cf')
    q(x + 7, y + 5, 2, 5, '#c9c6be')
    q(x + 4, y + 10, 8, 1, '#c9c6be')
  })
}

function barTable(p, { x, y }) {
  shadow(p, x + 6, y + 20, 18, 2)
  ol(p, (q) => {
    q(x, y, 28, 5, '#7a4a3e')
    q(x, y, 28, 1, '#946052')
    q(x, y + 5, 28, 2, '#4f2c27')
    q(x + 13, y + 7, 2, 12, '#2a2833')
    q(x + 8, y + 19, 12, 1, '#2a2833')
  })
}

function barStool(p, { x, y }) {
  shadow(p, x, y + 13, 7, 2)
  ol(p, (q) => {
    q(x, y, 7, 3, '#2a2833')
    q(x + 1, y, 5, 1, '#4b4a5e')
    q(x + 3, y + 3, 1, 10, '#2a2833')
    q(x + 1, y + 8, 5, 1, '#4b4a5e')
    q(x + 1, y + 13, 5, 1, '#2a2833')
  })
}

function plant(p, { x, y }, t = 0) {
  shadow(p, x, y + 15, 10, 2)
  if (festive()) return pine(p, x, y, t)
  ol(p, (q) => {
    q(x + 1, y + 9, 7, 6, '#b4643c')
    q(x + 1, y + 9, 7, 1, '#cf7a50')
    q(x, y + 1, 9, 8, '#4f9d5a')
    q(x + 2, y - 2, 5, 4, '#4f9d5a')
    q(x + 3, y + 2, 1, 5, '#3a7a45')
    q(x + 6, y, 1, 4, '#3a7a45')
  })
}

/** In season the plants are little pines in red pots, their baubles taking turns to light. */
function pine(p, x, y, t) {
  ol(p, (q) => {
    q(x + 1, y + 9, 7, 6, XMAS.santaDark)
    q(x + 1, y + 9, 7, 1, XMAS.santaRed)
    q(x, y + 4, 9, 5, XMAS.pineDark)
    q(x + 1, y + 1, 7, 4, XMAS.pineMid)
    q(x + 3, y - 2, 3, 4, XMAS.pineLight)
  })
  p(x + 4, y - 3, 1, 1, XMAS.starGold)
  const on = (t >> 2) % 2
  p(x + 1, y + 6, 1, 1, on ? XMAS.ornamentRed : XMAS.ornamentGold)
  p(x + 7, y + 5, 1, 1, on ? XMAS.ornamentBlue : XMAS.ornamentRed)
  p(x + 4, y + 2, 1, 1, on ? XMAS.ornamentGold : XMAS.ornamentBlue)
}

// Little things on desks, each standing on the desk from row y upward, at most six pixels wide.
const PROPS = {
  bear(q, x, y) {
    q(x, y - 4, 4, 4, '#7a4a2e')
    q(x, y - 5, 1, 1, '#7a4a2e')
    q(x + 3, y - 5, 1, 1, '#7a4a2e')
    q(x + 1, y - 2, 2, 1, '#f3f2ef')
  },
  locker(q, x, y) {
    q(x, y - 12, 6, 12, '#9fcbe8')
    q(x + 1, y - 10, 4, 1, '#6f9fc4')
    q(x + 1, y - 8, 4, 1, '#6f9fc4')
    q(x + 4, y - 5, 1, 2, '#6f9fc4')
  },
  card(q, x, y) {
    q(x, y - 4, 3, 4, '#f6c6d4')
    q(x + 1, y - 3, 1, 1, '#e0533f')
  },
  plantFace(q, x, y) {
    q(x, y - 5, 5, 5, '#f29a3a')
    q(x + 1, y - 3, 1, 1, INK)
    q(x + 3, y - 3, 1, 1, INK)
    q(x, y - 8, 2, 3, '#4f9d5a')
    q(x + 3, y - 8, 2, 3, '#4f9d5a')
    q(x + 2, y - 9, 1, 4, '#3a7a45')
  },
  mug(q, x, y) {
    q(x, y - 3, 3, 3, C.white)
    q(x + 3, y - 2, 1, 1, C.white)
  },
  lamp(q, x, y) {
    q(x, y - 1, 6, 1, '#4b4a5e')
    q(x + 2, y - 6, 1, 5, '#4b4a5e')
    q(x, y - 9, 6, 3, '#4f9d8f')
    q(x + 1, y - 6, 4, 1, '#f6e7a1')
  },
  cactus(q, x, y) {
    q(x, y - 3, 4, 3, '#d9d4c8')
    q(x + 1, y - 7, 2, 4, '#5f9a52')
    q(x, y - 6, 1, 2, '#5f9a52')
    q(x + 3, y - 5, 1, 2, '#5f9a52')
  },
  luckyCat(q, x, y) {
    q(x, y - 5, 5, 5, '#f6f4ee')
    q(x, y - 6, 1, 1, '#f6f4ee')
    q(x + 4, y - 6, 1, 1, '#f6f4ee')
    q(x + 1, y - 4, 1, 1, INK)
    q(x + 3, y - 4, 1, 1, INK)
    q(x + 1, y - 2, 3, 1, '#e0533f')
  }
}
const PROP_NAMES = Object.keys(PROPS)

/** About one front-row desk in three has a little thing on a corner beside the monitor. */
function deskProp(p, cellX, surface, key) {
  const roll = hashText(`${key}|prop`)
  if (roll % 100 >= 35) return
  const name = PROP_NAMES[(roll >>> 8) % PROP_NAMES.length]
  const x = (roll >>> 16) % 2 ? cellX + 2 : cellX + IW - 8
  // in season about half of these are a little present instead
  if (festive() && (roll >>> 20) % 2) return ol(p, (q) => present(q, x, surface, 5, 4, XMAS.santaRed, XMAS.starGold))
  ol(p, (q) => PROPS[name](q, x, surface))
}

/** A wrapped present w x h standing on row `base`, its ribbon both ways and a bow on top. */
function present(q, x, base, w, h, box, ribbon) {
  const mid = x + (w >> 1)
  q(x, base - h, w, h, box)
  q(mid, base - h, 1, h, ribbon)
  q(x, base - h + (h >> 1), w, 1, ribbon)
  q(mid - 1, base - h - 1, 3, 1, ribbon)
}

/** A slim yellow drawer block, maybe with a tiny retro computer, a plant or books on top. */
function drawers(p, { x, base, h, top }, t) {
  const y = base - h
  shadow(p, x + 1, base, DRAWER_W, 2)
  ol(p, (q) => {
    q(x, y, DRAWER_W, 4, '#f2cf55')
    q(x, y + 4, DRAWER_W, h - 4, '#e3b52e')
    for (let dy = 10; dy < h; dy += 7) q(x, y + dy, DRAWER_W, 1, '#a87e14')
    for (let dy = 6; dy < h - 2; dy += 7) q(x + 4, y + dy, 4, 1, '#eceef2')
  })
  if (top === 'retro') {
    ol(p, (q) => {
      q(x + 2, y - 6, 8, 6, '#eee9da')
      q(x + 3, y - 5, 6, 3, '#2f3440')
      q(x + 4, y - 4, 2, 1, (t >> 2) % 2 ? C.green : '#2f3440')
    })
  } else if (top === 'plant') {
    ol(p, (q) => {
      q(x + 3, y - 4, 6, 4, '#f29a3a')
      q(x + 4, y - 3, 1, 1, INK)
      q(x + 7, y - 3, 1, 1, INK)
      q(x + 3, y - 7, 2, 3, '#4f9d5a')
      q(x + 7, y - 7, 2, 3, '#4f9d5a')
      q(x + 5, y - 8, 2, 4, '#3a7a45')
    })
  } else if (!top && festive()) {
    // in season a bare drawer block gets a little stack of presents
    ol(p, (q) => {
      present(q, x + 1, y, 9, 5, XMAS.santaRed, XMAS.starGold)
      present(q, x + 3, y - 6, 6, 4, XMAS.elfGreen, C.white)
    })
  } else if (top === 'books') {
    ol(p, (q) => {
      q(x + 2, y - 2, 8, 2, '#4f7cff')
      q(x + 3, y - 4, 7, 2, '#f2b134')
      q(x + 2, y - 5, 5, 1, '#c4453c')
    })
  }
}

function dogBed(p, { x, y }) {
  ol(p, (q) => {
    q(x, y + 1, 24, 8, '#8a5a3c')
    q(x + 2, y + 3, 20, 5, '#d29a6c')
  })
}

/** What each piece of hangout furniture covers on screen, from its floor row up. */
function thingBase(t) {
  switch (t.kind) {
    case 'booth':
    case 'fridge':
    case 'cooler':
      return t.floor
    case 'counter':
      return t.y + 15
    case 'sofa':
      return t.y + 13
    case 'coffeeTable':
      return t.y + 8
    case 'roundTable':
    case 'tulip':
      return t.y + 11
    case 'foosball':
      return t.y + 18
    case 'barTable':
      return t.y + 20
    case 'barStool':
      return t.y + 14
    case 'plant':
      return t.y + 15
    case 'tree':
      return t.y + 21
    default:
      return t.y
  }
}

// ---- drawing the whole office -----------------------------------------------------------------

const backgrounds = new Map() // floor geometry -> the hall's static floor and walls, painted once

function background(layout) {
  const { artW, building } = layout
  const key = JSON.stringify([artW, building.h, building.doorY, building.spineX, layout.common.bed, layout.common.things.filter((t) => t.kind === 'rug')])
  let canvas = backgrounds.get(key)
  if (canvas) return canvas
  canvas = new OffscreenCanvas(artW, building.h)
  const g = canvas.getContext('2d')
  const p = (x, y, w, h, c) => {
    g.fillStyle = c
    g.fillRect(x, y, w, h)
  }
  buildingWindow(p, artW, building.spineX)
  concrete(p, artW, WALL + 1, building.h)
  walls(p, artW, building.h, building.doorY)
  for (const t of layout.common.things) if (t.kind === 'rug') rug(p, t)
  dogBed(p, layout.common.bed)
  if (backgrounds.size > 6) backgrounds.clear()
  backgrounds.set(key, canvas)
  return canvas
}

/**
 * Draws the office. `world` is the panel's live state: `tick`; `away(seat)`, whether the agent is
 * up and about; `seatedAt(seat)`, the specialists on its stools; `people`, everyone standing or
 * walking, each with `{ key, x, y, base, kind, paint(p) }`; `palu`, his box and a painter; and
 * `drawText` for the signs and nameplates at screen resolution.
 */
export function drawLoft(ctx, layout, world) {
  const p = (x, y, w, h, c) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, w, h)
  }
  const t = world.tick
  ctx.drawImage(background(layout), 0, 0)
  if (festive()) season(p, layout, t)
  const c = layout.common
  const scene = []
  // the room signs on the window, for the first row of rooms
  for (const room of layout.rooms) if (room.first) sign(p, room.x + 4, 2, signW(room))
  for (const room of layout.rooms) for (const isl of room.islands) scene.push({ base: isl.y + (isl.half ? 0 : ID) + 34, paint: () => island(p, ctx, isl, world) })
  layout.lines.forEach((line) => {
    scene.push({
      base: line,
      paint: () => {
        for (const [sx, w] of curtainSegments(layout)) {
          backCurtain(p, sx, w, line)
          if (festive()) holidayLights(at(p, sx, line - 27), w, t)
        }
        pillar(p, layout.building.spineX, line + 2)
        for (const room of layout.rooms) if (room.y === line) sign(p, room.x + 4, line - 25, signW(room))
      }
    })
  })
  // in season the hangout's big tree, or its first plant when there is no room for one
  const bigPlant = c.things.some((th) => th.kind === 'tree') ? null : c.things.find((th) => th.kind === 'plant')
  const bigTree = (x, y) => ol(p, (q) => christmasTree(at(q, x, y), t))
  const playing = world.people.filter((m) => m.kind === 'foosball').length >= 2
  const callers = new Map(world.people.filter((m) => m.kind === 'booth').map((m) => [m.spot.bx, m]))
  for (const thing of c.things) {
    const base = thingBase(thing)
    const paint = {
      booth: () => {
        boothBack(p, thing)
        callers.get(thing.x)?.paint(p)
        boothGlass(p, thing)
      },
      counter: () => counter(p, thing, t),
      fridge: () => fridge(p, thing),
      cooler: () => cooler(p, thing, t),
      sofa: () => sofa(p, thing),
      coffeeTable: () => coffeeTable(p, thing),
      tulip: () => {
        if (!world.sittersAt?.has(thing)) tulip(p, thing)
      },
      roundTable: () => roundTable(p, thing),
      foosball: () => foosball(p, thing, t, playing),
      barTable: () => barTable(p, thing),
      barStool: () => barStool(p, thing),
      plant: () => (festive() && thing === bigPlant ? bigTree(thing.x - 3, thing.y - 6) : plant(p, thing, t)),
      tree: () => festive() && bigTree(thing.x, thing.y)
    }[thing.kind]
    if (paint) scene.push({ base, paint })
  }
  scene.push({ base: c.bowls.y + 4, paint: () => world.bowls(p, c.bowls) })
  for (const room of layout.rooms) for (const d of room.drawers ?? []) scene.push({ base: d.base, paint: () => drawers(p, d, t) })
  for (const m of world.people) if (m.kind !== 'booth') scene.push({ base: m.base, paint: () => m.paint(p) })
  if (world.palu) scene.push({ base: world.palu.base - 0.5, paint: () => world.palu.paint(p) })
  scene.sort((a, b) => a.base - b.base)
  // `view` is the band of floor rows the panel shows; a thing standing well outside it cannot
  // reach into it, so a big office only paints what is on screen
  const { view } = world
  for (const item of scene) if (!view || (item.base > view.y0 - 8 && item.base < view.y1 + 90)) item.paint()

  const s = layout.scale
  // a sign or nameplate is a line of text around its row: one well off screen is not measured
  const shown = (y, bottom = y) => !view || (bottom > view.y0 - 12 && y < view.y1 + 12)
  for (const room of layout.rooms) {
    const y = room.first ? 2 : room.y - 25
    if (shown(y + 5)) world.drawText(room.name, (room.x + 8) * s, (y + 5) * s, (signW(room) - 6) * s, C.white, { weight: 700 })
  }
  const size = Math.max(9, Math.min(12, Math.round(s * 3.4)))
  for (const seat of layout.seats) {
    if (!shown(seat.island.y + (seat.front ? seat.row0 + 25 : 5))) continue
    const label = world.nameplate(seat)
    // a chip sized to the label, never wider than the desk: on the back of a front-row chair, which
    // stays put while its agent is on a break, and on the back of a back-row monitor
    const maxW = (IW - 3) * s
    if (seat.front) world.drawText(label, seat.cx * s, (seat.island.y + seat.row0 + 25) * s, maxW, '#e4e8f2', { align: 'center', size, chip: '#2f3a52' })
    else world.drawText(label, seat.cx * s, (seat.island.y + 5) * s, maxW, '#23212b', { align: 'center', size, chip: '#f1efe8' })
  }
  for (const room of layout.rooms) {
    for (const isl of room.islands) {
      if (!shown(isl.y - 10, isl.y + ID * 2 + 25)) continue
      // two small teams in one room: each island carries its team's name
      if (isl.team) world.drawText(isl.team, (isl.x + 1) * s, (isl.y - 10) * s, ISL_W * s, C.white, { weight: 700, size, chip: '#23212b' })
      // a sleeping worktree's desk keeps its nameplate, dimmed
      for (const cell of isl.cells) {
        if (!cell?.vacant) continue
        const maxW = (IW - 3) * s
        if (cell.front) world.drawText(cell.label, cell.cx * s, (isl.y + cell.row0 + 25) * s, maxW, '#9aa0b4', { align: 'center', size, chip: '#3a3f4f' })
        else world.drawText(cell.label, cell.cx * s, (isl.y + 5) * s, maxW, '#6b6a75', { align: 'center', size, chip: '#d9d6cf' })
      }
    }
  }
}

/** Christmas over the hall: lights along the window ledge, snow falling past the steel frames and a
 * red door with a green band, all drawn live over the painted-once background. */
function season(p, layout, t) {
  const { artW, building } = layout
  for (let i = 0; i < artW / 9; i++) {
    const h = hash(i * 4513 + 7)
    const fall = (t + ((h >>> 6) % 40)) % (WALL - 4)
    p((h % artW) + (((t >> 2) + i) % 3) - 1, 1 + fall, 1, 1, C.white)
  }
  holidayLights(at(p, 0, WALL - 5), artW, t)
  p(OUTER, building.doorY + 1, 3, 14, '#b4202a')
  p(OUTER + 1, building.doorY + 3, 1, 10, '#238547')
}

function signW(room) {
  return Math.min(room.w - 10, room.name.length * 4 + 14)
}

/**
 * Someone on a tulip chair at the round table: behind the table facing you, or in front of it with
 * their back to you. Whoever has the word shows three little dots over their head.
 */
export function sitting(p, chair, staff, t, talking) {
  const { skin, hair, shirt, costume } = look(staff.id || 'x')
  const x = chair.x
  const y = chair.y
  const facing = chair.facing
  const nod = talking && (t >> 1) % 2 ? 1 : 0
  if (facing) tulip(p, chair)
  ol(p, (q) => {
    q(x, y - 1, 7, 6, shirt)
    q(x + 1, y - 8 + nod, 5, 2, hair)
    q(x + 1, y - 6 + nod, 5, 5, facing ? skin : hair)
    if (facing) {
      q(x + 2, y - 4 + nod, 1, 1, INK)
      q(x + 4, y - 4 + nod, 1, 1, INK)
      q(x - 1, y + 1, 2, 1, skin)
      q(x + 6, y + 1, 2, 1, skin)
    }
    if (festive()) {
      cap(q, x + 1, y - 8 + nod, costume)
      if (staff?.isLeader) crown(q, x + 1, y - 10 + nod)
    } else if (staff?.isLeader) {
      crown(q, x + 1, y - 10 + nod)
    }
  })
  if (!facing) tulip(p, chair)
  if (talking) {
    // a little speech bubble, its dots typing out
    ol(p, (q) => {
      q(x - 1, y - 16, 9, 5, C.white)
      q(x + 1, y - 11, 2, 1, C.white)
    })
    const dots = 1 + ((t >> 2) % 3)
    for (let i = 0; i < dots; i++) p(x + 1 + i * 2, y - 14, 1, 1, INK)
  }
}

/** Draws a Brick sprite (from sprites.js, painted from its own corner) with the outline pass. */
export function outlinedAt(p, x, y, sprite) {
  ol(p, (q) => sprite(at(q, x, y)))
}

/** Someone standing or walking about: the Brick walker, outlined. */
export function standing(p, x, y, staff, t, moving, left, badge, pose) {
  outlinedAt(p, x, y, (q) => walker(q, staff, t, moving, left, badge, pose))
}

/** Someone on the sofa: the Brick lounger, outlined. */
export function lounging(p, x, y, staff, t, pose) {
  outlinedAt(p, x, y, (q) => lounger(q, staff, t, pose))
}
