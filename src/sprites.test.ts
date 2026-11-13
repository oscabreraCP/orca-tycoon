// The glyph table behind the pixel markers: every character the panel and the sprites draw must
// have a 3 x 5 bitmap, or glyph() silently paints nothing.
import { assert, test } from 'orca/testing'
import { C, GLYPHS, XMAS, christmasTree, costumeOf, getTheme, glyph, holidayLights, inChristmasSeason, look, setTheme, workstation } from './sprites.js'

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

test('christmas theme dresses characters in festive costumes and draws tree and lights', () => {
  try {
    setTheme('christmas')
    assert.equal(getTheme(), 'christmas')

    const costumes = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => costumeOf(id)))
    assert.ok(costumes.size >= 2)
    for (const c of costumes) {
      assert.ok(['santa', 'elf', 'reindeer', 'grinch'].includes(c))
    }

    const lk = look('agent-1')
    assert.ok(lk.costume)

    const treePx = new Map<string, string>()
    christmasTree((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) treePx.set(`${x + i},${y + j}`, c)
    }, 0)
    assert.equal(treePx.get('7,-1'), C.white)
    assert.equal(treePx.get('7,17'), XMAS.woodTrunk)

    const lightPx = new Map<string, string>()
    holidayLights((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) lightPx.set(`${x + i},${y + j}`, c)
    }, 24, 0)
    assert.ok(lightPx.size > 0)
  } finally {
    setTheme('normal')
  }
})

test('a waiting agent paints an animated question mark overhead', () => {
  const px = new Map<string, string>()
  workstation((x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.set(`${x + i},${y + j}`, c)
  }, { id: 'a', state: 'waiting' }, 0, false, false)
  // the '?' top bar sits beside the head at (15..17, 0), then bobs down a pixel
  assert.equal(px.get('15,0'), C.amber)
  assert.equal(px.get('17,0'), C.amber)
  // nothing is painted above the seat's own cell, into the row above
  assert.ok([...px.keys()].every((k) => Number(k.split(',')[1]) >= 0))
})

test('the christmas theme is offered from 15 November through 1 January only', () => {
  const on = (y: number, m: number, d: number) => inChristmasSeason(new Date(y, m - 1, d, 12))
  assert.equal(on(2026, 11, 14), false)
  assert.equal(on(2026, 11, 15), true)
  assert.equal(on(2026, 12, 31), true)
  assert.equal(on(2027, 1, 1), true)
  assert.equal(on(2027, 1, 2), false)
  assert.equal(on(2027, 7, 1), false)
})
