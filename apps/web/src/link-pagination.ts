const LINKS_PER_PAGE = 10

export function getLinkPage<T>(links: readonly T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(links.length / LINKS_PER_PAGE))
  const page = Math.max(1, Math.min(requestedPage, pageCount))
  const offset = (page - 1) * LINKS_PER_PAGE

  return {
    links: links.slice(offset, offset + LINKS_PER_PAGE),
    page,
    pageCount,
    start: links.length === 0 ? 0 : offset + 1,
    end: Math.min(offset + LINKS_PER_PAGE, links.length),
  }
}
