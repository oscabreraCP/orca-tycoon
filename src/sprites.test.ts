// The glyph table behind the pixel markers: every character the panel and the sprites draw must
// have a 3 x 5 bitmap, or glyph() silently paints nothing.
import { assert, test } from 'orca/testing'
import { GLYPHS, glyph } from './sprites.js'

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
