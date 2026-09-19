# Reactions API

Emoji + image reactions against opaque consumer-supplied target keys.
Idempotent PUT/DELETE; aggregates computed at read time.

## Endpoints

### `PUT /api/v1/reactions`

Add a reaction. Idempotent: re-sending the same
`(target_key, actor_id, kind, value)` is a no-op (returns `created:
false`).

**Auth**: `Authorization: Bearer mk_<key>` with `reactions:write`
scope.

**Rate limit**: 60 req/min per API key id (writes).

**Body**:

```json
{
  "target_key": "blog-post-2026-09-intro",
  "actor_id": "visitor-abc-123",
  "kind": "emoji",
  "value": "👍"
}
```

- `target_key` — opaque string, ≤256 chars.
- `actor_id` — opaque string identifying the visitor/session, ≤256 chars.
- `kind` — `'emoji'` or `'image'`.
- `value` — emoji character (`kind: 'emoji'`, ≤16 codepoints) or
  image id (`kind: 'image'`, `[A-Za-z0-9_-]{1,64}`).

**Response 200**:

```json
{ "created": true, "id": "<uuid>" }
```

`created: false` means the reaction was already present.

### `DELETE /api/v1/reactions`

Remove a reaction. Idempotent: deleting an absent reaction returns
`deleted: false` without erroring.

Same auth + rate limit + body shape as PUT.

**Response 200**:

```json
{ "deleted": true }
```

### `GET /api/v1/reactions?target=<target_key>`

Aggregate counts for a target. Returns the result of `GROUP BY kind,
value` ordered by count desc.

**Auth**: `Authorization: Bearer mk_<key>` with `reactions:read` scope.

**Rate limit**: 600 req/min per API key id (reads).

**Response 200**:

```json
{
  "target_key": "blog-post-2026-09-intro",
  "aggregates": [
    { "kind": "emoji", "value": "👍", "count": 17 },
    { "kind": "emoji", "value": "🎉", "count": 9 },
    { "kind": "image", "value": "01ABC...", "count": 3 }
  ]
}
```

### `GET /api/v1/reaction-images/:id`

Public read. Streams the image from R2 with `Content-Type` and
`Cache-Control: public, max-age=31536000, immutable` (images are
content-addressed by SHA-256 hash, so safe to cache forever).

**Rate limit**: 600 req/min per request IP (read binding).

## Errors

| Status | Body | Cause |
| --- | --- | --- |
| 400 | `invalid_body` | malformed body |
| 400 | `missing_target` / `invalid_target` | `?target=` missing or too long |
| 401 | `missing_authorization` / `invalid_api_key` | auth failed |
| 403 | `missing_scope` | key lacks the required scope |
| 404 | `not_found` | image id not in the library |
| 429 | `rate_limited` | budget exhausted |

## Atomicity

PUT and DELETE are atomic at the storage layer:

- PUT uses `INSERT ... ON CONFLICT (target_key, principal, actor_id,
  kind, value) DO NOTHING RETURNING id`. The `RETURNING` clause tells
  us whether the row was newly inserted or already existed.
- DELETE matches the same composite UNIQUE, so the row is either
  deleted (1 change) or absent (0 changes) — both idempotent.

## Why no aggregate table for MVP

`GROUP BY` on the `(target_key, kind, value)` composite is fast for
small-to-medium targets (the `(target_key, kind)` index keeps the scan
narrow). The aggregate table is a follow-up when traffic motivates
materialisation.

## Storage schema

See `migrations/0003_reactions.sql`. Two tables:

- `reactions` — one row per unique reaction; UNIQUE on
  `(target_key, principal, actor_id, kind, value)`.
- `reaction_images` — one row per uploaded image; UNIQUE on
  `content_hash` for content-addressed dedup.

R2 layout: `reactions/{sha256-hex}.{ext}`.

## Image policy

- Allowed content types: `image/png`, `image/jpeg`, `image/webp`,
  `image/gif`. SVG excluded for MVP (active content risk).
- Max size: 256 KiB.
- Content hash (SHA-256) is the dedup key — uploading the same
  bytes twice returns the existing image id.
- Image GET is public; upload / delete is admin-only.
