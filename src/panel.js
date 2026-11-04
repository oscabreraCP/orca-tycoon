// Orca Tycoon: every agent on this Orca host as a little pixel worker on one office floor.
// Each project is an open area on the floor; every worktree in it is a seat at a shared desk, with a
// worktree's children seated next to it. Subagents are interns walking around their desk.
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
  coffeeMachine,
  desk,
  intern,
  kitchen,
  lounge,
  painter,
  person,
  pick,
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
const AISLE = 11 // where interns walk
const LINE_H = SEAT_H + LABEL_H + AISLE
const TABLE_GAP = 6
const MIN_ROOM_W = SEAT_W * 3 + 4 + PAD * 2 + GLASS * 2
const COMMON_H = 34
const WALK_SPEED = 1.5 // art pixels per frame
// States in which an agent leaves its desk for the coffee corner until the state ends.
// 'monitoring' is a finished turn waiting on background tasks; add 'waiting' to also send
// agents that wait for you.
const AWAY_STATES = new Set(['monitoring'])

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

/** Splits families into desks no wider than the room, then packs desks into lines. */
function planRoom(floor, innerW) {
  const maxSeats = Math.max(1, Math.floor((innerW - 4) / SEAT_W))
  const tables = []
  for (const family of families(floor.desks)) {
    const seats = familySeats(family)
    for (let i = 0; i < seats.length; i += maxSeats) tables.push(seats.slice(i, i + maxSeats))
  }
  const lines = []
  let line = []
  let width = 0
  for (const table of tables) {
    const w = table.length * SEAT_W + 4
    if (line.length && width + TABLE_GAP + w > innerW) {
      lines.push(line)
      line = []
      width = 0
    }
    width += (line.length ? TABLE_GAP : 0) + w
    line.push(table)
  }
  if (line.length) lines.push(line)
  return lines
}

function computeLayout() {
  const cssW = Math.max(180, document.getElementById('office').clientWidth)
  const scale = cssW >= 300 ? 3 : 2
  const artW = Math.floor(cssW / scale)
  const floorW = artW - OUTER * 2 - MARGIN * 2
  const cols = Math.max(1, Math.floor((floorW + GAP) / (MIN_ROOM_W + GAP)))
  const roomW = Math.floor((floorW - GAP * (cols - 1)) / cols)
  const innerW = roomW - GLASS * 2 - PAD * 2

  const rooms = []
  const seats = []
  // Open areas need not line up: each one goes into the column that is shortest so far.
  const colY = Array.from({ length: cols }, () => OUTER + MARGIN)
  for (const floor of snapshot?.floors ?? []) {
    const lines = planRoom(floor, innerW)
    const h = TOP + lines.length * LINE_H + PAD
    const col = colY.indexOf(Math.min(...colY))
    const room = {
      x: OUTER + MARGIN + col * (roomW + GAP),
      y: colY[col],
      w: roomW,
      h,
      name: floor.repo,
      carpet: pick(CARPETS, floor.repo),
      notes: [],
      lines: []
    }
    colY[col] += h + GAP
    lines.forEach((line, li) => {
      const lineW = line.reduce((n, t) => n + t.length * SEAT_W + 4, 0) + TABLE_GAP * (line.length - 1)
      let tx = room.x + GLASS + PAD + Math.floor((innerW - lineW) / 2)
      const ty = room.y + TOP + li * LINE_H
      for (const table of line) {
        const tw = table.length * SEAT_W + 4
        room.lines.push({ x: tx, y: ty, w: tw })
        table.forEach(({ desk: d, staff }, si) => {
          seats.push({ key: `${d.id}|${staff.id}`, x: tx + 2 + si * SEAT_W, y: ty, desk: d, staff, room })
          room.notes.push(STATE_NOTE[staff.state])
        })
        tx += tw + TABLE_GAP
      }
    })
    rooms.push(room)
  }
  let y = Math.max(...colY)

  // The break area across the bottom: a lounge when there is room, then the coffee corner
  // (water dispenser, coffee machine) and the kitchen counter, with standing spots in front.
  const common = { x: OUTER + MARGIN, y, w: floorW, h: COMMON_H }
  const loungeW = floorW >= 150 ? Math.floor((floorW - GAP) / 2) : 0
  const cornerX = common.x + (loungeW ? loungeW + GAP : 0)
  common.lounge = loungeW ? { x: common.x, y: y + 6, w: loungeW } : null
  common.cooler = { x: cornerX + 2, y: y + 2 }
  common.coffee = { x: cornerX + 12, y: y + 4 }
  common.kitchen = { x: cornerX + 24, y: y + 6, w: Math.max(30, common.x + floorW - cornerX - 24) }
  common.hallY = y - 4
  common.spots = []
  for (let sx = cornerX; sx + 8 <= common.x + floorW; sx += 9) common.spots.push({ x: sx, y: y + 17 })
  y += COMMON_H + MARGIN
  const building = { w: artW, h: y + OUTER }
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
  if (c.lounge) lounge(painter(ctx, c.lounge.x, c.lounge.y), c.lounge.w)
  kitchen(painter(ctx, c.kitchen.x, c.kitchen.y), c.kitchen.w)
  waterCooler(painter(ctx, c.cooler.x, c.cooler.y), tick)
  coffeeMachine(painter(ctx, c.coffee.x, c.coffee.y), tick)
}

// ---- walking to the coffee corner ------------------------------------------------------------

/** Where an agent stands when it gets up: the aisle in front of its seat. */
function homeOf(seat) {
  return { x: seat.x + 6, y: seat.y + SEAT_H + LABEL_H - 4 }
}

/** Along the area's aisle to the corridor beside it, down to the break area, across to the spot. */
function route(seat, spot) {
  const home = homeOf(seat)
  const hallY = layout.common.hallY
  // leave the area by the side that faces the spot
  const room = seat.room
  const right = spot.x > room.x + room.w / 2
  const sideX = right
    ? Math.min(layout.artW - OUTER - 8, room.x + room.w + Math.floor(GAP / 2) - 4)
    : Math.max(OUTER, room.x - Math.ceil(GAP / 2) - 4)
  return [home, { x: sideX, y: home.y }, { x: sideX, y: hallY }, { x: spot.x, y: hallY }, { ...spot }]
}

function stepWalkers() {
  const common = layout.common
  if (!common) return
  const away = layout.seats.filter((s) => AWAY_STATES.has(s.staff.state)).sort((a, b) => a.key.localeCompare(b.key))
  const spotOf = new Map(away.map((s, i) => [s.key, common.spots[i % Math.max(1, common.spots.length)]]))
  const live = new Set(layout.seats.map((s) => s.key))
  for (const key of walkers.keys()) if (!live.has(key)) walkers.delete(key)

  for (const seat of layout.seats) {
    const spot = spotOf.get(seat.key)
    let w = walkers.get(seat.key)
    if (spot && !w) {
      const path = route(seat, spot)
      w = { ...path[0], path: path.slice(1), mode: 'out', spot }
      walkers.set(seat.key, w)
    } else if (spot && w && w.mode !== 'back' && (w.spot.x !== spot.x || w.spot.y !== spot.y)) {
      // the corner reshuffled: walk to the new spot from wherever they are
      w.path = [{ x: w.x, y: common.hallY }, { x: spot.x, y: common.hallY }, { ...spot }]
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
      w.left = false
    } else if (w.mode === 'back') {
      walkers.delete(seat.key)
    }
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
  for (const room of layout.rooms) for (const line of room.lines) desk(painter(ctx, line.x, line.y), line.w)
  for (const seat of layout.seats) workstation(painter(ctx, seat.x, seat.y), seat.staff, tick)
  for (const seat of layout.seats) {
    seat.staff.interns.slice(0, 3).forEach((item, i) => {
      intern(painter(ctx, seat.x + i * 3, seat.y + SEAT_H + LABEL_H + 1), item, 0, SEAT_W - 8, tick, i)
    })
  }

  // people up and about, nearest the bottom drawn last
  const walking = layout.seats.filter((seat) => walkers.has(seat.key))
  walking.sort((a, b) => walkers.get(a.key).y - walkers.get(b.key).y)
  for (const seat of walking) {
    const w = walkers.get(seat.key)
    walker(painter(ctx, Math.round(w.x), Math.round(w.y)), seat.staff, tick, w.path.length > 0, w.left)
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
  let interns = 0
  let needYou = 0
  for (const u of layout.seats) {
    if (u.staff.state === 'working' || u.staff.state === 'monitoring') busy++
    if (u.staff.state === 'waiting' || u.staff.state === 'blocked') needYou++
    interns += u.staff.interns.length
  }
  const parts = [`${layout.rooms.length} teams`, `${layout.seats.length} staff`, `${busy} busy`]
  if (interns) parts.push(`${interns} interns`)
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
  for (const item of staff.interns) {
    lines.push(el('div', 'row', `intern ${item.role ?? ''}: ${item.task ?? ''} (${item.state})`))
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
