// The loft's seating rules and its floor plan: seats stay put while others come and go, a
// family sits together, and everyone has room to stand and walk.
import { assert, test } from 'orca/testing'
import { LOFT_MIN_W, drawLoft, loftGeometry, layoutLoft, frontAgent, backAgent, sitting } from './loft.js'
import { GOLD, RUBY } from './sprites.js'

type Staff = { id: string; state: string; specialists: unknown[] }
type Desk = { id: string; name: string; label: string; parentId: string | null; staff: Staff[] }

const helpers = {
  families: (desks: Desk[]) => {
    const roots = desks.filter((d) => !d.parentId)
    return roots.map((r) => [r, ...desks.filter((d) => d.parentId === r.id)])
  },
  familySeats: (family: Desk[]) => family.flatMap((desk) => desk.staff.map((staff) => ({ desk, staff }))),
  activeSpecialists: (staff: Staff) => staff.specialists
}

const desk = (repo: string, n: number, parentId: string | null = null, asleep = false): Desk => ({
  id: `${repo}-${n}`,
  name: `${repo}-${n}`,
  label: `${repo}-${n}`,
  parentId,
  staff: asleep ? [] : [{ id: `${repo}-agent-${n}`, state: 'working', specialists: [] }]
})
const office = (floors: Record<string, Desk[]>) => ({ at: 0, error: null, floors: Object.entries(floors).map(([repo, desks]) => ({ repo, desks })) })
const slots = (layout: any, repo: string) => new Map(layout.seats.filter((s: any) => s.room.name === repo).map((s: any) => [s.key, s.slot]))

test('the front row fills first, and a seat stays put when its neighbour leaves', () => {
  const desks = [1, 2, 3, 4].map((n) => desk('keep', n))
  const layout = layoutLoft(office({ keep: desks }), 900, 3, helpers)
  const first = slots(layout, 'keep')
  assert.deepEqual([...first.values()], [0, 1, 2, 3])
  assert.deepEqual(layout.seats.map((s: any) => s.front), [true, true, true, false])
  const later = slots(layoutLoft(office({ keep: [desks[0], desks[2], desks[3]] }), 900, 3, helpers), 'keep')
  for (const [key, slot] of later) assert.equal(slot, first.get(key), `${key} moved`)
  // a newcomer takes the seat that came free
  const back = slots(layoutLoft(office({ keep: [desks[0], desks[2], desks[3], desk('keep', 9)] }), 900, 3, helpers), 'keep')
  assert.equal(back.get('keep-9|keep-agent-9'), 1)
})

test('a child worktree sits beside its parent when that desk is free', () => {
  const parent = desk('fam', 1)
  const other = desk('fam', 2)
  const child = desk('fam', 3, parent.id)
  const placed = slots(layoutLoft(office({ fam: [parent, other, child] }), 900, 3, helpers), 'fam')
  assert.equal(placed.get('fam-3|fam-agent-3'), (placed.get('fam-1|fam-agent-1') as number) + 1)
})

test('a seventh agent opens a second island, and every island has six desks', () => {
  const layout = layoutLoft(office({ big: [1, 2, 3, 4, 5, 6, 7].map((n) => desk('big', n)) }), 900, 3, helpers)
  const room = layout.rooms.find((r: any) => r.name === 'big')
  assert.equal(room.islands.length, 2)
  for (const isl of room.islands) assert.equal(isl.cells.length, 6)
})

test('rooms go two to a row on a wide floor and one on a narrow one, inside the walls', () => {
  const big = (r: string) => [1, 2, 3, 4].map((n) => desk(r, n))
  const floors = { a: big('a'), b: big('b'), c: big('c') }
  const wide = layoutLoft(office(floors), 330 * 3, 3, helpers)
  assert.equal(wide.building.cols, 2)
  assert.equal(wide.lines.length, 2)
  const narrow = layoutLoft(office(floors), LOFT_MIN_W * 3, 3, helpers)
  assert.equal(narrow.building.cols, 1)
  assert.equal(narrow.lines.length, 3)
  for (const layout of [wide, narrow]) {
    for (const room of layout.rooms) assert.ok(room.x >= 4 && room.x + room.w <= layout.artW - 4, `${room.name} pokes through a wall`)
  }
})

test('a team of three or fewer gets half an island, and two such teams share a room', () => {
  const layout = layoutLoft(office({ big: [1, 2, 3, 4, 5].map((n) => desk('big', n)), s1: [desk('s1', 1)], s2: [desk('s2', 1), desk('s2', 2)] }), 330 * 3, 3, helpers)
  assert.equal(layout.teamCount, 3)
  assert.equal(layout.rooms.length, 2)
  const shared = layout.rooms.find((r: any) => r.islands.length === 2)
  assert.ok(shared.islands.every((i: any) => i.half && i.cells.length === 3 && i.team), 'the shared room holds two named half islands')
  assert.ok(layout.seats.filter((s: any) => s.room.name !== 'big').every((s: any) => s.front), 'a half island seats its team facing their screens')
})

test('a sleeping worktree keeps its desk, empty, with its nameplate', () => {
  const layout = layoutLoft(office({ t: [desk('t', 1), desk('t', 2, null, true)] }), 330 * 3, 3, helpers)
  const cells = layout.rooms[0].islands[0].cells
  assert.equal(layout.seats.length, 1)
  const vacant = cells.find((c: any) => c?.vacant)
  assert.equal(vacant.label, 't-2')
})

for (const [width, look] of [[330 * 3, 'wide'], [LOFT_MIN_W * 3, 'narrow']] as const)
test(`everyone stands and every break spot is on open floor, ${look}`, () => {
  const layout = layoutLoft(office({ a: [1, 2, 3, 4, 5, 6].map((n) => desk('a', n)), b: [desk('b', 1)] }), width, 3, helpers)
  const blocks = loftGeometry.obstacles(layout)
  const overlaps = ([ax, ay, aw, ah]: number[], [bx, by, bw, bh]: number[]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
  const feet = ({ x, y }: { x: number; y: number }) => [x + 1, y + 12, 6, 3]
  const clear = (spot: { x: number; y: number }) => !blocks.some((b: number[]) => overlaps(b, feet(spot)))
  for (const seat of layout.seats) {
    assert.ok(clear(loftGeometry.homeOf(seat)), `${seat.key} has nowhere to stand up`)
    for (const stool of seat.stools) assert.ok(clear(loftGeometry.stoolStops(seat, stool).aisle), `${seat.key} has no aisle by a stool`)
  }
  const c: any = layout.common
  for (const spot of [...c.spots, ...c.foos]) assert.ok(clear(spot), `a ${spot.kind} spot is inside furniture`)
})

test('the hangout sits halfway, with rooms above and below it', () => {
  const floors = Object.fromEntries(['a', 'b', 'c', 'd'].map((r) => [r, [1, 2, 3, 4].map((n) => desk(r, n))]))
  const layout = layoutLoft(office(floors), LOFT_MIN_W * 3, 3, helpers)
  const above = layout.rooms.filter((r: any) => r.y < layout.common.y).length
  const below = layout.rooms.filter((r: any) => r.y > layout.common.y).length
  assert.equal(above, 2)
  assert.equal(below, 2)
})

test('on a narrow floor the hangout leaves the walkway by the right wall clear', () => {
  const layout = layoutLoft(office({ a: [desk('a', 1)], b: [desk('b', 1)] }), LOFT_MIN_W * 3, 3, helpers)
  const { spineX } = layout.building
  for (const t of layout.common.things) {
    const size: Record<string, number> = { booth: 20, fridge: 13, cooler: 7, plant: 9, tulip: 7, roundTable: 16, foosball: 28, coffeeTable: 24, barTable: 28, barStool: 7 }
    const right = t.x + (t.w ?? size[t.kind] ?? 0)
    assert.ok(right <= spineX, `the ${t.kind} stands in the walkway`)
  }
})

test('specialists on both sides of neighbouring desks never sit on each other or on a chair', () => {
  const layout = layoutLoft(office({ a: [1, 2, 3, 4, 5, 6].map((n) => desk('a', n)) }), 330 * 3, 3, helpers)
  const front = layout.seats.filter((s: any) => s.front).sort((a: any, b: any) => a.cx - b.cx)
  for (let i = 0; i + 1 < front.length; i++) {
    const right = front[i].stools[0]
    const left = front[i + 1].stools[1]
    assert.ok(right.x + 8 < left.x - 1, `stools of ${front[i].key} and ${front[i + 1].key} overlap`)
    assert.ok(right.x + 8 <= front[i + 1].cx - 6, `a stool runs into the chair of ${front[i + 1].key}`)
    assert.ok(right.x >= front[i].cx + 9, `the specialist of ${front[i].key} sits on its chair`)
  }
})

test('a desk keeps its own key, for its mat and things, when its worktree wakes up', () => {
  const asleep = layoutLoft(office({ k: [desk('k', 1), desk('k', 2, null, true)] }), 330 * 3, 3, helpers)
  const vacant = asleep.rooms[0].islands[0].cells.find((c: any) => c?.vacant)
  const awake = layoutLoft(office({ k: [desk('k', 1), desk('k', 2)] }), 330 * 3, 3, helpers)
  const seat = awake.seats.find((s: any) => s.desk.id === 'k-2')
  assert.equal(seat.unit, vacant.key)
})

test('a big office paints only the rows on screen, the same as before, and each desk mat once', () => {
  const g = globalThis as any
  const offscreen = g.OffscreenCanvas
  let mats = 0
  const anything = () => new Proxy({} as any, { get: (t, k) => (k in t ? t[k] : () => {}) })
  g.OffscreenCanvas = class {
    width: number
    height: number
    constructor(w: number, h: number) {
      mats++
      this.width = w
      this.height = h
    }
    getContext() {
      return anything()
    }
  }
  try {
    // one agent and 500 sleeping worktrees: far more desks than a panel shows, and than the mats kept
    const desks = [desk('huge', 0), ...Array.from({ length: 500 }, (_, n) => desk('huge', n + 1, null, true))]
    const layout = layoutLoft(office({ huge: desks }), 330 * 2, 2, helpers)
    assert.ok(layout.artH > 3000, 'the office should be much taller than the panel')
    let painted: string[] = []
    const ctx: any = anything()
    ctx.fillRect = (x: number, y: number, w: number, h: number) => painted.push(`${x},${y},${w},${h},${ctx.fillStyle}`)
    ctx.drawImage = (img: any, x: number, y: number) => painted.push(`img ${x},${y},${img.width},${img.height}`)
    const frame = (view?: { y0: number; y1: number }) => {
      painted = []
      drawLoft(ctx, layout, {
        tick: 0,
        away: () => false,
        seatedAt: () => [],
        people: [],
        sittersAt: new Set(),
        palu: null,
        bowls: () => {},
        nameplate: () => '',
        drawText: () => {},
        view
      })
      return painted
    }
    const whole = frame()
    // a band of desks, and one across the hangout
    const views = [
      { y0: 1200, y1: 1500 },
      { y0: layout.common.y - 40, y1: layout.common.y + layout.common.h + 40 }
    ]
    for (const view of views) {
      const inView = (op: string) => {
        const [, y, , h] = op.replace('img ', '').split(',').map(Number)
        return y < view.y1 && y + h > view.y0
      }
      const culled = frame(view)
      const made = mats
      assert.deepEqual(frame(view), culled)
      assert.equal(mats, made, 'the next frame painted the desk mats again')
      assert.ok(culled.length * 4 < whole.length, 'the rows off screen were painted too')
      assert.ok(culled.filter(inView).length > 100, `nothing painted in rows ${view.y0} to ${view.y1}`)
      assert.deepEqual(culled.filter(inView), whole.filter(inView), `rows ${view.y0} to ${view.y1} look different`)
    }
  } finally {
    g.OffscreenCanvas = offscreen
  }
})

test('a leader agent in the loft wears a crown', () => {
  const leadStaff = { id: 'lead-1', state: 'working', isLeader: true, specialists: [] }

  // 1. Front-row agent wears crown
  const frontPixels: { c: string }[] = []
  frontAgent((x: number, y: number, w: number, h: number, c: string) => {
    frontPixels.push({ c })
  }, 50, 50, leadStaff, 0, false)
  assert.ok(frontPixels.some((p) => p.c === RUBY), 'ruby of leader crown was drawn on front agent')
  assert.ok(frontPixels.some((p) => p.c === GOLD), 'gold of leader crown was drawn on front agent')

  // 2. Back-row agent wears crown
  const backPixels: { c: string }[] = []
  backAgent((x: number, y: number, w: number, h: number, c: string) => {
    backPixels.push({ c })
  }, 50, 50, leadStaff, 0, false)
  assert.ok(backPixels.some((p) => p.c === RUBY), 'ruby of leader crown was drawn on back agent')
  assert.ok(backPixels.some((p) => p.c === GOLD), 'gold of leader crown was drawn on back agent')

  // 3. Sitting at conference table wears crown
  const sittingPixels: { c: string }[] = []
  sitting((x: number, y: number, w: number, h: number, c: string) => {
    sittingPixels.push({ c })
  }, { x: 50, y: 50, facing: true }, leadStaff, 0, false)
  assert.ok(sittingPixels.some((p) => p.c === RUBY), 'ruby of leader crown was drawn on sitting agent')
  assert.ok(sittingPixels.some((p) => p.c === GOLD), 'gold of leader crown was drawn on sitting agent')
})

