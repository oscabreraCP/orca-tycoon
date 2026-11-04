// Orca Tycoon: every agent on this Orca host as a little pixel worker on one office floor.
// Each project is an open area on the floor; every worktree in it is a seat at a shared desk, with a
// worktree's children seated next to it. Subagents are specialists: they come in through the
// front door, sit on a stool at the end of their agent's desk, and leave the same way.
// The worker answers 'office.snapshot' from `orca worktree ps`; this frame polls it every 3 s
// (the rate Orca's own phone app polls at).
//
// One canvas, never rebuilt: a poll swaps the data and the next frame draws it, so a refresh
// never blanks the screen.

import {
  C,
  SEAT_H,
  SEAT_W,
  STATE_LABEL,
  bookshelf,
  booth,
  boothGlass,
  coffeeMachine,
  desk,
  foosball,
  kitchen,
  lounger,
  lounge,
  painter,
  person,
  pick,
  roleColor,
  specialist,
  stool,
  plant,
  walker,
  waterCooler,
  whiteboard,
  workstation
} from './sprites.js'

const POLL_MS = 3000
const FRAME_MS = 125
const BUBBLE_MS = 9000

// Geometry, in art pixels.
const OUTER = 4 // building wall
const MARGIN = 6 // floor between the building wall and the rooms
const GAP = 7 // corridor between rooms
const GLASS = 0 // open areas: no walls
const PAD = 4 // inside a room, between the glass and its furniture
const TOP = 13 // room name plaque and whiteboard
const LABEL_H = 5 // nameplate under each seat
const AISLE = 7 // walkway below each row of desks
const DESK_W = SEAT_W + 4 // one agent's desk
const STOOL_W = 9 // one stool at the end of a desk
const MAX_STOOLS = 3 // beyond this a desk shows +N
const LINE_H = SEAT_H + LABEL_H + AISLE
const TABLE_GAP = 6
const MIN_ROOM_W = (DESK_W + STOOL_W + 1) * 2 + PAD * 2 + GLASS * 2
const COMMON_H = 34
const WALK_SPEED = 1.5 // art pixels per frame
// States in which an agent leaves its desk for the coffee corner until the state ends.
// 'monitoring' is a finished turn waiting on background tasks; add 'waiting' to also send
// agents that wait for you.
const AWAY_STATES = new Set(['monitoring'])
// What an agent on a break can do. Every minute each one draws an activity (weighted, seeded by the
// agent and the minute, so a reopened panel shows the same picture); a full place passes to the next.
const ACTIVITIES = [
  { id: 'nap', kind: 'lounge', pose: 'nap', weight: 1.5, sleepyOnly: true },
  { id: 'sofa-coffee', kind: 'lounge', pose: 'coffee', weight: 1.5 },
  { id: 'read', kind: 'lounge', pose: 'read', weight: 1.5 },
  { id: 'coffee', kind: 'coffee', weight: 2 },
  { id: 'foosball', kind: 'foosball', weight: 3 },
  { id: 'call', kind: 'booth', weight: 2 }
]
const ACTIVITY_MS = 60000
// States in which an agent goes and naps on the lounge sofa, while there are seats.
const LOUNGE_STATES = new Set(['done', 'idle'])

const FLOOR = { plank: '#d9c8a4', seam: '#c9b78f', joint: '#bba97f' }
const BRICK = { wall: '#b5653f', top: '#cf7a50', dark: '#8f4b2d', window: '#a8d2e6' }
const CARPETS = ['#a98260', '#7f9b74', '#8d7f9c', '#7d8ba6', '#a8936f', '#9c7575', '#6f9a99']
const STATE_NOTE = {
  working: C.green,
  monitoring: C.blue,
  waiting: C.amber,
  blocked: C.red,
  done: '#9aa0b4',
  idle: '#9aa0b4'
}

const canvas = document.getElementById('plan')
const ctx = canvas.getContext('2d')

let snapshot = null
let layout = { artW: 0, artH: 0, scale: 3, building: null, rooms: [], seats: [], common: null }
let selected = null // seat key
let tick = 0
const lastState = new Map() // seat key -> state, to pop a bubble when it changes
const bubbles = new Map() // seat key -> { text, until }
const walkers = new Map() // seat key -> { x, y, path, mode: 'out' | 'away' | 'back' }
const visitors = new Map() // specialist key -> { spec, x, y, path, mode: 'in' | 'seated' | 'out' }
// False until the first snapshot has been placed. Whatever that snapshot shows is already true when
// the panel opens, so it is drawn in place; only changes seen after it are walked.
let scenePrimed = false
let primed = false

function since(ms) {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.round(m / 60)}h`
}

/** The short name on a seat's nameplate: the ticket key when there is one. */
function shortName(desk) {
  const key = desk.name.match(/[A-Z]{2,6}-\d+/)
  if (key) return key[0]
  return desk.name.split(/[\s/]+/)[0]
}

// ---- layout ----------------------------------------------------------------------------------

/** Root worktrees, each with all its descendants, so a family shares one desk. */
function families(desks) {
  const byId = new Map(desks.map((d) => [d.id, d]))
  const kids = new Map()
  const roots = []
  for (const d of desks) {
    if (d.parentId && byId.has(d.parentId)) {
      const list = kids.get(d.parentId) ?? []
      list.push(d)
      kids.set(d.parentId, list)
    } else roots.push(d)
  }
  const byName = (a, b) => a.name.localeCompare(b.name)
  const descend = (d) => [d, ...(kids.get(d.id) ?? []).sort(byName).flatMap(descend)]
  return roots.sort(byName).map(descend)
}

/** The seats of one family, parent first: one per agent in each worktree. */
function familySeats(family) {
  return family.flatMap((desk) =>
    [...desk.staff].sort((a, b) => a.id.localeCompare(b.id)).map((staff) => ({ desk, staff }))
  )
}

/** Specialists still at work: done ones have left. */
function activeSpecialists(staff) {
  return staff.specialists.filter((sp) => sp.state !== 'done' && sp.state !== 'idle').sort((a, b) => a.id.localeCompare(b.id))
}

/** An agent's desk plus its stools: always one free stool, up to MAX_STOOLS. */
function stoolCount(staff) {
  return Math.max(1, Math.min(MAX_STOOLS, activeSpecialists(staff).length))
}

function segmentW(seat) {
  return DESK_W + stoolCount(seat.staff) * STOOL_W + 1
}

/** Splits families into tables no wider than the room, then packs tables into lines. */
function planRoom(floor, innerW) {
  const tables = []
  for (const family of families(floor.desks)) {
    let table = []
    let width = 0
    for (const seat of familySeats(family)) {
      const w = segmentW(seat)
      if (table.length && width + w > innerW) {
        tables.push(table)
        table = []
        width = 0
      }
      table.push(seat)
      width += w
    }
    if (table.length) tables.push(table)
  }
  const tableW = (table) => table.reduce((n, seat) => n + segmentW(seat), 0)
  const lines = []
  let line = []
  let width = 0
  for (const table of tables) {
    const w = tableW(table)
    if (line.length && width + TABLE_GAP + w > innerW) {
      lines.push(line)
      line = []
      width = 0
    }
    width += (line.length ? TABLE_GAP : 0) + w
    line.push(table)
  }
  if (line.length) lines.push(line)
  return { lines, tableW }
}

function computeLayout() {
  const cssW = Math.max(180, document.getElementById('office').clientWidth)
  const scale = cssW >= 300 ? 3 : 2
  const artW = Math.floor(cssW / scale)
  const floorW = artW - OUTER * 2 - MARGIN * 2
  const cols = Math.max(1, Math.floor((floorW + GAP) / (MIN_ROOM_W + GAP)))
  const roomW = Math.floor((floorW - GAP * (cols - 1)) / cols)
  const innerW = roomW - GLASS * 2 - PAD * 2

  // Plan every area first, so the commons band can go where it splits the floor in two.
  // A team that would need three or more rows of desks in one column gets the whole floor width
  // instead, so it spreads across rather than down. Biggest teams go first.
  const fullInner = floorW - GLASS * 2 - PAD * 2
  const seatCount = (floor) => floor.desks.reduce((n, d) => n + d.staff.length, 0)
  const plans = (snapshot?.floors ?? [])
    .map((floor) => {
      let plan = { ...planRoom(floor, innerW), w: roomW, inner: innerW, wide: false }
      if (cols > 1 && plan.lines.length >= 3) plan = { ...planRoom(floor, fullInner), w: floorW, inner: fullInner, wide: true }
      return { floor, ...plan, h: TOP + plan.lines.length * LINE_H + PAD }
    })
    .sort((a, b) => seatCount(b.floor) - seatCount(a.floor) || a.floor.repo.localeCompare(b.floor.repo))
  // Open areas need not line up: each one goes into the column that is shortest so far, and a
  // full-width team starts below everything placed before it.
  const pack = (list, top) => {
    const colY = Array.from({ length: cols }, () => top)
    const placed = list.map((plan) => {
      if (plan.wide) {
        const y = Math.max(...colY)
        colY.fill(y + plan.h + GAP)
        return { plan, x: OUTER + MARGIN, y }
      }
      const col = colY.indexOf(Math.min(...colY))
      const at = { plan, x: OUTER + MARGIN + col * (roomW + GAP), y: colY[col] }
      colY[col] += plan.h + GAP
      return at
    })
    return { placed, bottom: Math.max(...colY) }
  }
  // Split the areas so the band lands as close to the middle as it can.
  let split = plans.length
  let best = Infinity
  for (let k = 1; k <= plans.length; k++) {
    const above = pack(plans.slice(0, k), 0).bottom
    const below = pack(plans.slice(k), 0).bottom
    if (Math.abs(above - below) < best) {
      best = Math.abs(above - below)
      split = k
    }
  }
  const top = pack(plans.slice(0, split), OUTER + MARGIN)

  // The commons band across the middle: lounge, coffee corner (water dispenser, coffee machine)
  // and kitchen. Wide floors put them side by side; narrow ones stack the lounge above.
  const wide = floorW >= 150
  const bandY = plans.length ? top.bottom : OUTER + MARGIN
  const rows = wide ? 2 : 3
  const bandH = COMMON_H * rows
  const gamesY = bandY + COMMON_H * (rows - 1)
  const entry = 10 // a clear strip by the door
  const common = { x: OUTER + MARGIN, y: bandY, w: floorW, h: bandH }
  const loungeW = wide ? Math.floor((floorW - GAP) / 2) - entry : floorW - entry
  const cornerX = wide ? common.x + entry + loungeW + GAP : common.x + entry
  const cornerY = wide ? bandY : bandY + COMMON_H
  common.lounge = { x: common.x + entry, y: bandY + 4, w: loungeW }
  common.cooler = { x: cornerX + 2, y: cornerY + 2 }
  common.coffee = { x: cornerX + 12, y: cornerY + 4 }
  common.kitchen = { x: cornerX + 24, y: cornerY + 6, w: Math.max(30, common.x + floorW - cornerX - 24) }
  common.laneTop = bandY - 4
  common.laneBottom = bandY + bandH - 8
  common.hallY = common.laneTop
  common.spots = []
  for (let sx = cornerX; sx + 8 <= common.x + floorW; sx += 9) common.spots.push({ x: sx, y: cornerY + 17, kind: 'coffee' })
  // the games row: a foosball table, and calling booths along the right
  const fx = common.x + entry + 12
  common.foosball = { x: fx, y: gamesY + 10 }
  common.foos = [
    { x: fx - 9, y: gamesY + 8, kind: 'foosball', left: false },
    { x: fx + 29, y: gamesY + 8, kind: 'foosball', left: true }
  ]
  common.booths = []
  const boothCount = wide ? 3 : 2
  for (let i = 0; i < boothCount; i++) {
    const bx = common.x + floorW - (i + 1) * 16
    common.booths.push({ x: bx + 2, y: gamesY + 9, kind: 'booth', left: true, bx, by: gamesY + 5 })
  }
  common.sofa = []
  const sofaSeats = Math.min(6, Math.floor((loungeW - 12) / 9))
  for (let i = 0; i < sofaSeats; i++) common.sofa.push({ x: common.lounge.x + 6 + i * 9, y: common.lounge.y + 1, kind: 'lounge' })
  // The front door is in the left wall, level with the band.
  const doorY = bandY + 8

  const bottom = pack(plans.slice(split), bandY + bandH + GAP)
  const rooms = []
  const seats = []
  for (const { plan, x, y: ry } of [...top.placed, ...bottom.placed]) {
    const { floor, lines, tableW, h } = plan
    const room = { x, y: ry, w: plan.w, h, name: floor.repo, carpet: pick(CARPETS, floor.repo), notes: [] }
    room.lane = ry < bandY ? common.laneTop : common.laneBottom
    lines.forEach((line, li) => {
      const lineW = line.reduce((n, t) => n + tableW(t), 0) + TABLE_GAP * (line.length - 1)
      let tx = room.x + GLASS + PAD + Math.floor((plan.inner - lineW) / 2)
      const ty = room.y + TOP + li * LINE_H
      for (const table of line) {
        for (const { desk: d, staff } of table) {
          const n = stoolCount(staff)
          const stools = Array.from({ length: n }, (_, i) => ({ x: tx + DESK_W + 1 + i * STOOL_W, y: ty + 19 }))
          const overflow = Math.max(0, activeSpecialists(staff).length - MAX_STOOLS)
          seats.push({ key: `${d.id}|${staff.id}`, x: tx + 2, y: ty, desk: d, staff, room, stools, overflow })
          room.notes.push(STATE_NOTE[staff.state])
          tx += DESK_W + n * STOOL_W + 1
        }
        tx += TABLE_GAP
      }
    })
    rooms.push(room)
  }
  const y = Math.max(bottom.bottom, bandY + bandH + GAP) - GAP + MARGIN
  const building = { w: artW, h: y + OUTER, doorY }
  return { artW, artH: building.h, scale, building, rooms, seats, common }
}

function resize() {
  layout = computeLayout()
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(layout.artW * layout.scale * dpr)
  const h = Math.round(layout.artH * layout.scale * dpr)
  // Only touch the size when it changes: assigning it clears the canvas.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    canvas.style.width = `${layout.artW * layout.scale}px`
    canvas.style.height = `${layout.artH * layout.scale}px`
  }
  draw()
}

// ---- drawing ---------------------------------------------------------------------------------

function artTransform() {
  const k = layout.scale * (window.devicePixelRatio || 1)
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.imageSmoothingEnabled = false
}

function cssTransform() {
  const d = window.devicePixelRatio || 1
  ctx.setTransform(d, 0, 0, d, 0, 0)
}

function drawBuilding(p) {
  const { w, h } = layout.building
  p(0, 0, w, h, BRICK.wall)
  p(0, 0, w, 1, BRICK.top)
  p(0, h - 1, w, 1, BRICK.dark)
  // floorboards
  p(OUTER, OUTER, w - OUTER * 2, h - OUTER * 2, FLOOR.plank)
  for (let y = OUTER + 3; y < h - OUTER; y += 4) {
    p(OUTER, y, w - OUTER * 2, 1, FLOOR.seam)
    const offset = ((y >> 2) * 13) % 24
    for (let x = OUTER + offset; x < w - OUTER; x += 24) p(x, y - 3, 1, 3, FLOOR.joint)
  }
  // front door in the left wall, level with the commons band, with a doormat
  const dy = layout.building.doorY
  p(0, dy - 2, OUTER, 19, FLOOR.plank)
  p(0, dy - 3, OUTER, 1, BRICK.dark)
  p(0, dy + 17, OUTER, 1, BRICK.dark)
  p(OUTER, dy + 1, 3, 14, '#7a4f3a')
  // windows in the top wall, light falling in
  for (let x = 14; x + 12 < w - 8; x += 40) {
    p(x, 0, 12, 3, BRICK.window)
    p(x + 5, 0, 1, 3, '#dceff7')
  }
}

function drawRoom(p, room) {
  const { x, y, w, h } = room
  // An area rug with rounded corners and a darker rim, so the zone reads without walls.
  p(x + 2, y, w - 4, h, room.carpet)
  p(x, y + 2, w, h - 4, room.carpet)
  p(x + 1, y + 1, w - 2, h - 2, room.carpet)
  p(x + 3, y + 2, w - 6, 1, 'rgba(255,255,255,0.10)')
  p(x + 2, y + h - 1, w - 4, 1, 'rgba(0,0,0,0.18)')
  p(x + w - 1, y + 2, 1, h - 4, 'rgba(0,0,0,0.12)')
  // speckle so the carpet reads as fabric
  for (let i = 0; i < (w * h) / 40; i++) {
    const sx = x + 2 + ((i * 37) % (w - 4))
    const sy = y + 2 + ((i * 53) % (h - 4))
    p(sx, sy, 1, 1, 'rgba(255,255,255,0.08)')
  }
  // name plaque, whiteboard of sticky notes, a plant, a bookshelf
  p(x + 3, y + 3, Math.min(w - 40, 56), 7, '#2a2633')
  const boardW = Math.min(26, w - 70)
  if (boardW > 8) whiteboard(painter(ctx, x + w - boardW - 4, y + 3), boardW, room.notes)
  plant(painter(ctx, x + 3, y + h - 11))
  if (w > 90 && h > 50) bookshelf(painter(ctx, x + w - 15, y + h - 12))
}

function drawCommon() {
  const c = layout.common
  if (!c) return
  lounge(painter(ctx, c.lounge.x, c.lounge.y), c.lounge.w)
  kitchen(painter(ctx, c.kitchen.x, c.kitchen.y), c.kitchen.w)
  for (const b of c.booths) booth(painter(ctx, b.bx, b.by))
  const playing = [...walkers.values()].filter((w) => w.mode === 'away' && w.activity?.kind === 'foosball').length >= 2
  foosball(painter(ctx, c.foosball.x, c.foosball.y), tick, playing)
  waterCooler(painter(ctx, c.cooler.x, c.cooler.y), tick)
  coffeeMachine(painter(ctx, c.coffee.x, c.coffee.y), tick)
}

// ---- walking to the coffee corner ------------------------------------------------------------

/** Where an agent stands when it gets up: the aisle in front of its seat. */
function homeOf(seat) {
  return { x: seat.x + 6, y: seat.y + SEAT_H + LABEL_H - 4 }
}

/** Along the area's aisle to the corridor beside it, to the band's lane, across to the spot. */
function route(seat, spot) {
  const home = homeOf(seat)
  const lane = seat.room.lane
  const sideX = sideOf(seat, spot.x)
  return [home, { x: sideX, y: home.y }, { x: sideX, y: lane }, { x: spot.x, y: lane }, { x: spot.x, y: spot.y }]
}

function hashOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  // FNV alone barely moves when only the last character differs; mix the bits so draws are independent
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const activityOf = new Map() // seat key -> activity id, for drawing the right pose

/** This minute's spot for every agent on a break, by weighted draw; full places pass on. */
function assignBreaks(common) {
  const minute = Math.floor(Date.now() / ACTIVITY_MS)
  const free = {
    lounge: [...common.sofa],
    coffee: [...common.spots],
    foosball: [...common.foos],
    booth: [...common.booths]
  }
  // A fresh picking order every minute, so the sofa is not always taken by the same people.
  const onBreak = layout.seats
    .filter((s) => AWAY_STATES.has(s.staff.state) || LOUNGE_STATES.has(s.staff.state))
    .map((s) => ({ s, k: hashOf(`${s.key}|${minute}|turn`) }))
    .sort((a, b) => a.k - b.k)
    .map(({ s }) => s)
  const choice = new Map()
  const order = new Map()
  for (const seat of onBreak) {
    const sleepy = LOUNGE_STATES.has(seat.staff.state)
    // weighted random order: smaller -log(u) / weight comes first
    const ranked = ACTIVITIES.filter((a) => sleepy || !a.sleepyOnly)
      .map((a, i) => ({ a, score: -Math.log(1e-9 + hashOf(`${seat.key}|${minute}|${i}`)) / a.weight }))
      .sort((x, y) => x.score - y.score)
      .map((r) => r.a)
    order.set(seat.key, ranked)
  }
  const take = (seat, from) => {
    for (const a of order.get(seat.key).slice(from)) {
      if (free[a.kind].length) {
        choice.set(seat.key, { a, spot: free[a.kind].shift(), rank: order.get(seat.key).indexOf(a) })
        return
      }
    }
  }
  for (const seat of onBreak) take(seat, 0)
  // Nobody plays foosball alone: a lone player takes their next choice instead.
  const players = onBreak.filter((s) => choice.get(s.key)?.a.kind === 'foosball')
  if (players.length === 1) {
    const lone = players[0]
    free.foosball.unshift(choice.get(lone.key).spot)
    free.foosball.length = 0
    const from = choice.get(lone.key).rank + 1
    choice.delete(lone.key)
    take(lone, from)
  }
  activityOf.clear()
  const spotOf = new Map()
  for (const [key, { a, spot }] of choice) {
    spotOf.set(key, spot)
    activityOf.set(key, a)
  }
  return spotOf
}

function stepWalkers() {
  const common = layout.common
  if (!common) return
  const spotOf = assignBreaks(common)
  const live = new Set(layout.seats.map((s) => s.key))
  for (const key of walkers.keys()) if (!live.has(key)) walkers.delete(key)

  for (const seat of layout.seats) {
    const spot = spotOf.get(seat.key)
    let w = walkers.get(seat.key)
    const activity = activityOf.get(seat.key) ?? null
    if (w) w.activity = activity
    if (spot && !w && !scenePrimed) {
      // already on a break when the panel opened
      w = { x: spot.x, y: spot.y, path: [], mode: 'away', spot, activity, left: spot.left }
      walkers.set(seat.key, w)
    } else if (spot && !w) {
      const path = route(seat, spot)
      w = { ...path[0], path: path.slice(1), mode: 'out', spot, activity }
      walkers.set(seat.key, w)
    } else if (spot && w && w.mode !== 'back' && (w.spot.x !== spot.x || w.spot.y !== spot.y)) {
      // a new spot in the band (the corner reshuffled, or coffee turned into a nap)
      w.path = [{ x: spot.x, y: w.y }, { x: spot.x, y: spot.y }]
      w.mode = 'out'
      w.spot = spot
    } else if (spot && w && w.mode === 'back') {
      w.path = route(seat, spot).slice(1)
      w.mode = 'out'
      w.spot = spot
    } else if (!spot && w && w.mode !== 'back') {
      w.path = route(seat, w.spot).reverse().slice(1)
      w.mode = 'back'
    }
    if (!w) continue
    const next = w.path[0]
    if (next) {
      const dx = next.x - w.x
      const dy = next.y - w.y
      w.left = dx < 0 ? true : dx > 0 ? false : w.left
      w.x += Math.max(-WALK_SPEED, Math.min(WALK_SPEED, dx))
      w.y += Math.max(-WALK_SPEED, Math.min(WALK_SPEED, dy))
      if (Math.abs(next.x - w.x) < 0.5 && Math.abs(next.y - w.y) < 0.5) {
        w.x = next.x
        w.y = next.y
        w.path.shift()
      }
    } else if (w.mode === 'out') {
      w.mode = 'away'
      w.left = w.spot.left ?? false
    } else if (w.mode === 'back') {
      walkers.delete(seat.key)
    }
  }
}

// ---- specialists coming and going -------------------------------------------------------------

function sideOf(seat, towardX) {
  const room = seat.room
  return towardX > room.x + room.w / 2
    ? Math.min(layout.artW - OUTER - 8, room.x + room.w + Math.floor(GAP / 2) - 4)
    : Math.max(OUTER, room.x - Math.ceil(GAP / 2) - 4)
}

const DOOR_LANE_X = OUTER + 1

/** Waypoints from the front door to a stool: along the band's lane, then the area's aisle. */
function routeIn(seat, stoolAt) {
  const doorY = layout.building.doorY
  const lane = seat.room.lane
  const sideX = sideOf(seat, 0)
  const aisleY = seat.y + SEAT_H + LABEL_H - 8
  return {
    start: { x: -8, y: doorY },
    path: [
      { x: DOOR_LANE_X, y: doorY },
      { x: DOOR_LANE_X, y: lane },
      { x: sideX, y: lane },
      { x: sideX, y: aisleY },
      { x: stoolAt.x - 1, y: aisleY },
      { x: stoolAt.x - 1, y: seat.y + 6 }
    ],
    sideX,
    aisleY,
    lane
  }
}

function routeOut(v) {
  const doorY = layout.building.doorY
  return [
    { x: v.x, y: v.aisleY },
    { x: v.sideX, y: v.aisleY },
    { x: v.sideX, y: v.lane },
    { x: DOOR_LANE_X, y: v.lane },
    { x: DOOR_LANE_X, y: doorY },
    { x: -10, y: doorY }
  ]
}

function stepVisitors() {
  if (!layout.common || !layout.building) return
  const wanted = new Map()
  for (const seat of layout.seats) {
    activeSpecialists(seat.staff)
      .slice(0, MAX_STOOLS)
      .forEach((spec, i) => wanted.set(`${seat.key}|${spec.id}`, { seat, spec, stoolAt: seat.stools[i] }))
  }
  for (const [key, { seat, spec, stoolAt }] of wanted) {
    let v = visitors.get(key)
    const r = routeIn(seat, stoolAt)
    if (!v) {
      // Already here when the panel opened: seated straight away. Later arrivals walk in.
      // Several arriving together come through the door one after another.
      const queued = [...visitors.values()].filter((o) => o.mode === 'in' && o.path.length >= r.path.length).length
      v = scenePrimed
        ? { spec, ...r.start, path: r.path, mode: 'in', sideX: r.sideX, aisleY: r.aisleY, lane: r.lane, stoolAt, wait: queued * 10 }
        : { spec, x: stoolAt.x - 1, y: seat.y + 6, path: [], mode: 'seated', sideX: r.sideX, aisleY: r.aisleY, lane: r.lane, stoolAt }
      visitors.set(key, v)
      continue
    }
    v.spec = spec
    v.sideX = r.sideX
    v.aisleY = r.aisleY
    v.lane = r.lane
    if (v.mode === 'out') {
      // called back in before reaching the door
      v.path = [{ x: v.x, y: v.lane }, ...r.path.slice(2)]
      v.mode = 'in'
    } else if (v.stoolAt.x !== stoolAt.x || v.stoolAt.y !== stoolAt.y) {
      // the desk moved (a stool was added or taken away): keep walking, to the new stool
      if (v.mode === 'seated') {
        v.x = stoolAt.x - 1
        v.y = seat.y + 6
      } else v.path.splice(-2, 2, ...r.path.slice(-2))
    }
    v.stoolAt = stoolAt
  }
  for (const [key, v] of visitors) {
    if (!wanted.has(key) && v.mode !== 'out') {
      v.path = routeOut(v)
      v.mode = 'out'
      v.wait = 0
    }
    if (v.wait > 0) {
      v.wait--
      continue
    }
    const next = v.path[0]
    if (next) {
      const dx = next.x - v.x
      const dy = next.y - v.y
      v.left = dx < 0 ? true : dx > 0 ? false : v.left
      v.x += Math.max(-WALK_SPEED, Math.min(WALK_SPEED, dx))
      v.y += Math.max(-WALK_SPEED, Math.min(WALK_SPEED, dy))
      if (Math.abs(next.x - v.x) < 0.5 && Math.abs(next.y - v.y) < 0.5) {
        v.x = next.x
        v.y = next.y
        v.path.shift()
      }
    } else if (v.mode === 'in') v.mode = 'seated'
    else if (v.mode === 'out') visitors.delete(key)
  }
}

function drawSeat(seat) {
  const p = painter(ctx, seat.x, seat.y)
  person(p, seat.staff, tick, walkers.has(seat.key))
}

function drawText(text, cssX, cssY, maxW, color, { weight = 600, align = 'left' } = {}) {
  cssTransform()
  ctx.font = `${weight} 12px ui-monospace, 'SF Mono', Menlo, monospace`
  ctx.textBaseline = 'middle'
  ctx.textAlign = align
  ctx.fillStyle = color
  let label = text
  if (ctx.measureText(label).width > maxW) {
    while (label.length > 1 && ctx.measureText(label + '...').width > maxW) label = label.slice(0, -1)
    label += '...'
  }
  ctx.fillText(label, cssX, cssY)
  ctx.textAlign = 'left'
  artTransform()
}

function drawBubble(seat, text) {
  const s = layout.scale
  cssTransform()
  ctx.font = `500 12px ui-monospace, 'SF Mono', Menlo, monospace`
  const maxW = Math.min(220, layout.artW * s - 12)
  let label = text
  while (label.length > 1 && ctx.measureText(label).width > maxW - 14) label = label.slice(0, -2) + '.'
  const w = Math.ceil(ctx.measureText(label).width) + 14
  const h = 20
  const cx = (seat.x + SEAT_W / 2) * s
  let x = Math.round(cx - w / 2)
  x = Math.max(6, Math.min(x, layout.artW * s - w - 6))
  const y = Math.max(4, Math.round(seat.y * s - h - 2))
  ctx.fillStyle = '#e9fbef'
  ctx.strokeStyle = '#3a8f5c'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 7)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - 4, y + h)
  ctx.lineTo(cx, y + h + 6)
  ctx.lineTo(cx + 4, y + h)
  ctx.fill()
  ctx.fillStyle = C.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + 7, y + h / 2 + 1)
  artTransform()
}

function draw() {
  artTransform()
  const p = painter(ctx)
  drawBuilding(p)
  for (const room of layout.rooms) drawRoom(p, room)
  drawCommon()

  // desks: people first, then the desk over their laps, then monitors and hands
  for (const seat of layout.seats) drawSeat(seat)
  for (const seat of layout.seats) desk(painter(ctx, seat.x - 2, seat.y), DESK_W)
  for (const seat of layout.seats) workstation(painter(ctx, seat.x, seat.y), seat.staff, tick, walkers.has(seat.key))
  // stools at the end of each desk, then whoever is sitting on them
  for (const seat of layout.seats) {
    for (const at of seat.stools) stool(painter(ctx, at.x, at.y))
    if (seat.overflow) {
      const last = seat.stools[seat.stools.length - 1]
      glyph(p, '+', last.x + 2, last.y - 13, C.white)
    }
  }
  for (const v of visitors.values()) {
    if (v.mode === 'seated') specialist(painter(ctx, Math.round(v.x) + 1, Math.round(v.y) + 2), v.spec, tick)
  }

  // people up and about, nearest the bottom drawn last
  const walking = layout.seats.filter((seat) => walkers.has(seat.key))
  walking.sort((a, b) => walkers.get(a.key).y - walkers.get(b.key).y)
  for (const seat of walking) {
    const w = walkers.get(seat.key)
    const at = painter(ctx, Math.round(w.x), Math.round(w.y))
    const kind = w.mode === 'away' ? w.activity?.kind : null
    if (kind === 'lounge') lounger(at, seat.staff, tick, w.activity.pose)
    else if (kind === 'booth') walker(at, seat.staff, tick, false, w.left, null, 'phone')
    else if (kind === 'foosball') walker(at, seat.staff, tick, false, w.left, null, 'play')
    else walker(at, seat.staff, tick, w.path.length > 0, w.left)
  }
  if (layout.common) for (const b of layout.common.booths) boothGlass(painter(ctx, b.bx, b.by))
  const moving = [...visitors.values()].filter((v) => v.mode !== 'seated' && !(v.wait > 0)).sort((a, b) => a.y - b.y)
  for (const v of moving) {
    walker(painter(ctx, Math.round(v.x), Math.round(v.y)), v.spec, tick, true, v.left, roleColor(v.spec.role))
  }

  const s = layout.scale
  for (const room of layout.rooms) {
    drawText(room.name, (room.x + 5) * s, (room.y + 6.5) * s, (Math.min(room.w - 40, 56) - 4) * s, C.white, { weight: 700 })
  }
  for (const seat of layout.seats) {
    const color = seat.key === selected ? '#2a1f6b' : '#2a2633'
    drawText(shortName(seat.desk), (seat.x + SEAT_W / 2) * s, (seat.y + SEAT_H + 2.5) * s, SEAT_W * s - 2, color, { align: 'center' })
  }

  const pickSeat = layout.seats.find((u) => u.key === selected)
  if (pickSeat) {
    artTransform()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.5
    ctx.strokeRect(pickSeat.x + 0.25, pickSeat.y + 0.25, SEAT_W - 0.5, SEAT_H + LABEL_H - 0.5)
  }

  const now = Date.now()
  for (const seat of layout.seats) {
    const b = bubbles.get(seat.key)
    if (seat.key === selected) drawBubble(seat, seat.staff.said ?? STATE_LABEL[seat.staff.state])
    else if (b && b.until > now) drawBubble(seat, b.text)
  }
}

// ---- side text ---------------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderStats() {
  let busy = 0
  let specialists = 0
  let needYou = 0
  for (const u of layout.seats) {
    if (u.staff.state === 'working' || u.staff.state === 'monitoring') busy++
    if (u.staff.state === 'waiting' || u.staff.state === 'blocked') needYou++
    specialists += activeSpecialists(u.staff).length
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const parts = [plural(layout.rooms.length, 'team'), `${layout.seats.length} staff`, `${busy} busy`]
  if (specialists) parts.push(plural(specialists, 'specialist'))
  if (needYou) parts.push(`${needYou} need you`)
  document.getElementById('stats').textContent = parts.join(' · ')
}

function renderDetail() {
  const box = document.getElementById('detail')
  const seat = layout.seats.find((u) => u.key === selected)
  if (!seat) {
    box.hidden = true
    return
  }
  const { desk: d, staff } = seat
  const lines = [el('div', '', d.name)]
  lines.push(el('div', 'row', `${staff.agent ?? 'agent'} · ${STATE_LABEL[staff.state]} for ${since(staff.since)}`))
  if (staff.task && staff.task !== d.name) lines.push(el('div', 'row', staff.task))
  if (staff.tool && staff.state === 'working') lines.push(el('div', 'row', `using ${staff.tool}`))
  for (const sp of activeSpecialists(staff)) {
    lines.push(el('div', 'row', `${sp.role ?? 'specialist'}: ${sp.task ?? ''} (${STATE_LABEL[sp.state]})`))
  }
  box.replaceChildren(...lines)
  box.hidden = false
}

function showMessage(text) {
  const msg = document.getElementById('message')
  msg.textContent = text ?? ''
  msg.hidden = !text
}

/** Pops a bubble on a seat whose agent just finished or needs you. */
function noteChanges() {
  const now = Date.now()
  for (const seat of layout.seats) {
    const prev = lastState.get(seat.key)
    const state = seat.staff.state
    if (primed && prev && prev !== state) {
      let text = null
      if (state === 'done') text = seat.staff.said ?? 'Done!'
      else if (state === 'waiting') text = 'Need you!'
      else if (state === 'blocked') text = 'Stuck!'
      if (text) bubbles.set(seat.key, { text, until: now + BUBBLE_MS })
    }
    lastState.set(seat.key, state)
  }
  primed = true
}

function apply(next) {
  snapshot = next
  resize()
  noteChanges()
  renderStats()
  renderDetail()
  if (layout.seats.length === 0) {
    showMessage(next.error ? `Could not read the agents: ${next.error}` : 'The office is empty. Start an agent and it gets a desk.')
  } else showMessage(null)
}

// ---- input and loops -------------------------------------------------------------------------

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect()
  const ax = (event.clientX - rect.left) / layout.scale
  const ay = (event.clientY - rect.top) / layout.scale
  const hit = layout.seats.find((u) => ax >= u.x && ax < u.x + SEAT_W && ay >= u.y && ay < u.y + SEAT_H + LABEL_H)
  selected = hit && hit.key !== selected ? hit.key : null
  renderDetail()
  draw()
})

async function poll() {
  if (document.visibilityState !== 'hidden') {
    try {
      apply(await orca.plugin.request('office.snapshot', undefined, { timeoutMs: 15000 }))
    } catch (error) {
      if (layout.seats.length === 0) showMessage(`The worker did not answer: ${error?.message ?? error}`)
    }
  }
  setTimeout(poll, POLL_MS)
}

setInterval(() => {
  if (document.visibilityState === 'hidden') return
  tick++
  stepWalkers()
  stepVisitors()
  if (snapshot) scenePrimed = true
  draw()
}, FRAME_MS)

// The canvas sets the office's height, so react to width only, or every resize re-fires.
let lastWidth = 0
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width)
  if (width === lastWidth) return
  lastWidth = width
  // Lay out on the next frame, outside the observer callback, so the resize cannot re-fire it.
  requestAnimationFrame(resize)
}).observe(document.getElementById('office'))

showMessage('Opening the office...')
poll()
