// Finding the way: the grid of where feet fit, a search that is as good as searching the whole floor
// but never takes more than its share of a frame, and agents that only change what they do once
// their way there is found.
import { assert, test } from 'orca/testing'
import { BLOCKED_COST, LONG_SEARCH, SEARCH_SETUP, SLICE, TURN_COST, breakWalk, onTheMove, routePlanner, routeSearch, visitorWalk, walkGrid } from './walking.js'

type Box = [number, number, number, number]

/** A small random generator, so a failure can be run again. */
function random(seed: number) {
  let s = seed
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const overlaps = ([ax, ay, aw, ah]: Box, [bx, by, bw, bh]: Box) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah

/** A random floor: walls, and desks and furniture dropped anywhere, some on half pixels. */
function floor(seed: number, w = 120, h = 90, count = 24) {
  const r = random(seed)
  const blocks: Box[] = Array.from({ length: count }, () => [Math.round(r() * w * 2) / 2, Math.round(r() * h * 2) / 2, 1 + Math.round(r() * 30), 1 + Math.round(r() * 14)])
  return { w, h, wall: 4, size: 2, feet: { side: [1, 12, 6, 3] as Box, upright: [5, 6, 8, 3] as Box }, blocks }
}

/** Every step the feet take into a cell they do not fit, and every turn, as the search counts them. */
function costOf(grid: any, cells: number[]): number {
  let cost = 0
  let heading = -1
  for (let i = 1; i < cells.length; i++) {
    const d = cells[i] - cells[i - 1]
    const h = d === 1 ? 0 : d === -1 ? 1 : d === grid.W ? 2 : 3
    assert.ok([1, -1, grid.W, -grid.W].includes(d), 'a route only steps to a neighbouring cell')
    cost += ((h < 2 ? grid.side : grid.upright)[cells[i]] ? 1 : BLOCKED_COST) + (heading === -1 || h === heading ? 0 : TURN_COST)
    heading = h
  }
  return cost
}

/** The plain search over the whole floor the panel used to run, for its cost. */
function plainCost(grid: any, start: number, goal: number): number {
  const { W, H, side, upright } = grid
  const STEP = [1, -1, W, -W]
  const cost = new Float64Array(W * H * 4).fill(Infinity)
  // costs are whole numbers, so a bucket per cost is a priority queue
  const buckets: number[][] = []
  const push = (d: number, node: number) => (buckets[d] ??= []).push(node)
  for (let h = 0; h < 4; h++) {
    cost[start * 4 + h] = 0
    push(0, start * 4 + h)
  }
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d]
    if (!bucket) continue
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i]
      if (d > cost[node]) continue
      const cell = node >> 2
      if (cell === goal) return d
      const cx = cell % W
      for (let h = 0; h < 4; h++) {
        const next = cell + STEP[h]
        if (h < 2 ? Math.floor(next / W) !== Math.floor(cell / W) : next < 0 || next >= W * H) continue
        if (h === 0 && cx === W - 1) continue
        const nd = d + ((h < 2 ? side : upright)[next] ? 1 : BLOCKED_COST) + (h === (node & 3) ? 0 : TURN_COST)
        if (nd < cost[next * 4 + h]) {
          cost[next * 4 + h] = nd
          push(nd, next * 4 + h)
        }
      }
    }
  }
  return Infinity
}

test('the grid marks where feet fit exactly as checking every cell against every obstacle did', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const f = floor(seed)
    const grid = walkGrid(f)
    for (const [name, foot] of [
      ['side', f.feet.side],
      ['upright', f.feet.upright]
    ] as const) {
      for (let gy = 0; gy < grid.H; gy++) {
        for (let gx = 0; gx < grid.W; gx++) {
          const box: Box = [gx * 2 + foot[0], gy * 2 + foot[1], foot[2], foot[3]]
          const inside = box[0] >= 4 && box[1] >= 4 && box[0] + box[2] <= f.w - 4 && box[1] + box[3] <= f.h - 4
          const clear = inside && !f.blocks.some((b) => overlaps(b, box))
          assert.equal(grid[name][gy * grid.W + gx], clear ? 1 : 0, `seed ${seed}, ${name} cell ${gx},${gy}`)
        }
      }
    }
  }
})

test('a route costs no more than the cheapest one a search of the whole floor finds, into snug spots too', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = random(seed * 7)
    const grid = walkGrid(floor(seed, 90, 70, 30))
    for (let k = 0; k < 4; k++) {
      // any cell, open or snug
      const start = Math.floor(r() * grid.W * grid.H)
      const goal = Math.floor(r() * grid.W * grid.H)
      const search = routeSearch(grid, start, goal)
      while (!search.done) search.step(1000)
      const best = plainCost(grid, start, goal)
      if (best === Infinity) {
        assert.equal(search.cells, null)
        continue
      }
      assert.equal(search.cells[0], start)
      assert.equal(search.cells[search.cells.length - 1], goal)
      assert.equal(costOf(grid, search.cells), best, `seed ${seed}, route ${k}`)
    }
  }
})

test('a search takes no more than it is given beyond getting ready and laying out its route, and finds the same route in slices', () => {
  const grid = walkGrid(floor(3, 400, 1200, 400))
  const start = grid.W * 10 + 10
  const goal = grid.W * (grid.H - 10) + grid.W - 10
  const whole = routeSearch(grid, start, goal)
  const all = whole.step(Infinity)
  const sliced = routeSearch(grid, start, goal)
  let frames = 0
  let total = 0
  while (!sliced.done) {
    const used = sliced.step(500)
    const allowed = 500 + (frames === 0 ? SEARCH_SETUP : 0) + (sliced.done ? sliced.cells.length : 0)
    assert.ok(used <= allowed, `took ${used} of ${allowed}`)
    total += used
    frames++
  }
  assert.ok(frames > 1, 'a long route should take several slices')
  assert.equal(total, all)
  assert.deepEqual(sliced.cells, whole.cells)
})

/** Asks `planner` for every trip each frame until all have their route; the most one frame took. */
function plan(planner: any, grid: any, trips: { key: string; start: number; goal: number }[], frames = 10000) {
  const routes = new Map<string, number[] | null>()
  let worstWork = 0
  let worstCpu = 0
  let longest = 0
  let total = 0
  let frame = 0
  for (; routes.size < trips.length; frame++) {
    assert.ok(frame < frames, `${trips.length - routes.size} routes never came`)
    planner.frame()
    // processor time, not the clock: the test should not fail because the machine is busy
    const c0 = process.cpuUsage()
    for (const { key, start, goal } of trips) {
      if (routes.has(key)) continue
      const found = planner.route(key, grid, start, goal)
      if (found) {
        routes.set(key, found.cells)
        longest = Math.max(longest, found.cells?.length ?? 0)
      }
    }
    const c = process.cpuUsage(c0)
    worstCpu = Math.max(worstCpu, (c.user + c.system) / 1000)
    worstWork = Math.max(worstWork, planner.spent)
    total += planner.spent
  }
  return { routes, worstWork, worstCpu, longest, total, frames: frame }
}

test('however many set off at once, a frame searches no more than its budget, and each gets its route', () => {
  const grid = walkGrid(floor(5, 300, 900, 300))
  const planner = routePlanner(20000)
  const r = random(11)
  // two dozen specialists arriving together, from the door to their desks
  const trips = Array.from({ length: 24 }, (_, i) => ({ key: `visit:${i}`, start: grid.W * 400 + 4, goal: Math.floor(r() * grid.W * grid.H) }))
  const { routes, worstWork, longest, total, frames } = plan(planner, grid, trips)
  assert.ok(worstWork <= 20000 + SEARCH_SETUP + longest, `a frame took ${worstWork}`)
  // what a frame overran comes off the next one
  assert.ok(total <= frames * 20000 + SEARCH_SETUP + longest, `${total} in ${frames} frames`)
  for (const { key, start, goal } of trips) {
    const search = routeSearch(grid, start, goal)
    search.step(Infinity)
    assert.deepEqual(routes.get(key), search.cells, key)
  }
  assert.equal(planner.pending, 0)
})

test('four hundred new routes asked for in one frame on a big floor never hold up a frame', () => {
  // a hall about the size of four hundred desks, and everyone on it setting off at once for
  // somewhere in their part of it
  const grid = walkGrid(floor(9, 432, 6000, 1500))
  const planner = routePlanner(100000, { ms: 10 })
  const r = random(17)
  const open = (cell: number) => grid.side[cell] && grid.upright[cell]
  const near = (from: number) => {
    for (;;) {
      const x = (from % grid.W) + Math.round((r() - 0.5) * 120)
      const y = Math.floor(from / grid.W) + Math.round((r() - 0.5) * 160)
      if (x < 0 || y < 0 || x >= grid.W || y >= grid.H) continue
      if (open(y * grid.W + x)) return y * grid.W + x
    }
  }
  const trips = Array.from({ length: 400 }, (_, i) => {
    let start = 0
    while (!open(start)) start = Math.floor(r() * grid.W * grid.H)
    return { key: `walk:${i}`, start, goal: near(start) }
  })
  const { worstWork, worstCpu, longest, frames } = plan(planner, grid, trips, 2000)
  assert.ok(worstWork <= 100000 + SLICE + SEARCH_SETUP + longest, `a frame took ${worstWork}`)
  // 10 ms of searching a frame and a slice over; the panel draws a frame every 125 ms
  assert.ok(worstCpu < 60, `a frame took ${worstCpu.toFixed(0)} ms`)
  assert.ok(frames > 1, 'that much searching should take several frames')
})

test('a long way round asked for first does not hold up the short routes asked after it', () => {
  // a winding floor: walls across it every 40 px, with the gap at alternate ends
  const blocks: Box[] = []
  for (let y = 40, i = 0; y < 1160; y += 40, i++) blocks.push(i % 2 ? [40, y, 392, 4] : [0, y, 392, 4])
  const grid = walkGrid({ w: 432, h: 1200, wall: 4, size: 2, feet: { side: [1, 12, 6, 3], upright: [1, 12, 6, 3] }, blocks })
  const at = (x: number, y: number) => Math.floor(y / 2) * grid.W + Math.floor(x / 2)
  const far = { key: 'walk:far', start: at(200, 8), goal: at(200, 1170) }
  // two dozen short walks along one corridor each
  const near = Array.from({ length: 25 }, (_, i) => ({ key: `visit:${i}`, start: at(60 + i, 40 * (i + 1) + 10), goal: at(300 - i, 40 * (i + 1) + 10) }))
  const planner = routePlanner(100000)
  const found = new Map<string, { frame: number; cells: number[] | null }>()
  let longest = 0
  for (let frame = 0; found.size < near.length + 1; frame++) {
    assert.ok(frame < 1000, 'the routes never came')
    planner.frame()
    for (const t of [far, ...near]) {
      if (found.has(t.key)) continue
      const route = planner.route(t.key, grid, t.start, t.goal)
      if (route) {
        found.set(t.key, { frame, cells: route.cells })
        longest = Math.max(longest, route.cells?.length ?? 0)
      }
    }
    assert.ok(planner.spent <= 100000 + SEARCH_SETUP + longest, `frame ${frame} took ${planner.spent}`)
  }
  const exact = routeSearch(grid, far.start, far.goal)
  const steps = exact.step(Infinity)
  assert.ok(steps > LONG_SEARCH * 4, 'the long way should be a long search')
  for (const t of near) assert.ok(found.get(t.key)!.frame <= 1, `${t.key} waited ${found.get(t.key)!.frame} frames`)
  // it still gets the shortest way, only later
  assert.deepEqual(found.get(far.key)!.cells, exact.cells)
})

test('asking for another route replaces the one in the making, and one nobody asks after is dropped', () => {
  const grid = walkGrid(floor(2, 400, 1200, 300))
  const planner = routePlanner(10)
  const far = grid.W * (grid.H - 8) + grid.W - 8
  planner.frame()
  assert.equal(
    planner.ask('a', 'far', () => routeSearch(grid, grid.W * 8 + 8, far)),
    null
  )
  assert.equal(
    planner.ask('b', 'far', () => routeSearch(grid, grid.W * 8 + 8, far)),
    null
  )
  assert.equal(planner.pending, 2)
  planner.frame()
  // 'a' wants to go somewhere else now; nobody asks after 'b'
  assert.equal(
    planner.ask('a', 'near', () => routeSearch(grid, grid.W * 8 + 8, grid.W * 8 + 9)),
    null
  )
  planner.frame()
  assert.equal(planner.pending, 1)
  let found = null
  // getting the first search ready overran this tiny budget, which the next frames pay back
  for (let i = 0; i < 1000 && !found; i++) {
    found = planner.ask('a', 'near', () => routeSearch(grid, 0, 0))
    planner.frame()
  }
  assert.deepEqual(found?.cells, [grid.W * 8 + 8, grid.W * 8 + 9])
  assert.equal(planner.pending, 0)
})

test('an agent moving to another spot keeps its spot and what it does there until its route is found', () => {
  const coffee = { x: 10, y: 50, left: false }
  const booth = { x: 80, y: 40, left: true }
  const home = { x: 30, y: 10 }
  const w = { x: 10, y: 50, path: [], mode: 'away', spot: coffee, activity: { kind: 'coffee' }, left: false }
  let ready: { x: number; y: number }[] | null = null
  const route = () => ready
  // the corner reshuffled: a booth now, but the way there is still being planned
  breakWalk(w, { spot: booth, activity: { kind: 'booth' }, home, primed: true }, route, 0)
  assert.equal(w.spot, coffee)
  assert.deepEqual(w.activity, { kind: 'coffee' })
  assert.equal(w.mode, 'away')
  ready = [{ x: 80, y: 40 }]
  breakWalk(w, { spot: booth, activity: { kind: 'booth' }, home, primed: true }, route, 0)
  assert.equal(w.spot, booth)
  assert.deepEqual(w.activity, { kind: 'booth' })
  assert.equal(w.mode, 'out')
  assert.deepEqual(w.path, [{ x: 80, y: 40 }])
})

test('an agent gets up from its desk, or heads back to it, only once the way is found', () => {
  const spot = { x: 10, y: 50 }
  const home = { x: 30, y: 10 }
  const activity = { kind: 'coffee' }
  let ready: { x: number; y: number }[] | null = null
  const route = () => ready
  assert.equal(breakWalk(undefined, { spot, activity, home, primed: true }, route, 0), undefined)
  // on a break already when the panel opened: no walk needed
  assert.equal(breakWalk(undefined, { spot, activity, home, primed: false }, route, 0)?.mode, 'away')
  ready = [{ x: 10, y: 50 }]
  const w = breakWalk(undefined, { spot, activity, home, primed: true }, route, 0)
  assert.equal(w?.mode, 'out')
  w.mode = 'away'
  ready = null
  breakWalk(w, { spot: undefined, activity: null, home, primed: true }, route, 0)
  assert.equal(w.mode, 'away')
  assert.deepEqual(w.activity, activity)
  ready = [{ x: 30, y: 10 }]
  breakWalk(w, { spot: undefined, activity: null, home, primed: true }, route, 0)
  assert.equal(w.mode, 'back')
  assert.equal(w.activity, null)
})

// A room with one big desk in the middle: going from its left side to its right side means going
// round its bottom edge.
const DESK: Box = [60, 40, 40, 60]
const room = () => walkGrid({ w: 200, h: 160, wall: 4, size: 2, feet: { side: [0, 0, 2, 2], upright: [0, 0, 2, 2] }, blocks: [DESK] })
const inDesk = (p: { x: number; y: number }) => p.x > DESK[0] && p.x < DESK[0] + DESK[2] && p.y > DESK[1] && p.y < DESK[1] + DESK[3]

/** Routes as the panel plans them: from wherever the walker is when it first asks. */
function planned(grid: any, planner: any, key: string) {
  const snap = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(v / 2)))
  return (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const found = planner.route(key, grid, snap(from.y, grid.H) * grid.W + snap(from.x, grid.W), snap(to.y, grid.H) * grid.W + snap(to.x, grid.W))
    if (!found) return null
    return [...found.cells.map((c: number) => ({ x: (c % grid.W) * 2, y: Math.floor(c / grid.W) * 2 })), { x: to.x, y: to.y }]
  }
}

test('an agent sent elsewhere halfway round a desk waits for its new route where it stands, and never cuts through the desk', () => {
  const grid = room()
  // one search step a frame: the new route takes longer than walking round the corner
  const planner = routePlanner(1)
  const route = planned(grid, planner, 'walk:a')
  const home = { x: 40, y: 70 }
  const coffee = { x: 120, y: 70 }
  const booth = { x: 30, y: 20 }
  let spot = coffee
  let w: any
  let waited = 0
  let sent = false
  for (let frame = 0; frame < 5000; frame++) {
    planner.frame()
    const before = w && { x: w.x, y: w.y }
    // halfway along the desk's bottom edge, the corner reshuffles: the booth instead
    if (w && !sent && w.y >= DESK[1] + DESK[3] && w.x > 70) {
      spot = booth
      sent = true
    }
    w = breakWalk(w, { spot, activity: { kind: spot === coffee ? 'coffee' : 'booth' }, home, primed: true }, route, 1.5)
    if (!w) continue
    if (w.planning) {
      waited++
      if (before) assert.deepEqual({ x: w.x, y: w.y }, before, 'it walked on while its route was planned')
      assert.equal(onTheMove(w), false, 'it is drawn mid-stride while it stands waiting')
    } else if (w.path.length) assert.equal(onTheMove(w), true)
    assert.ok(!inDesk(w), `frame ${frame}: walked through the desk at ${w.x.toFixed(1)},${w.y.toFixed(1)}`)
    if (sent && w.mode === 'away') break
  }
  assert.ok(sent && waited > 5, 'the new route should have taken several frames')
  assert.equal(w.mode, 'away')
  assert.deepEqual({ x: w.x, y: w.y }, { x: booth.x, y: booth.y })
})

test('a specialist called back on its way out waits for its new route where it stands, and never cuts through the desk', () => {
  const grid = room()
  const planner = routePlanner(1)
  // its stool is beside the desk's left side, the door is past the desk's bottom edge
  const stool = { at: { x: 50, y: 50 }, on: { x: 50, y: 50 } }
  const door = { x: 130, y: 104 }
  const routeIn = (v: any) => planned(grid, planner, 'visit:a')(v, stool.at)
  const routeOut = (v: any) => planned(grid, planner, 'visit:a')(v, door)
  const v: any = { x: 50, y: 50, path: [], mode: 'seated', stoolAt: stool.at, wait: 0 }
  let wanted: typeof stool | null = null
  let waited = 0
  let called = false
  for (let frame = 0; frame < 5000; frame++) {
    planner.frame()
    const before = { x: v.x, y: v.y }
    // halfway down the desk's left side on its way out, its agent needs it again
    if (!called && v.mode === 'out' && v.y >= 75 && v.x < 58) {
      wanted = stool
      called = true
    }
    // someone else asked for a route first, so the specialist's comes a few dozen frames later
    if (called) planner.ask('walk:other', 'other', () => routeSearch(grid, grid.W * 2 + 2, grid.W * 2 + 32))
    const here = visitorWalk(v, wanted, routeIn, routeOut, 1.5)
    assert.ok(here, 'it left although it was called back')
    if (v.planning) {
      waited++
      assert.deepEqual({ x: v.x, y: v.y }, before, 'it walked on while its route was planned')
      assert.equal(onTheMove(v), false, 'it is drawn mid-stride while it stands waiting')
    } else if (v.path.length) assert.equal(onTheMove(v), true)
    assert.ok(!inDesk(v), `frame ${frame}: walked through the desk at ${v.x.toFixed(1)},${v.y.toFixed(1)}`)
    if (called && v.mode === 'seated') break
  }
  assert.ok(called && waited > 20, 'the new route should have taken several frames')
  assert.equal(v.mode, 'seated')
  assert.deepEqual({ x: v.x, y: v.y }, stool.at)
})

test('a route asked for from somewhere else is planned afresh, and starts there', () => {
  const grid = room()
  const planner = routePlanner(1)
  const a = grid.W * 35 + 20
  const b = grid.W * 35 + 60
  const goal = grid.W * 10 + 15
  planner.frame()
  assert.equal(planner.route('walk:a', grid, a, goal), null)
  let found = null
  for (let i = 0; i < 1000 && !found; i++) {
    planner.frame()
    found = planner.route('walk:a', grid, b, goal)
  }
  assert.equal(found?.cells?.[0], b)
})

test('an agent waiting behind others to get up, whose desk moves meanwhile, sets off from its desk as it is now', () => {
  const grid = room()
  const planner = routePlanner(100)
  const route = planned(grid, planner, 'walk:a')
  const coffee = { x: 110, y: 20 }
  // its desk is left of the big desk, then the office is rearranged and it is right of it
  let home = { x: 40, y: 70 }
  let w: any
  for (let frame = 0; frame < 5000; frame++) {
    planner.frame()
    // two dozen others asked first, so its route waits its turn for a while
    if (frame < 30) for (let i = 0; i < 24; i++) planner.ask(`visit:${i}`, 'busy', () => routeSearch(grid, grid.W * 2 + 2, grid.W * (grid.H - 3) + grid.W - 3))
    if (frame === 10) home = { x: 120, y: 70 }
    const before = w
    w = breakWalk(w, { spot: coffee, activity: { kind: 'coffee' }, home, primed: true }, route, 1.5)
    if (!w) continue
    if (!before) {
      assert.ok(frame > 10, 'its route should have waited until after the desk moved')
      assert.ok(Math.hypot(w.x - home.x, w.y - home.y) <= 1.5, 'it should get up at its desk')
    }
    assert.ok(!inDesk(w), `frame ${frame}: walked through the desk at ${w.x.toFixed(1)},${w.y.toFixed(1)}`)
    if (w.mode === 'away') break
  }
  assert.equal(w?.mode, 'away')
})
