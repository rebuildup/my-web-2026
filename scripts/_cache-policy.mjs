/**
 * Canonical response cache-policy matrix (Issue #484).
 *
 * What this module is
 * -------------------
 * ONE table of every response class the site can serve, and the
 * `Cache-Control` / validator / `Vary` contract each class owes. It is
 * data plus pure functions only — no `node:fs`, no network — so it is
 * importable from plain Node scripts (`node --test`, the measurement
 * tool) and from the workerd test pool TypeScript alike.
 *
 * Why a table at all
 * ------------------
 * Before this Issue the policies existed but nothing held them
 * together:
 *
 *   - `public/_headers` owned fingerprinted assets
 *     (`max-age=31556952, immutable`, Issue #291) — invisible to the
 *     Worker, verifiable only by reading the file.
 *   - `src/server.ts` owned Worker-generated HTML (`no-cache`, and
 *     `no-store` for `/admin*`) — pinned by
 *     `test/integration/html-cache-policy.test.ts`.
 *   - `src/http/reactions/*` owned the R2 image policy
 *     (`public, max-age=31536000, immutable`).
 *   - everything else under `/api/v1/*` carried NO policy at all, so
 *     per-principal JSON was cacheable by default rather than by
 *     decision.
 *
 * Reconciled with the boundary isolation policy (Issue #460)
 * ----------------------------------------------------------
 * #460 later put `src/http/middleware/cache-policy.ts` in front of the
 * whole external boundary and rewrote every response that is not an
 * explicit `public` + positive-lifetime opt-in to `private, no-store`
 * with `Vary: Cookie, Authorization`. That is the SAME decision this
 * table records for `api-json`, one layer closer to the data, so the
 * two owners do not disagree: the row below states the value the
 * boundary actually SERVES (`private, no-store`), and its `Vary`
 * column states that the two request headers are declared there, not
 * here. The only boundary response that opts out is
 * `GET /api/v1/reaction-images/:id`, which keeps its
 * `public, …, immutable` value because it is content-addressed and
 * per-visitor-independent.
 *
 * Four owners, four places, one requirement that they must disagree
 * with each other — and no artifact stating the disagreement. This
 * table is that artifact: the tests below it check each owner against
 * it, so "immutable assets and personal pages carry DIFFERENT
 * policies" becomes an executable invariant instead of a review
 * comment.
 *
 * Scope discipline (Issue #484 acceptance criterion 3)
 * ---------------------------------------------------
 * This Issue fixes exactly ONE element — the cache-header contract.
 * It deliberately does NOT add a performance score, a Lighthouse
 * runner, a budget gate, or a dashboard; those belong to #384, #385,
 * #386 and #493 respectively, and merging them here would turn a
 * header contract into a release gate nobody asked for. The matrix is
 * also NOT wired into `validate:*` as a performance gate: the
 * contract is enforced by tests (see `enforcedBy`), and the
 * measurement tool is an opt-in command.
 *
 * Vocabulary
 * ----------
 *   class        one kind of response, named after what it carries
 *   sample       a representative path, for humans and for probes
 *   cacheControl the exact `Cache-Control` value the class owes
 *   validator    `etag` when the response may answer `If-None-Match`
 *                with 304; `none` when no validator may be emitted
 *   vary         request headers the response varies on, or `'none'`.
 *                A `varyNote` says whether this repository declares the
 *                value or merely observes what the platform adds.
 *   owner        the module that DECIDES the policy
 *   enforcedBy   the check that fails when the decision drifts. The
 *                value names the check AND what that check actually
 *                proves: "the exact value" and "only that it is not
 *                immutable" are different claims and must not be
 *                written as one.
 */

/**
 * Where this module sits, and why that is still open.
 *
 * This table is a RUNTIME contract, but it lives under `scripts/` so
 * that `node --test`, the measurement tool and the workerd test pool
 * can all import it (see the `import type` / plain-`import` note in
 * AGENTS.md §3). `scripts/check-architecture.mjs` gives `ownerOf()`
 * nothing outside `src/`, so today nothing structurally forbids a
 * `src/ → scripts/` import that would "single-source" a literal from
 * here — which would invert the dependency direction AGENTS.md §3
 * states.
 *
 * Whether this table should move under a governed `src/` obligation (or
 * whether AGENTS.md §3 should name `scripts/` explicitly) is an
 * architecture decision for the owner / an ADR, not one this Issue may
 * take. Until then, do not import this file from `src/`.
 */

/**
 * 52 weeks in seconds — the value Cloudflare documents as its own
 * recommendation for fingerprinted assets. Named (not inlined) so the
 * `public/_headers` rule and this table cannot disagree about the
 * number.
 */
export const IMMUTABLE_ASSET_MAX_AGE_SECONDS = 31556952;

/**
 * R2 reaction images keep their own year. They are content-addressed
 * by `content_hash` and served from an immutable R2 key, but they are
 * NOT fingerprinted build artefacts, so the class keeps its own
 * constant instead of borrowing the static-asset one.
 */
export const IMMUTABLE_MEDIA_MAX_AGE_SECONDS = 31536000;

/**
 * The matrix. Order is the order a reader should think in:
 * cacheable-by-construction first, then dynamic-by-construction.
 */
export const CACHE_POLICY_MATRIX = [
	{
		id: 'immutable-build-asset',
		class: 'Fingerprinted build asset',
		sample: '/assets/<name>-<hash>.js',
		cacheControl: `public, max-age=${IMMUTABLE_ASSET_MAX_AGE_SECONDS}, immutable`,
		validator: 'etag',
		vary: 'accept-encoding',
		varyNote:
			'observed from the platform, not declared by this repository — whether to declare it explicitly is open (doc §7 item 2)',
		owner: 'Cloudflare Static Assets via public/_headers',
		enforcedBy:
			'scripts/cache-policy.test.mjs (exact value), cache:headers:measure (observed value)',
	},
	{
		id: 'mutable-static-asset',
		class: 'Mutable static asset (URL outlives its bytes)',
		sample: '/share/**',
		cacheControl: 'public, max-age=0, must-revalidate',
		validator: 'etag',
		vary: 'accept-encoding',
		varyNote:
			'observed from the platform, not declared by this repository — whether to declare it explicitly is open (doc §7 item 2)',
		owner: 'Cloudflare Static Assets default (public/_headers only names the exceptions)',
		enforcedBy:
			'scripts/cache-policy.test.mjs (NOT immutable only), cache:headers:measure (exact value — the platform default is not asserted by a gate)',
	},
	{
		id: 'reaction-image',
		class: 'Reaction image streamed from R2',
		sample: '/api/v1/reaction-images/:id',
		cacheControl: `public, max-age=${IMMUTABLE_MEDIA_MAX_AGE_SECONDS}, immutable`,
		validator: 'none',
		vary: 'none',
		owner: 'external boundary (src/http/reactions/router.ts)',
		enforcedBy:
			'test/integration/reactions-images.test.ts (runtime, through the Worker entry), test/integration/cache-policy-matrix.test.ts (table = source constant)',
	},
	{
		id: 'personal-page',
		class: 'Personal page (SSR HTML, rendered per request)',
		sample: '/contact',
		cacheControl: 'no-cache',
		validator: 'none',
		vary: 'none',
		varyNote:
			'the anonymous form. A request that carries Cookie / Authorization, or a response that issues Set-Cookie, is declared `private, no-cache` with `Vary: Cookie, Authorization` by src/server.ts (Issue #460); probes run without credentials, so they observe the anonymous value',
		owner: 'Worker entry (src/server.ts)',
		enforcedBy: 'test/integration/cache-policy-matrix.test.ts',
	},
	{
		id: 'admin-page',
		class: 'Admin surface (SSR HTML or redirect)',
		sample: '/admin/login',
		cacheControl: 'no-store',
		validator: 'none',
		vary: 'cookie, authorization',
		varyNote:
			'declared by src/server.ts in the same call as `no-store` (Issue #460): the directive documents the per-caller request, and `no-store` is what forbids storing it',
		owner: 'Worker entry (src/server.ts)',
		enforcedBy: 'test/integration/cache-policy-matrix.test.ts',
	},
	{
		id: 'api-json',
		class: 'External API JSON',
		sample: '/api/v1/health',
		cacheControl: 'private, no-store',
		validator: 'none',
		vary: 'cookie, authorization',
		varyNote:
			'declared by src/http/middleware/cache-policy.ts (Issue #460), which rewrites every boundary response that is not an explicit public + positive-lifetime opt-in. The `no-store` default in src/server.ts is the subset of this value; `private` is the part that additionally forbids a browser cache',
		owner:
			'external boundary isolation (src/http/middleware/cache-policy.ts) over the boundary default (src/server.ts)',
		enforcedBy:
			'test/integration/cache-policy-matrix.test.ts, test/integration/cache-isolation.test.ts',
	},
];

/** Look a row up by id. Throws on an unknown id — a typo must not pass silently. */
export function policyById(id) {
	const row = CACHE_POLICY_MATRIX.find((entry) => entry.id === id);
	if (!row) throw new Error(`unknown cache-policy id: ${id}`);
	return row;
}

/**
 * Parse a `Cache-Control` field value into the directives this
 * repository's contract talks about. Unknown directives are ignored
 * on purpose: a policy may legitimately carry `s-maxage` or `stale-
 * while-revalidate` without the matrix having to enumerate them.
 *
 * @param {string | null | undefined} value
 * @returns {{ raw: string, immutable: boolean, noStore: boolean, noCache: boolean, private: boolean, mustRevalidate: boolean, maxAge: number | null }}
 */
export function parseCacheControl(value) {
	const raw = typeof value === 'string' ? value : '';
	const lower = raw.toLowerCase();
	const maxAgeMatch = /\bmax-age\s*=\s*"?(\d+)"?/.exec(lower);
	return {
		raw,
		immutable: lower.split(',').some((d) => d.trim() === 'immutable'),
		noStore: lower.split(',').some((d) => d.trim() === 'no-store'),
		private: lower.split(',').some((d) => d.trim() === 'private'),
		noCache: lower.split(',').some((d) => d.trim() === 'no-cache'),
		mustRevalidate: lower.split(',').some((d) => d.trim() === 'must-revalidate'),
		maxAge: maxAgeMatch ? Number(maxAgeMatch[1]) : null,
	};
}

/**
 * Parse a Cloudflare Static Assets `_headers` file into rules.
 *
 * The format is Netlify-compatible: a path pattern line, then indented
 * `Name: value` lines, `#` comments, blank lines. Cloudflare's pattern
 * syntax is Express-style (`:param` for one segment, `*` for the rest).
 *
 * @param {string} text
 * @returns {Array<{ pattern: string, headers: Array<{ name: string, value: string }> }>}
 */
export function parseHeadersFile(text) {
	const rules = [];
	let current = null;
	for (const rawLine of String(text).split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		if (!/^\s/.test(line) && !/^\s*[\w-]+\s*:/.test(line)) {
			current = { pattern: line.trim(), headers: [] };
			rules.push(current);
			continue;
		}
		if (!current) continue;
		const headerMatch = /^\s+([\w-]+)\s*:\s*(.*)$/.exec(line);
		if (headerMatch) {
			current.headers.push({ name: headerMatch[1], value: headerMatch[2].trim() });
		}
	}
	return rules;
}

/**
 * Does a `_headers` pattern match a concrete path?
 *
 * Express-style, matching Cloudflare's documented subset: `:name` is
 * exactly one segment, `*` absorbs the remainder (including the empty
 * remainder, so `/assets/*` matches `/assets/x` and `/assets/a/b.js`).
 * Anything the syntax does not cover returns false rather than
 * guessing — a false negative makes a probe miss, and a missed rule is
 * reported, never silently accepted.
 *
 * @param {string} pattern
 * @param {string} pathname
 */
export function matchesPattern(pattern, pathname) {
	const patternSegments = pattern.split('/').filter((s) => s !== '');
	const pathSegments = pathname.split('/').filter((s) => s !== '');
	for (let i = 0; i < patternSegments.length; i += 1) {
		const segment = patternSegments[i];
		if (segment === '*') return true;
		if (i >= pathSegments.length) return false;
		if (segment.startsWith(':')) continue;
		if (segment !== pathSegments[i]) return false;
	}
	return patternSegments.length === pathSegments.length;
}

/**
 * Every header a concrete path would receive from a `_headers` file,
 * last rule wins per header name (which is how Cloudflare merges
 * matching rules).
 *
 * @param {ReturnType<typeof parseHeadersFile>} rules
 * @param {string} pathname
 */
export function effectiveHeaders(rules, pathname) {
	const merged = new Map();
	for (const rule of rules) {
		if (!matchesPattern(rule.pattern, pathname)) continue;
		for (const header of rule.headers) merged.set(header.name.toLowerCase(), header.value);
	}
	return merged;
}

/**
 * The acceptance invariant of this Issue, expressed as data: a
 * fingerprinted asset and a dynamically rendered personal page must
 * not share a policy. If they ever do, one of the two is wrong —
 * either the page is being frozen (stale hits for a page whose hit
 * counter and reaction totals change per request) or the asset is
 * being revalidated on every visit (a round trip per chunk).
 *
 * @returns {Array<{ immutableId: string, otherId: string, sharedPolicy: string }>}
 */
export function separationViolations() {
	const immutable = policyById('immutable-build-asset');
	const violations = [];
	for (const row of CACHE_POLICY_MATRIX) {
		if (row.id === immutable.id) continue;
		if (row.cacheControl === immutable.cacheControl) {
			violations.push({
				immutableId: immutable.id,
				otherId: row.id,
				sharedPolicy: row.cacheControl,
			});
		}
	}
	return violations;
}

/**
 * Request headers that make a response user-specific. A response that
 * varies on any of them must never be storable by a shared cache —
 * this is the "responses that differ per user must not be cached in
 * the CDN" rule from the checklist this Issue cites
 * (https://zenn.dev/catnose99/articles/547cbf57e5ad28).
 */
export const USER_SPECIFIC_VARY_HEADERS = ['cookie', 'authorization'];

/**
 * Evaluate ONE measured row (from the cache-header measurement tool)
 * against the declared class. Pure, so the same function backs the
 * local report and the `--verify` exit code.
 *
 * @param {{ id: string, status: number|null, cacheControl: string|null, etag: string|null, vary: string|null }} observation
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function evaluateObservation(observation) {
	const row = policyById(observation.id);
	const problems = [];

	if (observation.status === null) {
		return { ok: false, problems: ['not reachable (skipped class)'] };
	}
	if (observation.status >= 400 && row.id !== 'admin-page' && row.id !== 'api-json') {
		problems.push(`status ${observation.status} — expected a served response`);
	}

	const parsed = parseCacheControl(observation.cacheControl);
	if (parsed.raw === '') {
		problems.push('no Cache-Control — the class owes an explicit policy');
	} else if (parsed.raw.toLowerCase() !== row.cacheControl.toLowerCase()) {
		problems.push(`Cache-Control is "${parsed.raw}", expected "${row.cacheControl}"`);
	}

	const hasValidator = typeof observation.etag === 'string' && observation.etag !== '';
	if (row.validator === 'etag' && !hasValidator) problems.push('no ETag where the class owes one');
	if (row.validator === 'none' && hasValidator) {
		problems.push(
			`unexpected ETag "${observation.etag}" — a dynamic response must not offer a validator`,
		);
	}

	const varyValues = String(observation.vary ?? '')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value !== '');
	for (const value of varyValues) {
		if (!USER_SPECIFIC_VARY_HEADERS.includes(value)) continue;
		// A user-specific `Vary` is only a hole when the response can
		// still be STORED by a shared cache. `private` forbids shared
		// storage outright and `no-store` forbids any storage, so in
		// both cases the directive is documentation for the
		// intermediaries that do not implement those directives — which
		// is exactly why src/server.ts and
		// src/http/middleware/cache-policy.ts emit it there
		// (Issue #460). Without `private`, a stored body can be
		// replayed to the next caller whatever the `Vary` says, so that
		// combination is the violation.
		if (parsed.private || parsed.noStore) continue;
		problems.push(
			`Vary: ${value} is user-specific but the response is storable by a shared cache without \`private\``,
		);
	}

	return { ok: problems.length === 0, problems };
}
