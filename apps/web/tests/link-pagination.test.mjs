import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLinkPage } from '../src/link-pagination.ts'

const links = (count) => Array.from({ length: count }, (_, index) => ({ id: String(index) }))

test('empty and single-page lists have safe page and range values', () => {
  assert.deepEqual(getLinkPage([], 1), {
    links: [], page: 1, pageCount: 1, start: 0, end: 0,
  })
  for (const count of [1, 9, 10]) {
    const items = links(count)
    assert.deepEqual(getLinkPage(items, 1), {
      links: items, page: 1, pageCount: 1, start: 1, end: count,
    })
  }
})

test('pages contain at most ten links with no gaps, duplicates, or reordering', () => {
  const items = links(23)
  const pages = [1, 2, 3].map((page) => getLinkPage(items, page))
  assert.deepEqual(pages.map(({ start, end }) => [start, end]), [[1, 10], [11, 20], [21, 23]])
  assert.ok(pages.every(({ links, pageCount }) => links.length <= 10 && pageCount === 3))
  assert.deepEqual(pages.flatMap(({ links }) => links), items)
})

test('out-of-range navigation stays within the first and last pages', () => {
  const items = links(11)
  assert.equal(getLinkPage(items, 0).page, 1)
  assert.deepEqual(getLinkPage(items, 3), {
    links: items.slice(10), page: 2, pageCount: 2, start: 11, end: 11,
  })
})

test('deleting the only link on the last page falls back to the previous page', () => {
  const items = links(21)
  assert.equal(getLinkPage(items, 3).links[0].id, '20')
  const afterDelete = getLinkPage(items.slice(0, -1), 3)
  assert.equal(afterDelete.page, 2)
  assert.equal(afterDelete.pageCount, 2)
  assert.deepEqual(afterDelete.links, items.slice(10, 20))
  assert.equal(getLinkPage([], 2).page, 1)
})

test('page one shows a newly prepended link while leaving the full list available for totals', () => {
  const items = links(20)
  const created = { id: 'new' }
  const updated = [created, ...items]
  const firstPage = getLinkPage(updated, 1)
  assert.equal(firstPage.links[0], created)
  assert.equal(firstPage.pageCount, 3)
  assert.equal(updated.length, 21)
  assert.equal(items.length, 20)
})
