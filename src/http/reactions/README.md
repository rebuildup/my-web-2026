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

Boundary validation is owned by `src/http/validation.ts`; see
[`docs/security/input-validation.md`](../../../docs/security/input-validation.md)
for the full contract. Every rejection below carries `{ error, reason }`.

| Status | Body | Cause |
| --- | --- | --- |
| 400 | `invalid_body` | malformed body, or a `target_key` / `actor_id` / `kind` / `value` outside its grammar |
| 400 | `missing_target` | `?target=` absent |
| 400 | `invalid_target` / `invalid_actor_id` | query value outside its grammar (e.g. too long) |
| 400 | `invalid_query` | the same query name supplied more than once (parameter pollution) |
| 400 | `invalid_id` | `:id` does not match `[A-Za-z0-9_-]{1,64}` |
| 401 | `missing_authorization` / `invalid_api_key` | auth failed |
| 403 | `missing_scope` | key lacks the required scope |
| 404 | `not_found` | image id not in the library |
| 405 | `method_not_allowed` | verb not in `Allow` for this path |
| 413 | `payload_too_large` | JSON body over `MAX_JSON_BODY_BYTES` (16 KiB) |
| 415 | `unsupported_media_type` | declared `Content-Type` is not `application/json` / `application/*+json` (a wildcard or an absent header is accepted; `curl --data` sends `application/x-www-form-urlencoded` and is refused — `docs/security/input-validation.md` §4) |
| 422 | `unknown_image_id` | image-kind reaction referencing an image that does not exist |
| 429 | `rate_limited` | budget exhausted |
| 500 | `internal_error` + `request_id` | unexpected failure; redacted (see `docs/security.md`) |

Issue #457 changed two things in this table:

- The 422 body is now `{ "error": "unknown_image_id" }`. It used to
  carry `reason`, whose text named the backing table
  (`reaction_images`) — internal schema detail on a public endpoint.
  The detail now stays in the log; the code is self-describing. This
  is a **breaking** change for any external consumer that read
  `reason`; no in-repo consumer does, and the removal is recorded in
  the release description.
- A 500 is produced by the boundary-wide redaction contract
  (`src/http/errors.ts`): `error`, `message`, and `request_id` only.
  `request_id` is byte-identical to the `X-Request-Id` header and to
  the id in the internal log line; a client-supplied `X-Request-Id` is
  reused only when it matches `^[A-Za-z0-9._:-]{1,128}$`.

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

## Self-consumption from home

The home surface (`src/home/reactions/`) is itself a consumer of this
API: it holds an API key in `MY_WEB_2026_CONSUMER_API_KEY` and calls
`/api/v1/reactions` server-side over `fetch` (see ADR-0011). This is
the same boundary an external consumer uses — the home is not a
backdoor. Provision the key once per environment by running
`pnpm run bootstrap:home-api-key` (or invoking
`scripts/bootstrap-home-api-key.mjs` directly); the script prints the
generated `mk_home_…` value which the operator then stores as a
Wrangler secret. The home reads a stable `target_key` from the
`MY_WEB_2026_REACTIONS_TARGET` var (default `home-page`).

Visitor identity is anonymous and lives entirely in the
`mw_actor_id` cookie (see `src/home/reactions/cookie.ts`). The home
forwards the cookie value as `actor_id` on PUT/DELETE so per-visitor
dedup works at the API layer; the cookie itself carries no
information and is not exposed to client-side scripts.

