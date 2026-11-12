// The glyph table behind the pixel markers: every character the panel and the sprites draw must
// have a 3 x 5 bitmap, or glyph() silently paints nothing.
import { assert, test } from 'orca/testing'
import { C, GLYPHS, glyph, workstation } from './sprites.js'

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
  // qx = 9, qy = -3, glyph '?' starts at (9, -3) with color C.amber
  assert.equal(px.get('9,-3'), C.amber)
  assert.equal(px.get('10,-3'), C.amber)
  assert.equal(px.get('11,-3'), C.amber)
})
