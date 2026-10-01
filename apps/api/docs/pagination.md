# Pagination

`GET /api/links` and `GET /api/keys` currently return complete arrays. Neither accepts a cursor, page, limit, or offset parameter. Do not assume a `next_cursor` field exists. Both lists are ordered newest first.
