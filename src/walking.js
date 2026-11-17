// Finding the way across the floor, a little each frame.
// Everyone walks the open floor: a grid search over where their feet may go, around the floor
// space each desk and piece of furniture stands on. A big team's loft has a floor many times the
// panel's size, and many people can set off at once, so no frame searches more than a fixed number
// of steps: a route that is not found yet is simply found on the frames after, and whoever asked
// for it waits where they are until then. On an ordinary floor every route is found at once.

export const TURN_COST = 10 // what a turn costs, in steps: long straight runs read as walking with purpose
export const BLOCKED_COST = 1000

/**
 * Where feet may go on a grid of `size` art pixels: for each cell, whether feet standing there
 * side-on (`side`) and upright (`upright`) stay inside the walls and clear of every obstacle. Each
 * of `feet.side` and `feet.upright` is the feet's box at (0, 0), `[x, y, w, h]`; the box at a cell
 * is that box moved to the cell's corner. Obstacles are marked on the grid one by one, so a floor
 * with hundreds of desks builds as fast as an empty one.
 */
export function walkGrid({ w, h, wall, size, feet, blocks }) {
  const W = Math.ceil(w / size)
  const H = Math.ceil(h / size)
  const mark = ([fx, fy, fw, fh]) => {
    const open = new Uint8Array(W * H)
    // cells whose box lies inside the walls: x >= wall and x + w <= w - wall, the same for y
    const x0 = Math.max(0, Math.ceil((wall - fx) / size))
    const x1 = Math.min(W - 1, Math.floor((w - wall - fx - fw) / size))
    const y0 = Math.max(0, Math.ceil((wall - fy) / size))
    const y1 = Math.min(H - 1, Math.floor((h - wall - fy - fh) / size))
    for (let gy = y0; gy <= y1; gy++) open.fill(1, gy * W + x0, gy * W + x1 + 1)
    // cells whose box overlaps an obstacle: bx - fw < x + fx < bx + bw, the same for y
    for (const [bx, by, bw, bh] of blocks) {
      const a0 = Math.max(0, Math.floor((bx - fx - fw) / size) + 1)
      const a1 = Math.min(W - 1, Math.ceil((bx + bw - fx) / size) - 1)
      const b0 = Math.max(0, Math.floor((by - fy - fh) / size) + 1)
      const b1 = Math.min(H - 1, Math.ceil((by + bh - fy) / size) - 1)
      if (a0 > a1) continue
      for (let gy = b0; gy <= b1; gy++) open.fill(0, gy * W + a0, gy * W + a1 + 1)
    }
    return open
  }
  return { W, H, size, side: mark(feet.side), upright: mark(feet.upright) }
}

const SNUG_REACH = 16 // cells around a goal searched for the blocked steps it takes to get in
/** The most a search takes to get ready: looking at every cell around its goal, and its start. */
export const SEARCH_SETUP = (2 * SNUG_REACH + 1) ** 2 + 1

/**
 * The blocked steps a way into `goal` takes at least, from any cell, times what each costs beyond a
 * plain step. A snug spot (a seat on the sofa, a chair at a table) is reached through furniture;
 * without counting that up front, the search would look at every cell up to a thousand steps round
 * before taking those steps. Counted by a search out from the goal over the cells near it; from
 * further away, the least any cell on that edge needs.
 */
export function snugness(grid, goal) {
  const { W, H, side, upright } = grid
  const gx = goal % W
  const gy = Math.floor(goal / W)
  const x0 = Math.max(0, gx - SNUG_REACH)
  const x1 = Math.min(W - 1, gx + SNUG_REACH)
  const y0 = Math.max(0, gy - SNUG_REACH)
  const y1 = Math.min(H - 1, gy + SNUG_REACH)
  const w = x1 - x0 + 1
  const near = new Int16Array(w * (y1 - y0 + 1)).fill(-1)
  const at = (x, y) => (y - y0) * w + (x - x0)
  // 0-1 search: a step into a cell costs one when the feet do not fit there going that way
  // a cell goes in at most once per way in, either end
  const queue = new Int32Array(near.length * 8 + 1)
  let head = near.length * 4
  let tail = head
  near[at(gx, gy)] = 0
  queue[tail++] = goal
  let edge = Infinity
  let work = 0
  while (head < tail) {
    const cell = queue[head++]
    work++
    const x = cell % W
    const y = Math.floor(cell / W)
    const b = near[at(x, y)]
    if (x === x0 || x === x1 || y === y0 || y === y1) edge = Math.min(edge, b)
    const moves = [
      [x - 1, y, side], // stepping in from the left, side-on
      [x + 1, y, side],
      [x, y - 1, upright],
      [x, y + 1, upright]
    ]
    for (const [nx, ny, free] of moves) {
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue
      const nb = b + (free[cell] ? 0 : 1)
      const i = at(nx, ny)
      if (near[i] !== -1 && near[i] <= nb) continue
      near[i] = nb
      if (nb === b) queue[--head] = ny * W + nx
      else queue[tail++] = ny * W + nx
    }
  }
  if (edge === Infinity) edge = 0
  const extra = BLOCKED_COST - 1
  const at_ = (cell) => {
    const x = cell % W
    const y = Math.floor(cell / W)
    if (x < x0 || x > x1 || y < y0 || y > y1) return edge * extra
    const b = near[at(x, y)]
    return (b === -1 ? edge : Math.min(b, edge)) * extra
  }
  // what finding this took, in cells taken off the queue
  at_.work = work
  return at_
}

/** Arrays as big as a floor's search, made once and reused: a search marks what it has reached. */
export function searchScratch() {
  let held = null
  return (n) => {
    if (!held || held.cost.length < n) held = { cost: new Int32Array(n), prev: new Int32Array(n), seen: new Uint32Array(n), mark: 0 }
    // a new mark makes everything an earlier search reached unreached again, without clearing
    if (++held.mark === 0xffffffff) {
      held.seen.fill(0)
      held.mark = 1
    }
    return held
  }
}

/**
 * A* from cell `start` to cell `goal` over (cell, heading); headings 0 and 1 move along x, 2 and 3
 * along y. A step costs 1, or BLOCKED_COST onto a cell the feet do not fit (so nobody is ever stuck
 * in a snug spot, but nobody cuts through furniture while there is a way round), plus TURN_COST for
 * a turn. The estimate of what is left never exceeds it, so the route is a cheapest one, as the
 * plain search over the whole floor found.
 *
 * Making one costs nothing; `step(budget)` does the work and says how many units it took: looking
 * around the goal for how snug it is, every cell taken off the queue, and laying out the route at
 * the end each count. It takes no more than `budget`, except that getting ready (at most
 * SEARCH_SETUP) and laying out the route it found are done whole. Once `done`, `cells` is the route from
 * start to goal, or null when there is none. Searches can share their big arrays (`scratch`, from
 * `searchScratch`, and `snugAt(grid, goal)`, a cache of how snug each goal is) as long as only one
 * of them is under way at a time.
 */
export function routeSearch(grid, start, goal, { scratch = searchScratch(), snugAt = snugness } = {}) {
  const { W, H, side, upright } = grid
  const STEP = [1, -1, W, -W]
  const gx = goal % W
  const gy = Math.floor(goal / W)
  let snug = null
  // What is left, at least: a step for each cell across and up or down, the fewest turns that
  // takes from this heading, and the blocked steps into a snug goal.
  const toGo = (cell, heading) => {
    if (cell === goal) return 0
    const dx = gx - (cell % W)
    const dy = gy - Math.floor(cell / W)
    // the headings that close the gap: 0 is +x, 1 is -x, 2 is +y, 3 is -y
    const hx = dx > 0 ? 0 : dx < 0 ? 1 : -1
    const hy = dy > 0 ? 2 : dy < 0 ? 3 : -1
    let turns
    if (hx >= 0 && hy >= 0) turns = heading === hx || heading === hy ? 1 : 2
    else turns = heading === hx || heading === hy ? 0 : 1
    return Math.abs(dx) + Math.abs(dy) + turns * TURN_COST + snug(cell)
  }
  let held = null // the shared arrays, while this search is under way
  let cost = null // best cost so far by (cell, heading), where `seen` holds this search's mark
  let prev = null
  let seen = null
  let mark = 0
  // a binary heap of (estimate, node) in two growing arrays
  let keys = null
  let nodes = null
  let size = 0
  const push = (key, node) => {
    if (size === keys.length) {
      const k = new Int32Array(size * 2)
      k.set(keys)
      keys = k
      const n = new Int32Array(size * 2)
      n.set(nodes)
      nodes = n
    }
    let i = size++
    while (i > 0) {
      const j = (i - 1) >> 1
      if (keys[j] <= key) break
      keys[i] = keys[j]
      nodes[i] = nodes[j]
      i = j
    }
    keys[i] = key
    nodes[i] = node
  }
  const pop = () => {
    const node = nodes[0]
    const key = keys[--size]
    const last = nodes[size]
    let i = 0
    for (;;) {
      const a = 2 * i + 1
      if (a >= size) break
      const m = a + 1 < size && keys[a + 1] < keys[a] ? a + 1 : a
      if (keys[m] >= key) break
      keys[i] = keys[m]
      nodes[i] = nodes[m]
      i = m
    }
    keys[i] = key
    nodes[i] = last
    return node
  }
  const search = { done: false, cells: null, step }
  /** Gets ready to search; what that took. */
  function begin() {
    const found = snugAt(grid, goal)
    snug = found
    held = scratch(W * H * 4)
    ;({ cost, prev, seen, mark } = held)
    keys = new Int32Array(1024)
    nodes = new Int32Array(1024)
    for (let h = 0; h < 4; h++) {
      seen[start * 4 + h] = mark
      cost[start * 4 + h] = 0
      prev[start * 4 + h] = -1
      push(toGo(start, h), start * 4 + h)
    }
    return 1 + (found.work ?? 0)
  }
  /** Done; what laying out the route took. */
  function finish(end) {
    let work = 0
    if (end >= 0) {
      const cells = []
      for (let node = end; node >= 0; node = prev[node]) cells.push(node >> 2)
      search.cells = cells.reverse()
      work = cells.length
    }
    search.done = true
    held = cost = prev = seen = keys = nodes = null
    return work
  }
  function step(budget) {
    if (search.done || budget <= 0) return 0
    let used = held ? 0 : begin()
    while (used < budget) {
      if (size === 0) return used + finish(-1)
      const keyAt = keys[0]
      const node = pop()
      used++
      const cell = node >> 2
      const d = cost[node]
      if (keyAt > d + toGo(cell, node & 3)) continue // a stale entry, already reached for less
      if (cell === goal) return used + finish(node)
      const heading = node & 3
      const cx = cell % W
      for (let h = 0; h < 4; h++) {
        const next = cell + STEP[h]
        if (h === 0 ? cx === W - 1 : h === 1 ? cx === 0 : next < 0 || next >= W * H) continue
        const free = h < 2 ? side : upright
        const nd = d + (free[next] ? 1 : BLOCKED_COST) + (h === heading ? 0 : TURN_COST)
        const key = next * 4 + h
        if (seen[key] !== mark || nd < cost[key]) {
          seen[key] = mark
          cost[key] = nd
          prev[key] = node
          push(nd + toGo(next, h), key)
        }
      }
    }
    return used
  }
  return search
}

export const SLICE = 1024 // search steps between looks at the clock
// A search still going after this many steps is a long way round a big floor. It starts again in
// a lane of its own, so the routes asked for after it are not held up behind it.
export const LONG_SEARCH = 40000
const BACK_SHARE = 0.25 // of each frame, for the long ones, when there are any

/**
 * Hands out at most `budget` search steps a frame across everyone who wants a route, and aims to
 * stop once `ms` milliseconds of the frame have gone on it: a step on a big floor can cost ten
 * times one on a small floor, so the clock is what keeps a frame short. It looks at the clock
 * between slices of SLICE steps, and getting a search ready or laying out its route is done whole,
 * so a frame can go over by that much. Each asker (a `key`) has at most one route in the making;
 * asking again for the same route (`sig`) finds the same search, asking for another one replaces
 * it, and a search nobody asked after for a frame is dropped.
 *
 * Searches go in the order they were asked for, one at a time on shared arrays. One that runs past
 * LONG_SEARCH steps starts again in the back lane, on arrays of its own, one at a time there too:
 * it gets the first BACK_SHARE of each frame, and whatever the others leave.
 */
export function routePlanner(budget, { ms = Infinity, now = () => performance.now() } = {}) {
  const jobs = new Map() // key -> { sig, make, search, frame, back, steps }
  const gridIds = new WeakMap() // grid -> a number of its own, for telling routes apart
  let grids = 0
  let frame = 0
  let left = budget
  let given = budget
  let deadline = Infinity
  let backTurn = false // whether the back lane has had its share this frame
  // One search is under way at a time in each lane: the first unfinished one in line keeps going
  // until it is done or dropped, and nothing joins the line ahead of it. So each lane's searches
  // can share one set of arrays; the back lane's are let go when it is empty.
  const scratch = searchScratch()
  let backScratch = null
  const snugs = new Map() // `${grid}|${goal}` -> how snug that goal is; goals come up again and again
  const snugAt = (grid, goal) => {
    const key = `${gridIds.get(grid)}|${goal}`
    const known = snugs.get(key)
    if (known) return known.again
    const found = snugness(grid, goal)
    if (snugs.size >= 256) snugs.delete(snugs.keys().next().value)
    // the next search to this goal finds it for nothing
    snugs.set(key, { again: Object.assign((cell) => found(cell), { work: 0 }) })
    return found
  }
  /** Steps the first unfinished search in a lane until it is done, or `cap` steps or `until` run out. */
  const runLane = (back, cap, until) => {
    for (const job of jobs.values()) {
      if (job.back !== back || job.search.done) continue
      while (!job.search.done) {
        const room = Math.min(left, cap - (given - left))
        if (room <= 0 || now() >= until) return false
        const used = job.search.step(Math.min(room, SLICE))
        left -= used
        job.steps += used
        if (!back && !job.search.done && job.steps >= LONG_SEARCH) {
          // a long way round: it goes on behind the others, on arrays of its own
          backScratch ??= searchScratch()
          job.back = true
          job.search = job.make(backScratch)
          break
        }
      }
      if (back) return true
    }
    return true
  }
  const backWaiting = () => [...jobs.values()].some((job) => job.back && !job.search.done)
  const run = () => {
    if (!backTurn && backWaiting()) {
      backTurn = true
      runLane(true, Math.ceil(given * BACK_SHARE), Math.min(deadline, now() + ms * BACK_SHARE))
    }
    // then everyone else in turn, and the long ones again with what is left
    if (runLane(false, given, deadline)) runLane(true, given, deadline)
  }
  return {
    /**
     * A new frame: a fresh budget, less what the last one overran (a search's setup, or laying out
     * a route, is done whole), and the searches nobody asked after last frame go.
     */
    frame() {
      frame++
      left = given = budget + Math.min(0, left)
      deadline = ms === Infinity ? Infinity : now() + ms
      backTurn = false
      for (const [key, job] of jobs) if (job.frame < frame - 1) jobs.delete(key)
      if (![...jobs.values()].some((job) => job.back)) backScratch = null
    },
    /**
     * The finished search for `key` (its `cells` may be null: no way there), or null while it runs.
     * `start(arrays)` makes the search, on the lane's shared arrays.
     */
    ask(key, sig, start) {
      let job = jobs.get(key)
      if (!job || job.sig !== sig) {
        jobs.delete(key)
        job = { sig, make: start, search: start(scratch), frame, back: false, steps: 0 }
        jobs.set(key, job)
      }
      job.frame = frame
      if (!job.search.done) run()
      if (!job.search.done) return null
      jobs.delete(key)
      return job.search
    },
    /**
     * The route for `key` across `grid` from cell `start` to cell `goal`: the finished search, or
     * null while it runs. A route is the same route only on the same floor, between the same two
     * cells: asked from anywhere else (a desk that moved while its agent waited to get up), it is
     * planned afresh, so it always starts where it is asked from.
     */
    route(key, grid, start, goal) {
      if (!gridIds.has(grid)) gridIds.set(grid, ++grids)
      return this.ask(key, `${gridIds.get(grid)}|${start}|${goal}`, (arrays) => routeSearch(grid, start, goal, { scratch: arrays, snugAt }))
    },
    get pending() {
      return jobs.size
    },
    /** What searching took so far this frame. */
    get spent() {
      return given - left
    }
  }
}

// ---- walking it --------------------------------------------------------------------------------
// Someone already on their way who is sent somewhere else stands still while the new route is
// planned: the route starts where they stand, so when it comes they set off from there, never
// back to where they were when it was asked for (which, round a corner, could be through a desk).

/** One frame's step toward `next` along a straight line; true when it got there. */
export function stepToward(who, next, speed) {
  const dx = next.x - who.x
  const dy = next.y - who.y
  const d = Math.hypot(dx, dy)
  if (d <= speed) {
    who.x = next.x
    who.y = next.y
    return true
  }
  who.x += (dx / d) * speed
  who.y += (dy / d) * speed
  return false
}

/**
 * Whether someone is drawn mid-stride: they have somewhere to walk to and are not standing still
 * waiting for a new route.
 */
export const onTheMove = (who) => who.path.length > 0 && !who.planning

/** A frame along the path, facing the way they go; false once there is no more path. */
function walkOn(who, speed) {
  const next = who.path[0]
  if (!next) return false
  const dx = next.x - who.x
  who.left = dx < -0.5 ? true : dx > 0.5 ? false : who.left
  if (stepToward(who, next, speed)) who.path.shift()
  return true
}

/**
 * One frame of an agent's break: set off from its desk for its spot, move on to a new spot, or head
 * back to its desk, and take a step. `w` is its walk so far (none while it sits at its desk);
 * `route(from, to)` is the way there, or null while that is still being planned. The spot, the
 * mode and what it does there change together, only once the route is there, so nobody is ever
 * drawn doing one thing at another thing's place; until then it waits where it is (`planning`).
 * Returns the walk, or undefined while it sits at its desk or once it is back there.
 */
export function breakWalk(w, { spot, activity, home, primed }, route, speed) {
  if (!w) {
    if (!spot) return undefined
    // already on a break when the panel opened
    if (!primed) return { x: spot.x, y: spot.y, path: [], mode: 'away', spot, activity, left: spot.left, planning: false }
    const path = route(home, spot)
    if (!path) return undefined
    w = { ...home, path, mode: 'out', spot, activity, planning: false }
  } else if (spot && (w.mode === 'back' || w.spot.x !== spot.x || w.spot.y !== spot.y)) {
    // a new spot in the band (the corner reshuffled, or coffee turned into a nap), or called back
    // out on the way to the desk
    const path = route(w, spot)
    w.planning = !path
    if (path) Object.assign(w, { path, mode: 'out', spot, activity })
  } else if (spot) {
    w.planning = false
    w.activity = activity
  } else if (w.mode !== 'back') {
    const path = route(w, home)
    w.planning = !path
    if (path) Object.assign(w, { path, mode: 'back', activity: null })
  } else w.planning = false
  if (w.planning || walkOn(w, speed)) return w
  if (w.mode === 'out') {
    w.mode = 'away'
    w.left = w.spot.left ?? false
  }
  return w.mode === 'back' ? undefined : w
}

/**
 * One frame of a specialist already on the floor: called back in, moved to another stool, or sent
 * home, and a step. `stool` is `{ at, on }`, the stool it is wanted on and where it sits on it, or
 * null once its agent no longer needs it; `routeIn(v)` and `routeOut(v)` are the ways there, or
 * null while being planned. A new route takes over, with the stool it leads to, only once it is
 * there; until then the specialist waits where it is. Returns false once it has walked out the
 * door.
 */
export function visitorWalk(v, stool, routeIn, routeOut, speed) {
  let path = null
  v.planning = false
  if (stool && v.mode === 'out') {
    // called back in before reaching the door
    path = routeIn(v)
    if (path) Object.assign(v, { path, mode: 'in', stoolAt: stool.at })
    v.planning = !path
  } else if (stool && (v.stoolAt.x !== stool.at.x || v.stoolAt.y !== stool.at.y)) {
    // the desk moved (a stool was added or taken away): to the new stool
    if (v.mode === 'seated') Object.assign(v, stool.on, { stoolAt: stool.at })
    else {
      path = routeIn(v)
      if (path) Object.assign(v, { path, stoolAt: stool.at })
      v.planning = !path
    }
  } else if (!stool && v.mode !== 'out') {
    path = routeOut(v)
    if (path) Object.assign(v, { path, mode: 'out', wait: 0 })
    v.planning = !path
  }
  if (v.planning) return true
  if (v.wait > 0) {
    v.wait--
    return true
  }
  if (walkOn(v, speed)) return true
  if (v.mode === 'in') v.mode = 'seated'
  return v.mode !== 'out'
}
