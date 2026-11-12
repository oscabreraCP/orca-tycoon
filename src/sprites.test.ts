// The glyph table behind the pixel markers: every character the panel and the sprites draw must
// have a 3 x 5 bitmap, or glyph() silently paints nothing.
import { assert, test } from 'orca/testing'
import { C, GLYPHS, GOLD, GOLD_LIGHT, RUBY, XMAS, christmasTree, costumeOf, crown, getTheme, glyph, holidayLights, look, person, setTheme, workstation } from './sprites.js'

test('every glyph the office draws exists and is 3 x 5', () => {
  for (const ch of ['?', '!', 'z', '+']) {
    const rows = GLYPHS[ch]
    assert.ok(rows, `no glyph for ${ch}`)
    assert.equal(rows.length, 5, `${ch} is not 5 rows tall`)
    for (const row of rows) assert.equal(row.length, 3, `${ch} has a row that is not 3 wide`)
  }
})

test('the + marker paints a cross of five pixels at its origin', () => {
  const painted: string[] = []
  glyph((x: number, y: number) => painted.push(`${x},${y}`), '+', 10, 20, '#fff')
  assert.deepEqual(painted.sort(), ['11,21', '10,22', '11,22', '12,22', '11,23'].sort())
})

test('an agent on a paired server works on a thin client, a local one on a dark monitor', () => {
  const paint = (remote: boolean, state = 'working', t = 2) => {
    const px = new Map<string, string>()
    workstation((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.set(`${x + i},${y + j}`, c)
    }, { id: 'a', state }, t, false, remote)
    return px
  }
  const local = paint(false)
  const remote = paint(true)
  assert.equal(local.get('5,9'), C.frame)
  assert.equal(local.has('2,12'), false)
  assert.equal(remote.get('5,9'), C.thinFrame)
  assert.equal(remote.get('2,12'), C.thinBox)
  // the link light blinks while the far machine is busy, and stays dark when it is not
  assert.equal(paint(true, 'working', 2).get('2,11'), C.blue)
  assert.equal(paint(true, 'working', 0).get('2,11'), C.thinEdge)
  assert.equal(paint(true, 'done', 2).get('2,11'), C.thinEdge)
})

test('a waiting agent paints an animated question mark overhead', () => {
  const px = new Map<string, string>()
  workstation((x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.set(`${x + i},${y + j}`, c)
  }, { id: 'a', state: 'waiting' }, 0, false, false)
  // qx = 9, qy = -3, glyph '?' starts at (9, -3) with color GOLD_LIGHT
  assert.equal(px.get('9,-3'), GOLD_LIGHT)
  assert.equal(px.get('10,-3'), GOLD_LIGHT)
  assert.equal(px.get('11,-3'), GOLD_LIGHT)
})

test('crown paints a golden 6-pixel wide crown with peaks and a ruby', () => {
  const px = new Map<string, string>()
  crown((x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.set(`${x + i},${y + j}`, c)
  }, 10, 20)
  // center peak is tallest (y - 2 = 18)
  assert.equal(px.get('12,18'), GOLD_LIGHT)
  assert.equal(px.get('13,18'), GOLD_LIGHT)
  // left and right peaks (y - 1 = 19)
  assert.equal(px.get('10,19'), GOLD_LIGHT)
  assert.equal(px.get('15,19'), GOLD_LIGHT)
  // body is gold
  assert.equal(px.get('10,20'), GOLD)
  // ruby in center of base band (y + 1 = 21)
  assert.equal(px.get('12,21'), RUBY)
  assert.equal(px.get('13,21'), RUBY)
})

test('a leader person wears a crown on their head', () => {
  const px = new Map<string, string>()
  const staff = { id: 'lead1', state: 'working', isLeader: true }
  person((x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.set(`${x + i},${y + j}`, c)
  }, staff, 0)
  // crown rests on head: base band ruby at y=1, body at y=0, peaks at y=-1 and -2
  assert.equal(px.get('9,1'), RUBY)
  assert.equal(px.get('10,1'), RUBY)
  assert.equal(px.get('9,0'), GOLD)
  assert.equal(px.get('7,-1'), GOLD_LIGHT)
  assert.equal(px.get('9,-2'), GOLD_LIGHT)
})

test('christmas theme dresses characters in festive costumes and draws tree and lights', () => {
  try {
    setTheme('christmas')
    assert.equal(getTheme(), 'christmas')

    // Costumes cover santa, elf, reindeer, grinch deterministically
    const costumes = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => costumeOf(id)))
    assert.ok(costumes.size >= 2)
    for (const c of costumes) {
      assert.ok(['santa', 'elf', 'reindeer', 'grinch'].includes(c))
    }

    // Look returns festive costume when theme is christmas
    const lk = look('agent-1')
    assert.ok(lk.costume)

    // Christmas tree draws star topper and trunk
    const treePx = new Map<string, string>()
    christmasTree((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) treePx.set(`${x + i},${y + j}`, c)
    }, 0)
    assert.equal(treePx.get('7,-1'), C.white)
    assert.equal(treePx.get('7,17'), XMAS.woodTrunk)

    // Holiday lights draw across width
    const lightPx = new Map<string, string>()
    holidayLights((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) lightPx.set(`${x + i},${y + j}`, c)
    }, 24, 0)
    assert.ok(lightPx.size > 0)
  } finally {
    setTheme('normal')
  }
})
