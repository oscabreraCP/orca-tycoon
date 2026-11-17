// Orca Tycoon: every agent on this Orca host as a little pixel worker on one office floor, with
// Palú, the office dog, wandering among them.
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
  christmasTree,
  coffeeMachine,
  desk,
  dumbbellRack,
  festive,
  foosball,
  glyph,
  holidayLights,
  inChristmasSeason,
  kitchen,
  lounger,
  lounge,
  painter,
  person,
  pick,
  roleColor,
  setFestive,
  specialist,
  stool,
  plant,
  treadmill,
  walker,
  paluWalk,
  paluWalkFront,
  paluWalkBack,
  paluSniff,
  dogBowls,
  paluSit,
  paluLie,
  dogBed,
  waterCooler,
  whiteboard,
  workstation
} from './sprites.js'
import { LOFT_MIN_W, loftGeometry, drawLoft, layoutLoft, lounging, outlinedAt, sitting, standing, hangout, footprint, drawHangout } from './loft.js'
import { breakWalk, onTheMove, routePlanner, stepToward, visitorWalk, walkGrid } from './walking.js'

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
const MAX_STOOLS = 3 // beyond this the last stool carries a + marker
const LINE_H = SEAT_H + LABEL_H + AISLE
const MAX_ISLAND_SEATS = 3 // islands of 3 desks, matching Loft's 3-desk island rows
const TABLE_GAP = 10 // clean corridor between desk islands
const MIN_ROOM_W = (DESK_W + STOOL_W + 1) * 2 + PAD * 2 + GLASS * 2
const COMMON_H = 34
const WALK_SPEED = 1.5 // art pixels per frame
// Pixel scale, CSS pixels per art pixel. The office grows to the biggest scale at which the whole
// building still fits the panel, so it fills a tall or wide panel instead of stopping at its own
// height; it never drops below the width's minimum, so a crowded office scrolls as before.
const MAX_SCALE = 8
const SCROLLBAR = 16 // CSS pixels a vertical scrollbar can take from the panel's width
const MIN_ART_W = MIN_ROOM_W + (OUTER + MARGIN) * 2 // narrower than this and not even the smallest room fits
const MAX_CORRIDOR = GAP * 4 // the corridors between rooms widen to reach the panel's bottom, up to this
// States in which an agent leaves its desk for the coffee corner until the state ends.
// 'monitoring' is a finished turn waiting on background tasks; add 'waiting' to also send
// agents that wait for you.
const AWAY_STATES = new Set(['monitoring'])
// What an agent on a break can do. Each one draws an activity per period of its own (weighted,
// seeded by the agent and the period, so a reopened panel shows the same picture).
const ACTIVITIES = [
  { id: 'nap', kind: 'lounge', pose: 'nap', weight: 1.5, sleepyOnly: true },
  { id: 'sofa-coffee', kind: 'lounge', pose: 'coffee', weight: 1.5 },
  { id: 'read', kind: 'lounge', pose: 'read', weight: 1.5 },
  { id: 'coffee', kind: 'coffee', weight: 2 },
  { id: 'foosball', kind: 'foosball', weight: 3 },
  { id: 'call', kind: 'booth', weight: 2 },
  // a chat at the round table: only the loft has one
  { id: 'chat', kind: 'table', weight: 2 },
  { id: 'workout', kind: 'gym', weight: 2.5 }
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

const office = document.getElementById('office')
const floor = document.getElementById('floor')
const canvas = document.getElementById('plan')
const ctx = canvas.getContext('2d')
const tooltip = document.getElementById('tooltip')
const dpr = () => window.devicePixelRatio || 1

// Two looks: Brick, the original flat office seen from straight above, and Loft, seen from the
// front and above with the real office's curtained rooms and desk islands. The choice is kept.
const THEMES = ['brick', 'loft']
const THEME_KEY = 'office-tycoon.theme'
const RENAMED = { classic: 'brick', dollhouse: 'loft' } // what the looks were called before
let theme = 'brick' // a saved choice wins; a new viewer starts in brick mode
try {
  const saved = localStorage.getItem(THEME_KEY)
  const name = RENAMED[saved] ?? saved
  if (THEMES.includes(name)) theme = name
} catch {
  // no storage in this frame: start in brick every time
}
const loft = () => theme === 'loft'

// Christmas dresses either look from 15 Nov through 1 Jan: the tree button shows only then, on by
// default, and a viewer who turns it off keeps it off.
const FESTIVE_KEY = 'office-tycoon.christmas'
const festiveSwitch = document.getElementById('christmas')
let festivePick = null // 'on' or 'off' once the viewer has pressed the button
try {
  festivePick = localStorage.getItem(FESTIVE_KEY)
} catch {
  // no storage in this frame: on in season, every time
}
function applySeason() {
  const season = inChristmasSeason()
  setFestive(season && festivePick !== 'off')
  if (festiveSwitch) {
    festiveSwitch.hidden = !season
    festiveSwitch.querySelector('button')?.setAttribute('aria-pressed', String(festive()))
  }
}
applySeason()
setInterval(applySeason, 60_000) // an office left open crosses into or out of the season
festiveSwitch?.querySelector('button')?.addEventListener('click', () => {
  festivePick = festive() ? 'off' : 'on'
  try {
    localStorage.setItem(FESTIVE_KEY, festivePick)
  } catch {
    // kept for this session only
  }
  applySeason()
  draw()
})

let snapshot = null
let layout = { artW: 0, artH: 0, scale: 3, building: null, rooms: [], seats: [], common: null }
let selected = null // seat key, or a specialist's visitor key (`seat key|specialist id`)
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

/** What a seat's nameplate reads: the worker picks it from the conversation and workspace names. */
function nameplate(seat) {
  return seat.staff.label || seat.desk.label || seat.desk.name.split(/[\s/]+/)[0] || 'workspace'
}

/** Rich label for a seat: prefers ticket, issue #, clean tab name, then branch. */
function seatLabel(seat) {
  const staff = seat.staff
  const desk = seat.desk
  const name = staff?.name || ''

  // 1. Ticket in tab name or desk: e.g. IT-73625
  const ticket = name.match(/[A-Z]{2,6}-\d+/) || desk.name.match(/[A-Z]{2,6}-\d+/)
  if (ticket) return ticket[0]

  // 2. Issue in tab name: e.g. Issue #19977 or #19977
  const issue = name.match(/(?:Issue\s*)?#(\d+)/i)
  if (issue) return `#${issue[1]}`

  // 3. Tab name clean up
  if (name.trim()) {
    const clean = name.replace(/^[^\w\s#]+/, '').trim()
    const words = clean.split(/\s+/)
    if (words[0]) {
      if (words[0].length <= 9) return words[0]
      return words[0].slice(0, 8) + '…'
    }
  }

  // 4. Fallback to branch/desk name
  return nameplate(seat)
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

/** Splits seats into islands of up to 3 desks no wider than the room, then packs islands into lines. */
function planRoom(floor, innerW) {
  const allSeats = families(floor.desks).flatMap(familySeats)
  const tables = []
  let table = []
  let width = 0
  for (const seat of allSeats) {
    const w = segmentW(seat)
    if (table.length >= MAX_ISLAND_SEATS || (table.length && width + w > innerW)) {
      tables.push(table)
      table = []
      width = 0
    }
    table.push(seat)
    width += w
  }
  if (table.length) tables.push(table)
  const tableW = (table) => table.reduce((n, seat) => n + segmentW(seat), 0)
  const lines = []
  let line = []
  let lineWidth = 0
  for (const table of tables) {
    const w = tableW(table)
    if (line.length && lineWidth + TABLE_GAP + w > innerW) {
      lines.push(line)
      line = []
      lineWidth = 0
    }
    lineWidth += (line.length ? TABLE_GAP : 0) + w
    line.push(table)
  }
  if (line.length) lines.push(line)
  return { lines, tableW }
}

/**
 * The office at one scale. `corridor` is the floor between a room and whatever lies above or
 * below it, another room or the commons band; fitLayout widens it to fill the panel.
 */
function computeLayout(cssW, scale, corridor = GAP) {
  const rawArtW = Math.floor(cssW / scale)
  const rawFloorW = rawArtW - OUTER * 2 - MARGIN * 2
  const floorList = snapshot?.floors ?? []
  const teamCount = Math.max(1, floorList.length)
  // Max columns: 1 column if 1 team, 2 columns for 2-4 teams, 3 columns only for 5+ teams
  const maxCols = teamCount >= 5 ? 3 : Math.min(2, teamCount)

  // Use full available width (100%)
  const floorW = Math.max(MIN_ROOM_W, rawFloorW)
  const artW = floorW + OUTER * 2 + MARGIN * 2
  const cols = Math.max(1, Math.min(maxCols, Math.floor((floorW + GAP) / (MIN_ROOM_W + GAP))))
  const roomW = Math.floor((floorW - GAP * (cols - 1)) / cols)
  const innerW = roomW - GLASS * 2 - PAD * 2

  // Plan every area first. Only include floors that have active agents working.
  const fullInner = floorW - GLASS * 2 - PAD * 2
  const seatCount = (floor) => floor.desks.reduce((n, d) => n + d.staff.length, 0)
  const plans = (snapshot?.floors ?? [])
    .filter((floor) => seatCount(floor) > 0)
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
        colY.fill(y + plan.h + corridor)
        return { plan, x: OUTER + MARGIN, y }
      }
      const col = colY.indexOf(Math.min(...colY))
      const at = { plan, x: OUTER + MARGIN + col * (roomW + GAP), y: colY[col] }
      colY[col] += plan.h + corridor
      return at
    })
    return { placed, bottom: Math.max(...colY) }
  }

  // If only 1 room in a multi-column floor, let it span wide so there are no huge empty columns beside it.
  if (plans.length === 1 && cols > 1 && !plans[0].wide) {
    const p = planRoom(plans[0].floor, fullInner)
    plans[0] = { ...plans[0], ...p, w: floorW, inner: fullInner, wide: true, h: TOP + p.lines.length * LINE_H + PAD }
  }

  // All team rooms go first (at the top).
  const placed = pack(plans, OUTER + MARGIN)

  // The commons ("gym" / hangout area: booths, counter, fridge, cooler, pink rug, sofa, round table, foosball, bar table, tree, dog bed)
  // sits at the bottom below all rooms, matching Loft's hangout layout.
  const bandY = plans.length ? placed.bottom : OUTER + MARGIN
  const common = hangout(OUTER + MARGIN, bandY, floorW)

  const rooms = []
  const seats = []
  for (const { plan, x, y: ry } of placed.placed) {
    const { floor, lines, tableW, h } = plan
    const room = { x, y: ry, w: plan.w, h, name: floor.repo, carpet: pick(CARPETS, floor.repo), notes: [] }
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
  const y = common.y + common.h + MARGIN
  const building = { w: artW, h: y + OUTER, doorY: common.doorY }
  return { artW, artH: building.h, scale, building, rooms, seats, common }
}

/**
 * Lays the office out at the biggest crisp pixel scale that fits naturally inside the panel.
 * Keeps corridors tight (GAP) and height natural, avoiding stretched empty floorboards.
 */
function fitLayout() {
  const box = office.getBoundingClientRect()
  const cssW = Math.max(180, Math.floor(box.width))
  const cssH = Math.max(120, Math.floor(box.height))
  const perPx = Number.isInteger(dpr()) ? dpr() : 1 // scale steps per CSS pixel
  if (loft()) return fitLoft(cssW, cssH, perPx)
  const minScale = 2

  // Limit office height to 85% max of panel height, keeping bottom clear for lawn
  const maxTargetH = Math.floor(cssH * 0.85)

  for (let n = MAX_SCALE * perPx; n / perPx >= minScale; n--) {
    const scale = n / perPx
    if (Math.floor(cssW / scale) < MIN_ART_W) continue
    const candidate = computeLayout(cssW, scale, GAP)
    if (candidate.artH * scale <= maxTargetH && candidate.artW * scale <= cssW) {
      return candidate
    }
  }

  // Second pass: fit within full height if breathing room scale couldn't be found
  for (let n = MAX_SCALE * perPx; n / perPx >= minScale; n--) {
    const scale = n / perPx
    if (Math.floor(cssW / scale) < MIN_ART_W) continue
    const candidate = computeLayout(cssW, scale, GAP)
    if (candidate.artH * scale <= cssH && candidate.artW * scale <= cssW) {
      return candidate
    }
  }
  return computeLayout(cssW, minScale, GAP)
}

/** The loft at the biggest scale at which it fits, its floor stretched to the panel's bottom. */
function fitLoft(cssW, cssH, perPx) {
  const helpers = { families, familySeats, activeSpecialists }
  const minScale = 2
  for (let n = MAX_SCALE * perPx; n / perPx >= minScale; n--) {
    const scale = n / perPx
    if (Math.floor(cssW / scale) < LOFT_MIN_W && scale > minScale) continue
    const fit = layoutLoft(snapshot, cssW, scale, helpers)
    const rows = Math.floor(cssH / scale)
    if (fit.artH <= rows) {
      fit.artH = fit.building.h = rows
      return fit
    }
  }
  // too tall for the panel at any scale: it scrolls, so leave room for the scrollbar across
  return layoutLoft(snapshot, cssW - SCROLLBAR, minScale, helpers)
}

/**
 * Device rows for a canvas as tall as the panel. Its CSS height has to be a whole number of CSS
 * pixels: otherwise, at some pixel ratios (1.1, 1.25, 1.75), the browser shows it a hair short and
 * one row of the picture is lost. So the first such number of rows at or above the panel's height;
 * the few over sit below the panel's edge.
 */
function canvasRows(cssH) {
  const rows = Math.round(cssH * dpr())
  for (let n = rows; n < rows + 64; n++) if (wholeCss(n) !== null) return n
  return rows
}

/** `rows` device pixels as a whole number of CSS pixels, or null if they are not one. */
function wholeCss(rows) {
  const css = rows / dpr()
  return Math.abs(css - Math.round(css)) < 1e-3 ? Math.round(css) : null
}

function resize() {
  layout = fitLayout()
  const w = Math.round(layout.artW * layout.scale * dpr())
  const h = Math.round(layout.artH * layout.scale * dpr())
  // The floor takes the whole office's size, so the panel scrolls over it; the canvas is only as
  // tall as the panel shows, below any scrollbar across it, in whole device pixels so the picture
  // is never stretched. A big team's office is many times taller than the panel, and a canvas that
  // size is slow for the browser to put on screen every frame.
  floor.style.width = `${w / dpr()}px`
  floor.style.height = `${h / dpr()}px`
  const shown = Math.min(h, canvasRows(office.clientHeight))
  const shownCss = wholeCss(shown) ?? shown / dpr()
  // Only touch the backing size when it changes: assigning it clears the canvas.
  if (canvas.width !== w || canvas.height !== shown) {
    canvas.width = w
    canvas.height = shown
  }
  canvas.style.width = `${w / dpr()}px`
  canvas.style.height = `${shownCss}px`
  // the rows below the panel's edge must not hold the canvas off the top at the end of the scroll
  canvas.style.marginBottom = `${-Math.max(0, shownCss - office.clientHeight)}px`
  draw()
}

/** How far the floor has scrolled under the canvas, in device pixels. */
const scrolled = () => Math.round(office.scrollTop * dpr())

// ---- drawing ---------------------------------------------------------------------------------

function artTransform() {
  const k = layout.scale * dpr()
  ctx.setTransform(k, 0, 0, k, 0, -scrolled())
  ctx.imageSmoothingEnabled = false
}

function cssTransform() {
  const d = dpr()
  ctx.setTransform(d, 0, 0, d, 0, -scrolled())
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
  const isXmas = festive()
  p(0, dy - 2, OUTER, 19, FLOOR.plank)
  p(0, dy - 3, OUTER, 1, BRICK.dark)
  p(0, dy + 17, OUTER, 1, BRICK.dark)
  p(OUTER, dy + 1, 3, 14, isXmas ? '#b4202a' : '#7a4f3a')
  if (isXmas) p(OUTER + 1, dy + 3, 1, 10, '#238547')
  // windows in the top wall, light falling in
  for (let x = 14; x + 12 < w - 8; x += 40) {
    p(x, 0, 12, 3, isXmas ? '#3b5878' : BRICK.window)
    p(x + 5, 0, 1, 3, '#dceff7')
    if (isXmas) {
      const snowX = x + 1 + ((tick + x) % 4) * 2
      const snowY = (tick >> 1) % 3
      p(snowX, snowY, 1, 1, C.white)
      p(x + 8, (snowY + 1) % 3, 1, 1, C.white)
    }
  }
  if (isXmas) {
    holidayLights(painter(ctx, OUTER, OUTER), w - OUTER * 2, tick)
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
  // name plaque and a whiteboard of sticky notes; the plant and bookshelf stand on the floor and
  // are drawn with the scenery, in depth order
  p(x + 3, y + 3, Math.min(w - 40, 56), 7, '#2a2633')
  const boardW = Math.min(26, w - 70)
  if (boardW > 8) whiteboard(painter(ctx, x + w - boardW - 4, y + 3), boardW, room.notes)
  if (festive()) {
    holidayLights(painter(ctx, x + 2, y), w - 4, tick)
  }
}

/** Where an area's plant (7 x 9) and bookshelf (12 x 9, roomy areas only) stand. */
function roomDecor(room) {
  const { x, y, w, h } = room
  const decor = [{ kind: 'plant', x: x + 3, y: y + h - 11 }]
  if (w > 90 && h > 50) decor.push({ kind: 'bookshelf', x: x + w - 15, y: y + h - 12 })
  return decor
}

const overlaps = ([ax, ay, aw, ah], [bx, by, bw, bh]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah

// ---- walking to the coffee corner ------------------------------------------------------------

/** Where an agent stands when it gets up: the aisle in front of its seat. */
function homeOf(seat) {
  if (loft()) return loftGeometry.homeOf(seat)
  return { x: seat.x + 6, y: seat.y + SEAT_H + LABEL_H - 4 }
}

/** From where someone is to `to`, around the desks and furniture in the way; null while planning. */
function walkPath(key, from, to) {
  const route = floorRoute(key, from, to, 'people')
  return route === undefined ? null : route ?? [{ x: to.x, y: to.y }]
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

// Each agent on a break keeps its activity for its own period (45 to 90 s, from its own offset),
// so they change one at a time, and keeps its spot until then, so nobody else is shuffled.
const assigned = new Map() // seat key -> { slot, a, kind, index }

function slotOf(key, now) {
  const period = ACTIVITY_MS * (0.75 + 0.75 * hashOf(`${key}|period`))
  const offset = hashOf(`${key}|offset`) * period
  return Math.floor((now + offset) / period)
}

/** The spot for every agent on a break; full places pass on, nobody plays foosball alone. */
function assignBreaks(common) {
  const now = Date.now()
  const pools = { lounge: common.sofa, coffee: common.spots, foosball: common.foos, booth: common.booths, table: common.table ?? [], gym: common.gym ?? [] }
  const onBreak = layout.seats.filter((s) => AWAY_STATES.has(s.staff.state) || LOUNGE_STATES.has(s.staff.state))
  const onKeys = new Set(onBreak.map((s) => s.key))
  for (const key of assigned.keys()) if (!onKeys.has(key)) assigned.delete(key)

  const taken = { lounge: new Set(), coffee: new Set(), foosball: new Set(), booth: new Set(), table: new Set(), gym: new Set() }
  const pending = []
  for (const seat of onBreak) {
    const slot = slotOf(seat.key, now)
    const sleepy = LOUNGE_STATES.has(seat.staff.state)
    const e = assigned.get(seat.key)
    const keep =
      e &&
      e.slot === slot &&
      e.index < pools[e.kind].length &&
      (sleepy || !e.a.sleepyOnly) &&
      (!seat.staff.isLeader || e.a.id !== 'nap' || seat.staff.state === 'done') &&
      !taken[e.kind].has(e.index)
    if (keep) taken[e.kind].add(e.index)
    else {
      assigned.delete(seat.key)
      pending.push({ seat, slot, sleepy })
    }
  }
  const ranked = ({ seat, slot, sleepy }) =>
    ACTIVITIES.filter((a) => {
      if (a.sleepyOnly && !sleepy) return false
      // Leaders can take calls, coffee/water, play foosball or read, but NEVER sofa nap unless truly done
      if (seat.staff.isLeader && a.id === 'nap' && seat.staff.state !== 'done') return false
      return true
    })
      .map((a, i) => ({ a, score: -Math.log(1e-9 + hashOf(`${seat.key}|${slot}|${i}`)) / a.weight }))
      .sort((x, y) => x.score - y.score)
      .map((r) => r.a)
  const place = (p, skip = []) => {
    for (const a of ranked(p)) {
      if (skip.includes(a.kind)) continue
      const index = pools[a.kind].findIndex((_, i) => !taken[a.kind].has(i))
      if (index >= 0) {
        taken[a.kind].add(index)
        assigned.set(p.seat.key, { slot: p.slot, a, kind: a.kind, index })
        return
      }
    }
  }
  pending.sort((x, y) => hashOf(`${x.seat.key}|${x.slot}|turn`) - hashOf(`${y.seat.key}|${y.slot}|turn`))
  for (const p of pending) place(p)
  // Nobody plays foosball alone, and nobody chats alone: a lone one picks something else.
  // Re-placed away from both, so nobody bounces from one lonely game into the other.
  const TOGETHER = ['foosball', 'table']
  for (const kind of TOGETHER) {
    const players = [...assigned].filter(([, e]) => e.kind === kind)
    if (players.length !== 1) continue
    const [key, e] = players[0]
    assigned.delete(key)
    taken[kind].delete(e.index)
    const seat = onBreak.find((s) => s.key === key)
    place({ seat, slot: e.slot, sleepy: LOUNGE_STATES.has(seat.staff.state) }, TOGETHER)
  }

  activityOf.clear()
  const spotOf = new Map()
  for (const [key, e] of assigned) {
    spotOf.set(key, pools[e.kind][e.index])
    activityOf.set(key, e.a)
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
    const w = breakWalk(
      walkers.get(seat.key),
      { spot: spotOf.get(seat.key), activity: activityOf.get(seat.key) ?? null, home: homeOf(seat), primed: scenePrimed },
      (from, to) => walkPath(`walk:${seat.key}`, from, to),
      WALK_SPEED
    )
    if (w) walkers.set(seat.key, w)
    else walkers.delete(seat.key)
  }
}

// ---- specialists coming and going -------------------------------------------------------------

const DOOR_LANE_X = OUTER + 1

/** Where a specialist waits in the aisle before stepping onto the stool, and the stool itself. */
function stoolStops(seat, stoolAt) {
  if (loft()) return loftGeometry.stoolStops(seat, stoolAt)
  return { aisle: { x: stoolAt.x - 1, y: seat.y + SEAT_H + LABEL_H - 8 }, on: { x: stoolAt.x - 1, y: seat.y + 6 } }
}

const doorStep = () => ({ x: DOOR_LANE_X, y: layout.building.doorY })

/** To the stool, from wherever they are; from outside, through the front door first. */
function routeIn(key, v, seat, stoolAt) {
  const { aisle, on } = stoolStops(seat, stoolAt)
  const from = v.x < DOOR_LANE_X ? doorStep() : v
  const path = walkPath(`visit:${key}`, from, aisle)
  return path && [...(from === v ? [] : [from]), ...path, on]
}

/** Off the stool into the aisle, across the floor to the front door, and out. */
function routeOut(key, v) {
  const door = doorStep()
  const from = v.mode === 'seated' ? v.aisle : v
  const path = walkPath(`visit:${key}`, from, door)
  return path && [...(from === v ? [] : [from]), ...path, { x: -10, y: door.y }]
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
    const stops = stoolStops(seat, stoolAt)
    if (!v) {
      // Already here when the panel opened: seated straight away. Later arrivals walk in.
      // Several arriving together come through the door one after another.
      // A walk in starts once its route is planned; until then they are not here yet.
      const queued = [...visitors.values()].filter((o) => o.mode === 'in' && o.x < DOOR_LANE_X).length
      const outside = { x: -8, y: layout.building.doorY }
      const path = scenePrimed ? routeIn(key, outside, seat, stoolAt) : []
      if (!path) continue
      v = scenePrimed
        ? { spec, ...outside, path, mode: 'in', aisle: stops.aisle, stoolAt, wait: queued * 10 }
        : { spec, ...stops.on, path, mode: 'seated', aisle: stops.aisle, stoolAt }
      visitors.set(key, v)
      continue
    }
    v.spec = spec
    v.aisle = stops.aisle
  }
  for (const [key, v] of visitors) {
    const want = wanted.get(key)
    const stool = want ? { at: want.stoolAt, on: stoolStops(want.seat, want.stoolAt).on } : null
    const here = visitorWalk(
      v,
      stool,
      (from) => routeIn(key, from, want.seat, want.stoolAt),
      (from) => routeOut(key, from),
      WALK_SPEED
    )
    if (here) continue
    visitors.delete(key)
    if (selected === key) selected = null
  }
}

// ---- Palú, the office dog ----------------------------------------------------------------------
// Purely for company: he never takes a seat or changes what anyone does. Mostly he wanders the
// floor; now and then he naps in his bed, or lies down at someone's desk and naps there a while,
// more often beside someone who is dozing too.

const PALU_SPEED = 1
const PALU_AISLE = 3
let palu = null

const between = (lo, hi) => lo + Math.random() * (hi - lo)

function paluBedSpot() {
  const b = layout.common.bed
  return { x: b.x + 3, y: b.y + 1 }
}

/** Where he lies when visiting a desk: on the floor in front of it, below the nameplate. */
function paluDeskSpot(seat) {
  if (loft()) return loftGeometry.paluDeskSpot(seat)
  return { x: seat.x + 1, y: seat.y + SEAT_H + LABEL_H }
}

/** His two lanes: the top one runs just behind the commons furniture, the bottom one in front. */
function paluLanes() {
  const c = layout.common
  return [c.laneTop, c.laneBottom + 6]
}

// ---- finding the way across the floor ---------------------------------------------------------
// Everyone walks the open floor: a grid search over where their feet may go, around the floor
// space each desk and piece of furniture stands on. They may pass behind things (depth order
// draws them behind), never through them.

const GRID = 2
// Search steps a frame for every route together (see walking.js): an ordinary floor finds a route
// in a few thousand, a hall of hundreds of desks can take a few hundred thousand. ROUTE_MS is what
// the search aims to stay within each frame, however dear a step gets on a big floor; it looks at
// the clock between slices of steps, so a frame can run a slice over.
const ROUTE_STEPS = 100000
const ROUTE_MS = 16
const planner = routePlanner(ROUTE_STEPS, { ms: ROUTE_MS })

/** Where the feet are at (x, y): Palú side-on or up and down (narrower), and a person. */
const FEET = {
  palu: { side: (x, y) => [x + 1, y + 6, 16, 3], upright: (x, y) => [x + 5, y + 6, 8, 3] },
  people: { side: (x, y) => [x + 1, y + 12, 6, 3], upright: (x, y) => [x + 1, y + 12, 6, 3] }
}

/** The floor each obstacle stands on: [x, y, w, h], in art pixels. */
function floorObstacles(who) {
  if (loft()) return loftGeometry.obstacles(layout)
  const c = layout.common
  // a person in the aisle stands tall, feet level with the heads of the next row down: for them
  // a desk starts a little lower
  const top = who === 'people' ? 5 : 0
  const boxes = layout.seats.map((s) => [s.x - 2, s.y + top, DESK_W + s.stools.length * STOOL_W + 2, SEAT_H + LABEL_H - top])
  for (const d of layout.rooms.flatMap(roomDecor)) {
    boxes.push(d.kind === 'plant' ? [d.x + 1, d.y + 5, 5, 4] : [d.x, d.y + 4, 12, 5])
  }
  // each area's name plaque and whiteboard: walk in front of them, not over them
  for (const { x, y, w } of layout.rooms) {
    const boardW = Math.min(26, w - 70)
    boxes.push([x + 3, y + 3, Math.min(w - 40, 56), 7])
    if (boardW > 8) boxes.push([x + w - boardW - 4, y + 3, boardW, 7])
  }
  if (!c) return boxes
  if (c.things) {
    for (const t of c.things) {
      const box = footprint(t)
      if (box) boxes.push(box)
    }
    boxes.push([c.bowls.x, c.bowls.y + 1, 13, 3])
  }
  return boxes
}

function floorClear(box, blocks) {
  const [x, y, w, h] = box
  const inside = x >= OUTER && y >= OUTER && x + w <= layout.artW - OUTER && y + h <= layout.building.h - OUTER
  return inside && !blocks.some((b) => overlaps(b, box))
}

/**
 * Places worth a sniff: beside each plant and bookshelf, and at the ends and corners of the commons
 * furniture. Each is where he stands, side-on, with his nose just touching the thing.
 */
function paluSniffSpots() {
  if (loft()) {
    const blocks = floorObstacles('palu')
    return loftGeometry.sniffSpots(layout).filter((s) => floorClear(FEET.palu.side(s.x, s.y), blocks))
  }
  const c = layout.common
  // nose to the left of him touching x (facing left), or to the right (facing right); paws on row y
  const fromRight = (x, base) => ({ x, y: base - 9, left: true })
  const fromLeft = (x, base) => ({ x: x - 18, y: base - 9, left: false })
  const spots = []
  for (const d of layout.rooms.flatMap(roomDecor)) {
    if (d.kind === 'plant') spots.push(fromRight(d.x + 7, d.y + 9))
    else spots.push(fromLeft(d.x, d.y + 9))
  }
  if (c?.things) {
    for (const t of c.things) {
      if (t.kind === 'plant') spots.push(fromRight(t.x + 9, t.y + 15))
      else if (t.kind === 'sofa') spots.push(fromLeft(t.x - 3, t.y + 13), fromRight(t.x + t.w + 3, t.y + 13))
      else if (t.kind === 'foosball') spots.push(fromLeft(t.x, t.y + 18), fromRight(t.x + 28, t.y + 18))
      else if (t.kind === 'cooler' || t.kind === 'fridge') spots.push(fromLeft(t.x, t.floor))
    }
  }
  const blocks = floorObstacles('palu')
  return spots.filter((s) => floorClear(FEET.palu.side(s.x, s.y), blocks))
}

const grids = new Map() // floor geometry -> where Palú's and people's feet may go, side-on and upright
let gridNow = { layout: null, tick: -1 } // this frame's grids, so asking again costs nothing

/** The grid for the floor as it is; a poll that moved nothing finds the one it already built. */
function floorGrid(who) {
  if (gridNow.layout !== layout || gridNow.tick !== tick) gridNow = { layout, tick }
  if (gridNow[who]) return gridNow[who]
  const blocks = floorObstacles(who)
  const key = `${who}|${layout.artW}|${layout.building.h}|${JSON.stringify(blocks)}`
  let grid = grids.get(key)
  if (!grid) {
    if (grids.size > 8) grids.clear()
    const feet = { side: FEET[who].side(0, 0), upright: FEET[who].upright(0, 0) }
    grid = walkGrid({ w: layout.artW, h: layout.building.h, wall: OUTER, size: GRID, feet, blocks })
    grids.set(key, grid)
  }
  gridNow[who] = grid
  return grid
}

/**
 * Waypoints from `from` to `to`, around everything in the way, for whoever `key` is: undefined
 * while the route is still being planned, null when there is no way there.
 */
function floorRoute(key, from, to, who) {
  const grid = floorGrid(who)
  const { W, H, side, upright } = grid
  const G = GRID
  const snap = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v / G)))
  const found = planner.route(key, grid, snap(from.y, H) * W + snap(from.x, W), snap(to.y, H) * W + snap(to.x, W))
  if (!found) return undefined
  const { cells } = found
  if (!cells) return null
  // Pull the route straight: from each corner, head for the farthest cell further on that can be
  // reached in a straight line over open floor. People cut across the room and go round things,
  // instead of walking the grid's right angles.
  const open = (cell) => side[cell] && upright[cell]
  const inSight = (a, b) => {
    const ax = a % W
    const ay = Math.floor(a / W)
    const dx = (b % W) - ax
    const dy = Math.floor(b / W) - ay
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2
    for (let i = 1; i < steps; i++) {
      const cx = Math.round(ax + (dx * i) / steps)
      const cy = Math.round(ay + (dy * i) / steps)
      if (!open(cy * W + cx)) return false
    }
    return true
  }
  const kept = [cells[0]]
  for (let i = 0; i < cells.length - 1; ) {
    // looking at most 64 cells ahead keeps a long route along furniture cheap
    let j = Math.min(cells.length - 1, i + 64)
    while (j > i + 1 && !inSight(cells[i], cells[j])) j--
    kept.push(cells[j])
    i = j
  }
  const corners = kept.map((cell) => ({ x: (cell % W) * G, y: Math.floor(cell / W) * G }))
  corners.push({ x: to.x, y: to.y })
  return corners
}

/** To `to`; desk visits come along the aisle and shuffle the last pixels into the spot. */
function paluPath(to, viaAisle = false) {
  if (!viaAisle) return floorRoute('palu', palu, to, 'palu')
  const path = floorRoute('palu', palu, { x: to.x, y: to.y - PALU_AISLE }, 'palu')
  return path && [...path, { x: to.x, y: to.y }]
}

const paluWanderSpot = () => ({
  x: Math.round(between(OUTER + 4, layout.artW - OUTER - 22)),
  y: paluLanes()[Math.random() < 0.5 ? 0 : 1]
})

/** Where he stands to eat (nose in the kibble, from the left) or drink (from the right). */
function paluBowlSpots() {
  const b = layout.common.bowls
  const spots = [
    { x: b.x + 2 - 17, y: b.y + 3 - 9, left: false },
    { x: b.x + 10, y: b.y + 3 - 9, left: true }
  ]
  const blocks = floorObstacles('palu').filter((o) => !(o[0] === b.x && o[1] === b.y + 1))
  const clear = spots.filter((s) => floorClear(FEET.palu.side(s.x, s.y), blocks))
  return clear.length ? clear : spots.slice(0, 1)
}

function paluNext() {
  const atDesk = layout.seats.filter((s) => !walkers.has(s.key) && (!loft() || loftGeometry.visitable(s)))
  const sniffs = paluSniffSpots()
  const options = [{ act: 'wander', w: 2 }, { act: 'bed', w: 1 }, { act: 'eat', w: 1 }]
  if (sniffs.length) options.push({ act: 'sniff', w: 3 })
  if (atDesk.length) options.push({ act: 'visit', w: 2 })
  let r = Math.random() * options.reduce((n, o) => n + o.w, 0)
  const act = options.find((o) => (r -= o.w) < 0)?.act ?? 'wander'
  // what he does next takes over once the way there is planned; until then he stays as he is
  const plan = { act, seatKey: null, restLeft: Math.random() < 0.5, viaAisle: false, tries: 0 }
  if (act === 'bed') {
    plan.to = paluBedSpot()
    plan.restFor = between(40000, 90000)
  } else if (act === 'sniff') {
    const spot = sniffs[Math.floor(Math.random() * sniffs.length)]
    plan.to = spot
    plan.restLeft = spot.left
    plan.restFor = between(2500, 6000)
  } else if (act === 'eat') {
    const bowls = paluBowlSpots()
    const spot = bowls[Math.floor(Math.random() * bowls.length)]
    plan.to = spot
    plan.restLeft = spot.left
    plan.restFor = between(3000, 7000)
  } else if (act === 'visit') {
    // more often beside someone dozing
    const weights = atDesk.map((s) => (LOUNGE_STATES.has(s.staff.state) ? 3 : 1))
    let q = Math.random() * weights.reduce((n, w) => n + w, 0)
    const seat = atDesk.find((_, i) => (q -= weights[i]) < 0) ?? atDesk[0]
    plan.seatKey = seat.key
    plan.to = paluDeskSpot(seat)
    plan.viaAisle = true
    plan.restFor = between(60000, 120000)
  } else {
    plan.to = paluWanderSpot()
    plan.restFor = between(3000, 8000)
  }
  palu.plan = plan
  paluSetOff()
}

/** Off on his next walk once its route is planned; a wander tries six places before giving up. */
function paluSetOff() {
  const plan = palu.plan
  let path
  for (;;) {
    path = paluPath(plan.to, plan.viaAisle)
    if (path === undefined) return
    if (path || plan.act !== 'wander' || ++plan.tries >= 6) break
    plan.to = paluWanderSpot()
  }
  palu.plan = null
  // nowhere he can get to: a short sit where he is, then he thinks again
  if (path) Object.assign(palu, { act: plan.act, seatKey: plan.seatKey, restLeft: plan.restLeft, restFor: plan.restFor })
  else Object.assign(palu, { act: 'wander', seatKey: null, restLeft: plan.restLeft, restFor: between(3000, 8000) })
  palu.path = path ?? []
  palu.until = null
}

function stepPalu() {
  if (!layout.common) return
  const now = Date.now()
  if (!palu) {
    // the panel opens with him asleep in his bed
    const spot = paluBedSpot()
    palu = { ...spot, path: [], act: 'bed', until: now + between(20000, 60000), restLeft: false, plan: null }
  }
  const next = palu.path[0]
  if (next) {
    const dx = next.x - palu.x
    const dy = next.y - palu.y
    // side-on when he goes more across than up or down; the little step between the aisle and
    // his spot is a shuffle, not a turn
    if (Math.abs(dx) >= 0.5 && Math.abs(dx) >= Math.abs(dy)) {
      palu.left = dx < 0
      palu.dir = 'side'
    } else if (Math.abs(dy) > PALU_AISLE) palu.dir = dy > 0 ? 'down' : 'up'
    if (stepToward(palu, next, PALU_SPEED)) palu.path.shift()
    return
  }
  if (palu.plan) return paluSetOff()
  if (palu.until === null) palu.until = now + palu.restFor
  // stay put on his spot even if the floor shifted under him
  const seat = palu.seatKey ? layout.seats.find((s) => s.key === palu.seatKey) : null
  if (palu.act === 'bed') Object.assign(palu, paluBedSpot())
  else if (seat) Object.assign(palu, paluDeskSpot(seat))
  // time to move on, or the person he was napping beside got up
  const leftDesk = palu.act === 'visit' && (!seat || walkers.has(seat.key))
  if (now >= palu.until || leftDesk) paluNext()
}

/** The box Palú covers and the row his paws are on, for drawing him behind furniture. */
function paluBox() {
  if (!palu) return null
  const x = Math.round(palu.x)
  const y = Math.round(palu.y)
  if (palu.path.length && palu.dir !== 'side') return { box: [x + 5, y - 2, 8, 11], base: y + 9 }
  if (palu.path.length) return { box: [x, y - 1, 18, 10], base: y + 9 }
  if (palu.act === 'sniff' || palu.act === 'eat') return { box: [x, y - 1, 18, 10], base: y + 9 }
  if (palu.act === 'wander') return { box: [x + 5, y - 3, 8, 10], base: y + 7 }
  return { box: [x, y, 18, 6], base: y + 6 }
}

function drawPalu(base = painter(ctx)) {
  if (!palu) return
  const off = (ox, oy) => (x, y, w, h, c) => base(Math.round(palu.x) + ox + x, Math.round(palu.y) + oy + y, w, h, c)
  const at = off(0, 0)
  const upright = off(4, -1)
  if (palu.path.length && palu.dir === 'down') paluWalkFront(upright, tick)
  else if (palu.path.length && palu.dir === 'up') paluWalkBack(upright, tick)
  else if (palu.path.length) paluWalk(at, tick, palu.left)
  else if (palu.act === 'sniff' || palu.act === 'eat') paluSniff(at, tick, palu.restLeft)
  else if (palu.act === 'wander') paluSit(off(4, -2), tick)
  else paluLie(at, tick, true, palu.restLeft)
}

function drawSeat(seat) {
  const p = painter(ctx, seat.x, seat.y)
  person(p, seat.staff, tick, walkers.has(seat.key))
}

function drawText(text, cssX, cssY, maxW, color, { weight = 600, align = 'left', size = 12, chip = null } = {}) {
  cssTransform()
  ctx.font = `${weight} ${size}px ui-monospace, 'SF Mono', Menlo, monospace`
  ctx.textBaseline = 'middle'
  ctx.textAlign = align
  ctx.fillStyle = color
  let label = String(text ?? '')
  if (ctx.measureText(label).width > maxW) {
    while (label.length > 1 && ctx.measureText(label + '...').width > maxW) label = label.slice(0, -1)
    label += '...'
  }
  if (chip) {
    // a little plate behind the text, as wide as the text
    const w = Math.ceil(ctx.measureText(label).width) + 6
    const left = align === 'center' ? cssX - w / 2 : cssX - 3
    ctx.fillStyle = chip
    ctx.fillRect(Math.round(left), Math.round(cssY - size / 2 - 2), w, size + 3)
    ctx.fillStyle = color
  }
  ctx.fillText(label, cssX, cssY)
  ctx.textAlign = 'left'
  artTransform()
}

/** Where a bubble points for this key: the person, wherever they are, or the desk. */
function bubbleAnchor(key) {
  const v = visitors.get(key)
  if (v) return { x: v.x + 4, y: v.mode === 'seated' ? v.y + 2 : v.y - 1 }
  const seat = layout.seats.find((u) => u.key === key)
  if (!seat) return null
  const w = walkers.get(seat.key)
  if (w) return { x: w.x + 4, y: w.y - 1 }
  return loft() ? loftGeometry.seatAnchor(seat) : { x: seat.x + SEAT_W / 2, y: seat.y }
}

function drawBubble(anchor, text, kind = 'speech') {
  const s = layout.scale
  cssTransform()
  ctx.font = `500 12px ui-monospace, 'SF Mono', Menlo, monospace`
  const maxW = Math.min(220, layout.artW * s - 12)
  let label = text
  while (label.length > 1 && ctx.measureText(label).width > maxW - 14) label = label.slice(0, -2) + '.'
  const w = Math.ceil(ctx.measureText(label).width) + 14
  const h = 20
  const cx = anchor.x * s
  let x = Math.round(cx - w / 2)
  x = Math.max(6, Math.min(x, layout.artW * s - w - 6))
  const y = Math.max(4, Math.round(anchor.y * s - h - 2))

  if (kind === 'waiting' || kind === 'thought') {
    // Thought bubble: warm background, golden/amber border and thought dots
    ctx.fillStyle = '#fff9e6'
    ctx.strokeStyle = '#f6b23c'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 8)
    ctx.fill()
    ctx.stroke()

    // Little thought circles leading to person
    ctx.beginPath()
    ctx.arc(cx, y + h + 3, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx - 2, y + h + 7, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else {
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
  }

  ctx.fillStyle = C.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + 7, y + h / 2 + 1)
  artTransform()
}

/** Everyone up and about, in the loft: each with where to draw them and the row of their feet. */
function loftPeople() {
  const people = []
  for (const seat of layout.seats) {
    const w = walkers.get(seat.key)
    if (!w) continue
    const x = Math.round(w.x)
    const y = Math.round(w.y)
    const kind = w.mode === 'away' ? w.activity?.kind ?? null : null
    const m = { key: seat.key, kind, spot: w.spot, base: y + 15 }
    if (kind === 'lounge') {
      m.base = (w.spot.sofa ? w.spot.sofa.y + 13 : y + 13) + 0.5
      m.paint = (p) => lounging(p, x, y, seat.staff, tick, w.activity.pose)
    } else if (kind === 'booth') m.paint = (p) => standing(p, x, y, seat.staff, tick, false, w.left, null, 'phone')
    else if (kind === 'foosball') m.paint = (p) => standing(p, x, y, seat.staff, tick, false, w.left, null, w.spot.back ? 'playBack' : 'play')
    else if (kind === 'table') {
      // the one who has the word changes every few seconds, round the table; the chair comes
      // from the layout on screen, which may be newer than the spot the walker set out for
      const chair = layout.common.table?.[assigned.get(seat.key)?.index]?.chair ?? w.spot.chair
      const seated = layout.seats.filter((s) => walkers.get(s.key)?.mode === 'away' && walkers.get(s.key)?.activity?.kind === 'table')
      const talking = seated.length > 0 && seated[Math.floor(tick / 24) % seated.length] === seat
      m.chair = chair
      m.base = chair.y + 11 + (chair.facing ? 0.5 : -0.5)
      m.paint = (p) => sitting(p, chair, seat.staff, tick, talking)
    } else if (kind === 'gym') {
      if (w.spot?.act === 'treadmill') m.base = y + 15.5
      m.paint = (p) => standing(p, x, y, seat.staff, tick, false, w.spot?.left ?? w.left, null, w.spot?.act === 'treadmill' ? 'run' : 'lift')
    } else m.paint = (p) => standing(p, x, y, seat.staff, tick, onTheMove(w), w.left)
    people.push(m)
  }
  for (const [key, v] of visitors) {
    if (v.mode === 'seated' || v.wait > 0) continue
    const x = Math.round(v.x)
    const y = Math.round(v.y)
    people.push({ key, kind: null, base: y + 15, paint: (p) => standing(p, x, y, v.spec, tick, onTheMove(v), v.left, roleColor(v.spec.role)) })
  }
  return people
}

function drawLoftScene() {
  artTransform()
  // Only the part of the office the panel shows: a big team's loft is many times taller than the
  // panel, and painting all of it eight times a second froze the panel.
  const top = office.scrollTop / layout.scale
  const view = { y0: top, y1: top + office.clientHeight / layout.scale }
  const dog = paluBox()
  const people = loftPeople()
  drawLoft(ctx, layout, {
    tick,
    away: (seat) => walkers.has(seat.key),
    seatedAt: (seat) =>
      [...visitors]
        .filter(([key, v]) => v.mode === 'seated' && key.startsWith(`${seat.key}|`))
        .map(([, v]) => ({ spec: v.spec, index: seat.stools.findIndex((st) => st.x === v.stoolAt.x && st.y === v.stoolAt.y) }))
        .filter((s) => s.index >= 0),
    people,
    sittersAt: new Set(people.filter((m) => m.kind === 'table').map((m) => m.chair)),
    palu: dog && { base: dog.base, paint: (p) => outlinedAt(p, 0, 0, (q) => drawPalu(q)) },
    bowls: (p, b) => outlinedAt(p, b.x, b.y, (q) => dogBowls(q, tick)),
    nameplate: (seat) => {
      const isLead = Boolean(seat.staff.isLeader)
      return (isLead ? '👑 ' : '') + nameplate(seat)
    },
    drawText: (...args) => {
      drawText(...args)
      artTransform()
    },
    view
  })
}

function draw() {
  if (loft()) {
    drawLoftScene()
    drawSelection()
    return
  }
  artTransform()
  const p = painter(ctx)
  drawBuilding(p)
  for (const room of layout.rooms) drawRoom(p, room)

  // desks: people first, then the desk over their laps, then monitors and hands
  for (const seat of layout.seats) drawSeat(seat)
  for (const seat of layout.seats) desk(painter(ctx, seat.x - 2, seat.y), DESK_W)
  for (const seat of layout.seats) workstation(painter(ctx, seat.x, seat.y), seat.staff, tick, walkers.has(seat.key), Boolean(seat.desk.environment))
  // stools at the end of each desk, then whoever is sitting on them
  for (const seat of layout.seats) for (const at of seat.stools) stool(painter(ctx, at.x, at.y))
  for (const v of visitors.values()) {
    if (v.mode === 'seated') specialist(painter(ctx, Math.round(v.x) + 1, Math.round(v.y) + 2), v.spec, tick)
  }
  // more specialists than stools: a + beside the last sitter's head, in the gap before the next desk
  for (const seat of layout.seats) {
    if (!seat.overflow) continue
    const last = seat.stools[seat.stools.length - 1]
    glyph(p, '+', last.x + 7, last.y - 10, C.white)
  }

  // Room decor (plants and bookshelves in the team rooms)
  const decor = layout.rooms.flatMap(roomDecor).map((d) =>
    d.kind === 'plant'
      ? { base: d.y + 9, paint: () => plant(painter(ctx, d.x, d.y), tick) }
      : { base: d.y + 9, paint: () => bookshelf(painter(ctx, d.x, d.y)) }
  )

  // Common hangout ("gym" / recreation area) matching Loft's exact hangout layout
  const dog = paluBox()
  const people = loftPeople()
  const sittersAt = new Set(people.filter((m) => m.kind === 'table').map((m) => m.chair))
  const world = {
    tick,
    people,
    sittersAt,
    bowls: (p, b) => dogBowls(painter(ctx, b.x, b.y), tick)
  }
  const hangoutItems = layout.common?.things ? drawHangout(p, layout.common, world, true) : []

  const scene = [...decor, ...hangoutItems]
  for (const m of people) {
    if (m.kind !== 'booth') scene.push({ base: m.base, paint: () => m.paint(p) })
  }
  if (dog) scene.push({ base: dog.base - 0.5, paint: drawPalu })
  scene.sort((a, b) => a.base - b.base)
  for (const it of scene) it.paint()

  const s = layout.scale
  for (const room of layout.rooms) {
    drawText(room.name, (room.x + 5) * s, (room.y + 6.5) * s, (Math.min(room.w - 40, 56) - 4) * s, C.white, { weight: 700 })
  }
  for (const seat of layout.seats) {
    if (walkers.has(seat.key)) continue
    const isLead = Boolean(seat.staff.isLeader)
    const color = seat === seatOf(selected) ? '#2a1f6b' : (isLead ? '#805000' : '#2a2633')
    const label = (isLead ? '👑 ' : '') + seatLabel(seat)
    drawText(label, (seat.x + SEAT_W / 2) * s, (seat.y + SEAT_H + 2.5) * s, (DESK_W + 4) * s, color, { align: 'center', size: 10, weight: isLead ? 700 : 600 })
  }

  drawSelection()
}

/** The frame around the selected seat, and the speech bubbles. */
function drawSelection() {
  const pickSeat = selected && seatOf(selected)
  if (pickSeat) {
    artTransform()
    const [x, y, w, h] = seatBoxOf(pickSeat)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.5
    ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5)
  }

  const now = Date.now()
  for (const seat of layout.seats) {
    const b = bubbles.get(seat.key)
    const isWaiting = seat.staff.state === 'waiting'
    if (seat.key !== selected) {
      if (isWaiting) {
        const text = (b && b.until > now && b.text) ? b.text : '❓ Need you!'
        drawBubble(bubbleAnchor(seat.key), text, 'waiting')
      } else if (b && b.until > now) {
        drawBubble(bubbleAnchor(seat.key), b.text, 'speech')
      }
    }
  }
  const anchor = selected && bubbleAnchor(selected)
  if (anchor) {
    const isWaiting = layout.seats.find((u) => u.key === selected)?.staff?.state === 'waiting'
    drawBubble(anchor, sayingOf(selected), isWaiting ? 'waiting' : 'speech')
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
  let leads = 0
  for (const u of layout.seats) {
    if (u.staff.state === 'working' || u.staff.state === 'monitoring') busy++
    if (u.staff.state === 'waiting' || u.staff.state === 'blocked') needYou++
    specialists += activeSpecialists(u.staff).length
    if (u.staff.isLeader) leads++
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const parts = [plural(layout.rooms.length, 'team'), `${layout.seats.length} staff`, `${busy} busy`]
  if (leads) parts.push(plural(leads, 'lead'))
  if (specialists) parts.push(plural(specialists, 'specialist'))
  if (needYou) parts.push(`${needYou} need you`)
  document.getElementById('stats').textContent = parts.join(' · ')
}

async function requestSnapshot() {
  if (typeof orca !== 'undefined' && orca?.plugin?.request) {
    return await orca.plugin.request('office.snapshot', undefined, { timeoutMs: 15000 })
  }
  const res = await fetch('/api/snapshot')
  return await res.json()
}

// How the last "Open in Orca" went for the selected seat: 'opening', or the reason it failed.
// Kept across polls (renderDetail runs on each) and dropped when the selection changes.
let opening = null

/** Asks the worker to bring the agent's tab to the front; the panel itself never moves Orca's focus. */
async function openInOrca(seat, ownerKey = seat.key) {
  opening = { key: ownerKey, targetKey: seat.key, text: null, busy: true }
  renderDetail()
  let outcome
  try {
    if (typeof orca !== 'undefined' && orca?.plugin?.request) {
      outcome = await orca.plugin.request('office.switch', { paneKey: seat.staff.id, environment: seat.desk.environment ?? null }, { timeoutMs: 20000 })
    } else {
      const res = await fetch('/api/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paneKey: seat.staff.id })
      })
      outcome = await res.json()
    }
  } catch (error) {
    outcome = { ok: false, error: error?.message ?? String(error) }
  }
  if (opening?.key !== ownerKey || opening?.targetKey !== seat.key) return
  opening = outcome.ok ? null : { key: ownerKey, targetKey: seat.key, text: `Could not open it in Orca: ${outcome.error}`, busy: false }
  renderDetail()
}

function findLeaderForSeat(seat) {
  if (!seat || seat.staff.isLeader) return null
  const allLeads = layout.seats.filter((s) => s.staff.isLeader)
  if (allLeads.length === 0) return null

  const haystack = `${seat.staff.name ?? ''} ${seat.staff.task ?? ''}`

  // 1. Match explicit orchestration tag (e.g. orch:7)
  const orchMatch = haystack.match(/\b(orch:\d+)\b/i)
  if (orchMatch) {
    const orchPrefix = orchMatch[1].toLowerCase()
    const match = allLeads.find((l) => `${l.staff.name ?? ''} ${l.staff.task ?? ''}`.toLowerCase().includes(orchPrefix))
    if (match) return match
  }

  // 2. Match orchestrate run UUID prefix from brief path (e.g. .stratos/orchestrate/862ed199-...)
  const runMatch = haystack.match(/\.stratos\/orchestrate\/([0-9a-f]{8})/i)
  if (runMatch) {
    const runPrefix = runMatch[1].toLowerCase()
    const match = allLeads.find((l) => `${l.staff.name ?? ''} ${l.staff.task ?? ''}`.toLowerCase().includes(runPrefix))
    if (match) return match
  }

  // 3. Explicit child worktree spawned from the leader's parent worktree
  if (seat.desk.parentId) {
    const match = allLeads.find((l) => l.desk.id === seat.desk.parentId)
    if (match) return match
  }

  return null
}

function stateLabel(state) {
  return STATE_LABEL[state] ?? state ?? 'unknown'
}

/** An agent's state and how long it has been in it, when the worker knows. */
function stateFor(staff) {
  const label = stateLabel(staff.state)
  const how = since(staff.since)
  return how ? `${label} for ${how}` : label
}

let lastScrolledKey = null
let lastClickHit = null

function bindOpenButton(btn, action) {
  let handledOnPointer = false
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || btn.disabled) return
    e.stopPropagation()
    handledOnPointer = true
    action()
  })
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (handledOnPointer) {
      handledOnPointer = false
      return
    }
    if (!btn.disabled) action()
  })
}

function renderDetail() {
  const box = document.getElementById('detail')
  const seat = selected && seatOf(selected)
  if (!seat) {
    box.hidden = true
    lastScrolledKey = null
    document.body.classList.remove('has-detail')
    return
  }
  const shouldScroll = seat.key !== lastScrolledKey
  lastScrolledKey = seat.key
  document.body.classList.add('has-detail')
  const { desk: d, staff, room } = seat
  const isLead = Boolean(staff.isLeader)
  const title = (isLead ? '👑 ' : '') + (staff.name ? staff.name : d.name)
  const header = el('div', 'title', title)
  header.style.fontWeight = '700'
  header.style.fontSize = '13px'
  header.style.color = 'var(--orca-foreground, inherit)'
  header.style.marginBottom = '4px'

  const lines = [header]
  if (isLead) lines.push(el('div', 'row', '👑 <strong>Líder / Coordinador</strong> (orquestando workers)'))
  if (d.host) lines.push(el('div', 'row', `🌐 on ${d.host}`))
  if (room) lines.push(el('div', 'row', `📁 ${room.name} · 🌿 ${d.branch ?? d.name}`))
  lines.push(el('div', 'row', `🤖 ${staff.agent ?? 'agent'} · ${stateFor(staff)}`))
  if (staff.tool && staff.state === 'working') lines.push(el('div', 'row', `⚡ using ${staff.tool}`))
  if (staff.task && staff.task !== staff.name) lines.push(el('div', 'row', `📋 ${staff.task}`))
  if (staff.state === 'waiting' && staff.line) lines.push(el('div', 'row', `🙋 ${staff.line}`))
  if (staff.said && staff.said !== staff.line) lines.push(el('div', 'row', `💬 "${staff.said}"`))
  for (const sp of activeSpecialists(staff)) {
    lines.push(el('div', 'row', `👥 ${sp.role ?? 'specialist'}: ${sp.task ?? ''} (${stateLabel(sp.state)})`))
  }
  if (staff.id) {
    const state = opening?.key === seat.key ? opening : null
    const openingSelf = Boolean(state?.busy && state?.targetKey === seat.key)
    const button = el('button', 'open', openingSelf ? 'Abriendo...' : '↗ Abrir pestaña en Orca')
    button.type = 'button'
    button.disabled = Boolean(state?.busy)
    bindOpenButton(button, () => openInOrca(seat))
    const actions = el('div', 'actions')
    actions.append(button)

    const leaderSeat = findLeaderForSeat(seat)
    if (leaderSeat?.staff?.id) {
      const openingLeader = Boolean(state?.busy && state?.targetKey === leaderSeat.key)
      const leaderBtn = el('button', 'btn-leader', openingLeader ? '👑 Abriendo líder...' : '👑 Ir a líder')
      leaderBtn.type = 'button'
      leaderBtn.disabled = Boolean(state?.busy)
      leaderBtn.title = `Abrir pestaña del líder en Orca: ${leaderSeat.staff.name || leaderSeat.desk.name}`
      bindOpenButton(leaderBtn, () => openInOrca(leaderSeat, seat.key))
      actions.append(leaderBtn)
    }

    if (state?.text) actions.append(el('span', 'note', state.text))
    lines.push(actions)
  }
  box.replaceChildren(...lines)
  box.hidden = false

  // If the newly selected seat would be covered by #detail, smoothly scroll it into view after the double-click window
  if (shouldScroll) {
    setTimeout(() => {
      if (!box.hidden && seatOf(selected)?.key === seat.key && layout) {
        const officeRect = office.getBoundingClientRect()
        const detailRect = box.getBoundingClientRect()
        const seatBottom = (seat.y + SEAT_H + LABEL_H) * layout.scale
        const currentScroll = office.scrollTop
        const seatScreenBottom = officeRect.top + seatBottom - currentScroll
        if (seatScreenBottom > detailRect.top - 12) {
          const neededScroll = seatScreenBottom - (detailRect.top - 12)
          office.scrollTo({ top: currentScroll + neededScroll, behavior: 'smooth' })
        }
      }
    }, 280)
  }
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
      else if (state === 'waiting') text = '❓ Need you!'
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
  refreshCard()
  if (layout.seats.length === 0) {
    showMessage(next.error ? `Could not read the agents: ${next.error}` : 'The office is empty. Start an agent and it gets a desk.')
  } else showMessage(null)
}

// ---- input and loops -------------------------------------------------------------------------

function artPoint(event) {
  const rect = floor.getBoundingClientRect()
  return [(event.clientX - rect.left) / layout.scale, (event.clientY - rect.top) / layout.scale]
}

/** Palú when the point is on him (with a pixel to spare, he is small). */
function onPalu(ax, ay) {
  const dog = paluBox()
  return Boolean(dog) && overlaps(dog.box, [ax - 1, ay - 1, 2, 2])
}

/** The seat a key belongs to: its own, or the desk a specialist is visiting. */
function seatOf(key) {
  const seatKey = visitors.has(key) ? key.slice(0, key.lastIndexOf('|')) : key
  return layout.seats.find((u) => u.key === seatKey) ?? null
}

/** What someone says when clicked: an agent's line, or the job a specialist was called in for. */
function sayingOf(key) {
  const v = visitors.get(key)
  if (v) return v.spec.task ?? `${v.spec.role ?? 'specialist'}, on it`
  const staff = seatOf(key)?.staff
  return staff ? staff.line ?? staff.said ?? stateLabel(staff.state) : ''
}

/** The box that is a seat on screen, for clicks and the selection frame. */
function seatBoxOf(seat) {
  return loft() ? loftGeometry.seatBox(seat) : [seat.x, seat.y, SEAT_W, SEAT_H + LABEL_H]
}

/** Who is under the point: a person first, wherever they are, then a desk. */
function whoAt(ax, ay) {
  const inBox = ([x, y, w, h]) => ax >= x && ax < x + w && ay >= y && ay < y + h
  const people = []
  for (const [key, v] of visitors) {
    if (v.wait > 0) continue
    const box = v.mode === 'seated' ? [v.x, v.y + 1, 9, 13] : [v.x - 1, v.y - 2, 10, 18]
    people.push({ key, box, base: box[1] + box[3] })
  }
  for (const seat of layout.seats) {
    const w = walkers.get(seat.key)
    // a lounger lies across the sofa, so give the box room on both sides
    if (w) people.push({ key: seat.key, box: [w.x - 3, w.y - 2, 14, 18], base: w.y + 16 })
  }
  // the one drawn last (nearest the bottom) is on top
  const person = people.sort((a, b) => b.base - a.base).find((m) => inBox(m.box))
  if (person) return person.key
  return layout.seats.find((u) => inBox(seatBoxOf(u)))?.key ?? null
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Where the pointer is over the canvas, or null when it is outside. The card is refreshed from it on
// every frame and every snapshot, so it follows someone who walks away and goes when a seat closes.
let pointer = null
let cardSig = null

function hideCard() {
  if (tooltip) tooltip.style.display = 'none'
  cardSig = null
}

function cardHtmlAt(ax, ay) {
  const targetKey = whoAt(ax, ay)
  const visitor = targetKey && visitors.get(targetKey)
  if (visitor) {
    const { spec } = visitor
    const host = seatOf(targetKey)
    const lines = [`🤖 <span style="color:var(--orca-primary,#82aaff)">${escapeHtml(stateLabel(spec.state))}</span>`]
    if (spec.task) lines.push(`📋 ${escapeHtml(spec.task)}`)
    if (host) lines.push(`🤝 helping <strong>${escapeHtml(nameplate(host))}</strong>`)
    return {
      key: targetKey,
      html: `<div style="font-weight:700;margin-bottom:3px;color:var(--orca-foreground,#fff);">👥 ${escapeHtml(spec.role ?? 'specialist')}</div><div style="color:var(--orca-muted-foreground,#9a97a8);font-size:10.5px;">${lines.join('<br>')}</div>`
    }
  }

  const hit = targetKey && seatOf(targetKey)
  if (hit) {
    const { desk: d, staff, room } = hit
    const isLead = Boolean(staff.isLeader)
    const title = (isLead ? '👑 ' : '') + (staff.name || staff.label || d.name)
    const leadBadge = isLead
      ? ` <span style="background:rgba(246,178,60,0.18);color:#f6b23c;border:1px solid rgba(246,178,60,0.4);padding:1px 5px;border-radius:3px;font-size:9.5px;font-weight:700;">👑 LÍDER</span>`
      : ''
    const how = since(staff.since)
    const stateInfo = `🤖 <strong>${escapeHtml(staff.agent || 'agent')}</strong> · <span style="color:var(--orca-primary,#82aaff)">${escapeHtml(stateLabel(staff.state))}</span>${how ? ` (${escapeHtml(how)})` : ''}`
    const hostInfo = d.host ? ` · 🌐 ${escapeHtml(d.host)}` : ''
    const locInfo = `📁 ${escapeHtml(room?.name ?? '')} · 🌿 ${escapeHtml(d.branch || d.name)}${hostInfo}`
    const toolInfo = staff.tool && staff.state === 'working' ? `<br>⚡ using <code>${escapeHtml(staff.tool)}</code>` : ''
    const waitInfo = staff.state === 'waiting' && staff.line ? `<br>🙋 <strong>${escapeHtml(staff.line)}</strong>` : ''
    const saidInfo = staff.said && staff.said !== staff.line ? `<br>💬 <em>"${escapeHtml(staff.said)}"</em>` : ''
    const activeSpecs = activeSpecialists(staff)
    const specInfo = activeSpecs.length
      ? `<br>👥 ${escapeHtml(activeSpecs.map((s) => `${s.role ?? 'specialist'} (${stateLabel(s.state)})`).join(', '))}`
      : ''

    return {
      key: targetKey,
      html: `<div style="font-weight:700;margin-bottom:3px;color:var(--orca-foreground,#fff);">${escapeHtml(title)}${leadBadge}</div><div style="color:var(--orca-muted-foreground,#9a97a8);font-size:10.5px;">${locInfo}<br>${stateInfo}${toolInfo}${waitInfo}${saidInfo}${specInfo}</div>`
    }
  }

  if (onPalu(ax, ay)) {
    return {
      key: 'palu',
      html: `<strong>Palú 🐾</strong><br><span style="color:var(--orca-muted-foreground,#9a97a8)">The office dog. A pat wakes him up!</span>`
    }
  }

  return null
}

function refreshCard() {
  if (!tooltip) return
  if (!pointer) return hideCard()
  const card = cardHtmlAt(...pointer.art())
  canvas.style.cursor = card ? 'pointer' : ''
  if (!card) return hideCard()
  if (card.html !== cardSig) {
    cardSig = card.html
    tooltip.innerHTML = card.html
    tooltip.style.display = 'block'
  }
  const margin = 10
  const x = Math.min(window.innerWidth - tooltip.offsetWidth - margin, pointer.x + 14)
  const y = Math.min(window.innerHeight - tooltip.offsetHeight - margin, pointer.y + 14)
  tooltip.style.left = `${Math.max(margin, x)}px`
  tooltip.style.top = `${Math.max(margin, y)}px`
}

canvas.addEventListener('mousemove', (event) => {
  const { clientX: x, clientY: y } = event
  pointer = { x, y, art: () => artPoint({ clientX: x, clientY: y }) }
  refreshCard()
})

canvas.addEventListener('mouseleave', () => {
  pointer = null
  canvas.style.cursor = ''
  hideCard()
})

canvas.addEventListener('click', (event) => {
  pointer = null
  hideCard()
  if (event.detail > 1) return
  const [ax, ay] = artPoint(event)
  // a pat wakes Palú: if he is resting, he gets up and goes on to whatever he does next
  if (onPalu(ax, ay)) {
    if (!palu.path.length) paluNext()
    return
  }
  const hit = whoAt(ax, ay)
  lastClickHit = hit ? { key: hit, at: Date.now() } : null
  selected = hit && hit !== selected ? hit : null
  if (opening && seatOf(selected)?.key !== opening.key) opening = null
  renderDetail()
  draw()
})

canvas.addEventListener('dblclick', (event) => {
  const [ax, ay] = artPoint(event)
  const recentHit = lastClickHit && Date.now() - lastClickHit.at < 600 ? lastClickHit.key : null
  const hit = whoAt(ax, ay) ?? recentHit
  const seat = hit && seatOf(hit)
  if (seat) {
    selected = hit
    if (opening && seatOf(selected)?.key !== opening.key) opening = null
    renderDetail()
    draw()
    openInOrca(seat)
  }
})

/** Switches the look: everyone is placed afresh in the new office, nobody walks across. */
function setTheme(next) {
  if (!THEMES.includes(next) || next === theme) return
  theme = next
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // kept for this session only
  }
  walkers.clear()
  visitors.clear()
  assigned.clear()
  palu = null
  scenePrimed = false
  selected = null
  opening = null
  renderThemes()
  renderDetail()
  hideCard()
  resize()
}

function renderThemes() {
  for (const button of document.querySelectorAll('#themes button')) button.setAttribute('aria-pressed', String(button.dataset.theme === theme))
}

for (const button of document.querySelectorAll('#themes button')) button.addEventListener('click', () => setTheme(button.dataset.theme))
renderThemes()

let pollTimer = null
let polling = false
async function poll() {
  clearTimeout(pollTimer)
  if (polling) return
  polling = true
  // Hidden panel: no question to Orca at all; the visibilitychange handler resumes it.
  if (document.visibilityState !== 'hidden') {
    try {
      apply(await requestSnapshot())
    } catch (error) {
      if (layout.seats.length === 0) showMessage(`The worker did not answer: ${error?.message ?? error}`)
    }
    pollTimer = setTimeout(poll, POLL_MS)
  }
  polling = false
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') poll()
})

setInterval(() => {
  if (document.visibilityState === 'hidden') return
  tick++
  planner.frame()
  stepWalkers()
  stepVisitors()
  stepPalu()
  if (snapshot) scenePrimed = true
  draw()
  refreshCard()
}, FRAME_MS)

// The office's box follows the panel, not the canvas, so a relayout cannot re-fire this. Lay out
// on the next frame, outside the observer callback.
new ResizeObserver(() => requestAnimationFrame(resize)).observe(office)
// the canvas shows only what is on screen, so scrolling draws the new part at once
let scrolling = false
office.addEventListener(
  'scroll',
  () => {
    if (scrolling) return
    scrolling = true
    requestAnimationFrame(() => {
      scrolling = false
      draw()
    })
  },
  { passive: true }
)

showMessage('Opening the office...')
poll()
