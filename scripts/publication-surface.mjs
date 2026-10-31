/**
 * Publication surface model — pure library (Issue #505).
 *
 * The "publication surface" is everything a release makes
 * reachable or dereferenceable by a third party:
 *
 *   1. the declared route surfaces under `src/routes/**` and their
 *      classification (`public` = reachable without an admin
 *      session, `internal` = behind an auth loader), with the
 *      subset that belongs in a sitemap;
 *   2. the dynamic expansions of those surfaces (portfolio
 *      projects, integrated tools) plus the HTML documents Cloudflare
 *      Static Assets serve straight out of `public/**`;
 *   3. the external HTTP boundary prefixes declared by the worker
 *      entry point, compared like URLs so a boundary can neither
 *      appear nor disappear unnoticed;
 *   4. the absolute URLs that shipped source contains, split into
 *      first-party, external, and non-dereferenced identifier
 *      namespaces — including the entry document and static assets
 *      of each `same_origin_static` Tool, because `/tools/<slug>`
 *      serves that content from this origin.
 *
 * Why a declared table instead of a route-tree parser
 * ---------------------------------------------------
 * `src/routes/**` is the TanStack Start file-route contract, and
 * the generated route tree (`src/routeTree.gen.ts`) is a build
 * artefact that is not tracked. Re-deriving route ids here would
 * duplicate the generator and silently disagree with it. The
 * declaration below instead OWNS the audit classification, and
 * `assertRouteCoverage` proves that it still claims every route
 * file on disk — so a new route cannot become reachable without
 * someone writing down whether it is public.
 *
 * Everything in this module is a pure function of its inputs
 * (source text, JSON, a file list) so the contract can be proven
 * with independent fixtures instead of the live repository.
 * Filesystem access and exit codes live in
 * `scripts/check-publication-diff.mjs`.
 */

/** Snapshot schema identifier. Bump on any breaking shape change. */
export const SNAPSHOT_SCHEMA = 'publication-surface.v2';

/**
 * Declared route surfaces, one entry per file-route that owns a
 * URL. `classification` answers "can an unauthenticated visitor
 * reach it"; `sitemap` answers "does it belong in the sitemap
 * target list".
 *
 * Every `files` entry must exist, and every route file on disk must
 * be claimed by exactly one entry (see `ROUTE_DIR_INERT_FILES`
 * for the route-directory files that are not routes).
 */
export const SURFACE_DECLARATIONS = [
	{
		id: '/__root__',
		path: null,
		classification: 'internal',
		sitemap: false,
		files: ['src/routes/__root.tsx'],
		reason:
			'Root shell — owns head metadata, global nav and the admin chrome gate. No URL of its own.',
	},
	{
		id: '/',
		path: '/',
		classification: 'public',
		sitemap: true,
		files: ['src/routes/index.tsx'],
		reason: 'Canonical landing surface (ADR-0014 production origin).',
	},
	{
		id: '/about',
		path: '/about',
		classification: 'public',
		sitemap: true,
		files: ['src/routes/about.tsx'],
		reason: 'Public narrative surface; renders repo-controlled copy only.',
	},
	{
		id: '/keyboard',
		path: '/keyboard',
		classification: 'public',
		sitemap: false,
		files: ['src/routes/keyboard.tsx'],
		reason:
			'Read-only keyboard reference; renders the committed source snapshot and is linked from /about, but is not a sitemap target.',
	},
	{
		id: '/contact',
		path: '/contact',
		classification: 'public',
		sitemap: true,
		files: ['src/routes/contact.tsx'],
		reason:
			'Public contact surface; renders only channels that pass the fail-closed freshness gate.',
	},
	{
		id: '/projects/dotfiles',
		path: '/projects/dotfiles',
		classification: 'public',
		sitemap: false,
		files: ['src/routes/projects.dotfiles.tsx'],
		reason:
			'Public project introduction; renders the committed public-README snapshot and states its own freshness. Deliberately not a nav destination, so it is not advertised through the sitemap inventory.',
	},
	{
		id: '/portfolio/',
		path: '/portfolio',
		classification: 'public',
		sitemap: true,
		files: ['src/routes/portfolio/index.tsx'],
		reason: 'Public portfolio index; lists published projects only.',
	},
	{
		id: '/portfolio/$slug',
		path: null,
		dynamic: 'portfolio-projects',
		classification: 'public',
		sitemap: true,
		files: ['src/routes/portfolio/$slug.tsx'],
		reason:
			'Per-project detail. Expands from the repo-controlled portfolio seed slugs; the loader serves `visibility = public` rows only.',
	},
	{
		id: '/tools/',
		path: '/tools',
		classification: 'public',
		sitemap: true,
		files: ['src/routes/tools.index.tsx'],
		reason:
			'Public tool index. `host_disabled` entries render as "Coming soon" and are deliberately not linkable.',
	},
	{
		id: '/tools/$slug',
		path: null,
		dynamic: 'integrated-tools',
		classification: 'public',
		sitemap: true,
		files: ['src/routes/tools.$slug.tsx'],
		reason:
			'Per-tool iframe shell. Expands from the tool manifest rows with an embeddable delivery kind.',
	},
	{
		id: '/design-system',
		path: '/design-system',
		classification: 'public',
		sitemap: false,
		files: ['src/routes/design-system.tsx'],
		reason:
			'Publicly reachable showcase, but it is intentionally outside the editorial IA (SUPPRESS_BREADCRUMB_LEAF_IDS), so it is not a sitemap target.',
	},
	{
		id: '/admin',
		path: '/admin',
		classification: 'internal',
		sitemap: false,
		files: ['src/routes/admin.tsx'],
		reason: 'Admin layout. Auth gating lives in each child loader (Issue #106 self-redirect fix).',
	},
	{
		id: '/admin/',
		path: null,
		classification: 'internal',
		sitemap: false,
		files: ['src/routes/admin.index.tsx'],
		reason: 'Admin landing — signed-in only.',
	},
	{
		id: '/admin/login',
		path: '/admin/login',
		classification: 'public',
		sitemap: false,
		files: ['src/routes/admin.login.tsx'],
		reason:
			'PUBLIC BY NECESSITY: the sign-in waypoint has to be reachable before a session exists. Its loader only redirects already-signed-in users. Never a sitemap target.',
	},
	{
		id: '/admin/invitations',
		path: '/admin/invitations',
		classification: 'internal',
		sitemap: false,
		files: ['src/routes/admin.invitations.tsx'],
		reason: 'Invitation management — admin role only.',
	},
	{
		id: '/admin/invitations/accept',
		path: '/admin/invitations/accept',
		classification: 'public',
		sitemap: false,
		files: ['src/routes/admin.invitations_.accept.tsx'],
		reason:
			'PUBLIC BY NECESSITY: the invitation landing page probes an emailed token before any session exists. Renders no project data and never a sitemap target.',
	},
	{
		id: '/admin/keys',
		path: '/admin/keys',
		classification: 'internal',
		sitemap: false,
		files: ['src/routes/admin.keys.tsx'],
		reason: 'API key management — admin role only.',
	},
	{
		id: '/admin/images',
		path: '/admin/images',
		classification: 'internal',
		sitemap: false,
		files: ['src/routes/admin.images.tsx'],
		reason: 'Media library — admin role only.',
	},
	{
		id: '/admin/emoji-catalog',
		path: '/admin/emoji-catalog',
		classification: 'internal',
		sitemap: false,
		files: ['src/routes/admin.emoji-catalog.tsx'],
		reason: 'Reaction emoji catalog — admin role only.',
	},
];

/**
 * Files inside `src/routes/**` that the file-route generator does
 * NOT turn into routes (colocated components and barrels under the
 * `design-system/` directory). Declared explicitly rather than
 * matched by a glob so an exception has to be justified in review.
 */
export const ROUTE_DIR_INERT_FILES = [
	'src/routes/design-system/index.ts',
	'src/routes/design-system/DesignSystemPage.tsx',
	'src/routes/design-system/sections/CjkLineBreak.tsx',
	'src/routes/design-system/sections/ColorSwatches.tsx',
	'src/routes/design-system/sections/GrowthThroughMaking.preview.ts',
	'src/routes/design-system/sections/GrowthThroughMaking.stories.tsx',
	'src/routes/design-system/sections/ImageCls.tsx',
	'src/routes/design-system/sections/InteractiveStates.tsx',
	'src/routes/design-system/sections/ReactionPicker.tsx',
	'src/routes/design-system/sections/SpacingRuler.tsx',
	'src/routes/design-system/sections/StatusAccents.tsx',
	'src/routes/design-system/sections/SurfaceTreatments.tsx',
	'src/routes/design-system/sections/TableCode.tsx',
	'src/routes/design-system/sections/Typography.tsx',
];

/**
 * Host roots whose URLs are identifiers, never dereferenced
 * resources: XML namespace URIs, the sitemap schema namespace, the
 * JSON-LD context IRI, the JSON Schema dialect IRI, and SPDX license
 * identifiers. They are compared like any other URL, but a `http://`
 * scheme on one of them is not an insecure-mix finding.
 */
export const IDENTIFIER_NAMESPACE_HOSTS = [
	'schema.org',
	'json-schema.org',
	'www.w3.org',
	'www.apache.org',
	'www.sitemaps.org',
	'scripts.sil.org',
];

/** Host *names* that only ever resolve to the local machine. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

/**
 * Suffixes reserved for private / site-local name resolution
 * (RFC 6762 mDNS, RFC 8375 home.arpa, the `.internal` namespace).
 * A browser or a Worker cannot resolve them from the public
 * internet, so a URL on one is a private-network reference.
 */
const PRIVATE_HOST_SUFFIXES = ['.local', '.localdomain', '.internal', '.home.arpa'];

const stripIpv6Brackets = (host) =>
	host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1).split('%')[0] : host;

/**
 * Canonicalize the spellings a browser accepts for the same host before
 * the privacy check runs. A trailing dot is part of the DNS root, an
 * IPv6 literal can carry brackets / a zone / a port, and `new URL()`
 * leaves IPv4-mapped IPv6 addresses in their hex form.
 */
function canonicalPrivateHost(host) {
	let bare = String(host ?? '')
		.trim()
		.toLowerCase()
		.replace(/\.+$/, '');
	if (bare.startsWith('[')) {
		const close = bare.indexOf(']');
		bare = close === -1 ? bare.slice(1) : bare.slice(1, close);
	} else if (/^[^:]+:\d+$/.test(bare)) {
		bare = bare.replace(/:\d+$/, '');
	}
	return bare.split('%')[0];
}

/** RFC 1918 / loopback / link-local / CGNAT / reserved IPv4. */
function isPrivateIpv4(host) {
	const parts = host.split('.');
	if (parts.length !== 4) return false;
	if (!parts.every((part) => /^\d{1,3}$/.test(part))) return false;
	const octets = parts.map(Number);
	if (octets.some((octet) => octet > 255)) return false;
	const [a, b] = octets;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a >= 224) return true;
	return false;
}

/**
 * fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast, ::1, ::.
 * IPv4-mapped (`::ffff:0:0/96`) and IPv4-compatible (`::/96`) addresses are
 * reduced to their embedded IPv4 address, because a browser connects to the
 * IPv4 host: `http://[::ffff:169.254.169.254]/` reaches cloud metadata even
 * though the literal does not spell an RFC 1918 / link-local string.
 */
function isPrivateIpv6(host) {
	let bare = stripIpv6Brackets(host);
	if (!bare.includes(':')) return false;
	if (bare === '::' || bare === '::1') return true;

	// A dotted tail (`::ffff:127.0.0.1`) is valid input; expand it into
	// the two hex groups it represents before the general parser.
	const lastColon = bare.lastIndexOf(':');
	if (bare.slice(lastColon + 1).includes('.')) {
		const octets = bare.slice(lastColon + 1).split('.');
		if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
			const [a, b, c, d] = octets.map(Number);
			if ([a, b, c, d].every((octet) => octet <= 255)) {
				bare = `${bare.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
			}
		}
	}

	const [headText, tailText] = bare.split('::');
	const head = headText ? headText.split(':') : [];
	const tail = tailText ? tailText.split(':') : [];
	const parts = [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail];
	if (parts.length !== 8) return false;
	if (!parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return false;

	if (
		parts.slice(0, 5).every((part) => part === '0') &&
		(parts[5] === 'ffff' || parts[5] === '0')
	) {
		const high = Number.parseInt(parts[6], 16);
		const low = Number.parseInt(parts[7], 16);
		if (isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`)) return true;
	}

	const first = Number.parseInt(parts[0], 16);
	if ((first & 0xfe00) === 0xfc00) return true;
	if ((first & 0xffc0) === 0xfe80) return true;
	if ((first & 0xff00) === 0xff00) return true;
	return false;
}

/**
 * True when a host can only be reached from a private network or
 * the local machine: RFC 1918 / CGNAT / link-local IPv4, unique-local
 * / link-local IPv6, loopback names, and site-local suffixes. This
 * is what `E009` promises, so the promise is computed rather than
 * asserted.
 */
export function isPrivateHost(host) {
	const bare = canonicalPrivateHost(host);
	if (bare.length === 0) return false;
	if (LOOPBACK_HOSTNAMES.has(bare)) return true;
	if (PRIVATE_HOST_SUFFIXES.some((suffix) => bare.endsWith(suffix))) return true;
	return isPrivateIpv4(bare) || isPrivateIpv6(bare);
}

/** Tool manifest `delivery.kind` values that get a linkable `/tools/<slug>` page. */
export const INTEGRATED_TOOL_DELIVERY_KINDS = ['same_origin_static', 'external_exception'];

/** Shipped source roots scanned for absolute URLs. */
export const SCAN_ROOTS = ['src', 'public'];

/**
 * File extensions scanned inside `SCAN_ROOTS`. Browser JavaScript
 * is included because `public/**` is served verbatim by Static
 * Assets: a `.js` there is shipped source like any other.
 */
export const SCAN_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.js',
	'.mjs',
	'.cjs',
	'.json',
	'.css',
	'.html',
	'.svg',
	'.md',
	'.txt',
];

/**
 * Files inside a `same_origin_static` Tool checkout that ship to
 * the visitor: the Vite entry document (its built form is the iframe
 * document at `/tools/<slug>/app/index.html`) and everything under
 * the tool's `public/` directory, which the build copies verbatim.
 */
export const TOOL_SHIPPED_SUBPATHS = ['index.html', 'public'];

/**
 * Canonical production origin, read out of the source of truth that
 * already owns it instead of being duplicated here (AGENTS.md §1).
 * `src/editorial/nav/route-labels.ts` exports `BREADCRUMB_ORIGIN`
 * from ADR-0014; this parses that constant out of the file text.
 */
export function canonicalOriginFromSource(source) {
	const match = /BREADCRUMB_ORIGIN\s*(?::[^=]*)?=\s*['"]([^'"]+)['"]/.exec(source);
	if (!match) throw new Error('BREADCRUMB_ORIGIN constant not found in the given source');
	return match[1];
}

/** Registrable-ish domain of the canonical origin: `a.b.rebuildup.dev` -> `rebuildup.dev`. */
export function firstPartyDomainOf(origin) {
	const host = new URL(origin).hostname.toLowerCase();
	const labels = host.split('.');
	if (labels.length <= 2) return host;
	return labels.slice(-2).join('.');
}

/**
 * Remove `//` and block comments while preserving string,
 * template and JSX-text content.
 *
 * A URL inside a doc comment is not a shipped URL, and the two
 * `http://127.0.0.1:3000` references in the `src/home` access and
 * reactions loaders are exactly that. A regex cannot do this safely
 * (a `//` inside a string literal would be eaten), so this is a
 * small scanner that tracks quote state.
 */
export function stripComments(text) {
	let out = '';
	let state = 'code';
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		const next = text[i + 1];
		if (state === 'code') {
			// `//` only opens a comment when it is NOT the tail of a
			// `scheme://` literal: bare URLs appear in JSX text and in
			// static HTML, where they are outside any quote.
			const urlTail = c === '/' && next === '/' && out.endsWith(':');
			if (c === '/' && next === '/' && !urlTail) {
				state = 'line';
				i += 2;
				continue;
			}
			if (c === '/' && next === '*') {
				state = 'block';
				i += 2;
				continue;
			}
			if (c === "'") state = 'single';
			else if (c === '"') state = 'double';
			else if (c === '`') state = 'template';
			out += c;
			i += 1;
			continue;
		}
		if (state === 'line') {
			if (c === '\n') {
				state = 'code';
				out += c;
			}
			i += 1;
			continue;
		}
		if (state === 'block') {
			if (c === '*' && next === '/') {
				state = 'code';
				i += 2;
				continue;
			}
			if (c === '\n') out += c;
			i += 1;
			continue;
		}
		// Inside a string / template / JSX text.
		if (c === '\\') {
			out += c + (next ?? '');
			i += 2;
			continue;
		}
		if (c === '\n') {
			// Unterminated quote (common in JSX text such as `don't`):
			// resume code mode instead of swallowing the rest of the file.
			state = 'code';
			out += c;
			i += 1;
			continue;
		}
		if (
			(state === 'single' && c === "'") ||
			(state === 'double' && c === '"') ||
			(state === 'template' && c === '`')
		) {
			state = 'code';
		}
		out += c;
		i += 1;
	}
	return out;
}

/** Trailing characters that belong to the surrounding prose, not to the URL. */
const TRAILING_NOISE = /[.,;:!?、。，；：）】」』·]+$/;

/**
 * Absolute `http(s)` literals in one piece of shipped source,
 * comment-stripped. Returns normalized, de-duplicated, sorted
 * strings; a trailing `/` is dropped so `https://host` and
 * `https://host/` are one identity.
 */
export function extractUrlLiterals(source) {
	const found = new Set();
	const text = stripComments(source);
	// Exclusion set: whitespace, quotes, backtick, angle/paren/bracket/brace,
	// backslash, and the CJK punctuation that separates a URL from the prose
	// around it in JSX text and static HTML.
	const re = /https?:\/\/[^\s"\'`<>()\[\]{}\\。、，；：！？）】」』]+/g;
	for (const match of text.matchAll(re)) {
		const cleaned = match[0].replace(TRAILING_NOISE, '');
		if (cleaned.length > 'https://'.length) found.add(normalizeUrl(cleaned));
	}
	return [...found].sort();
}

/** Lower-case scheme + host, drop a bare trailing slash. Identity used for diffing. */
export function normalizeUrl(raw) {
	const cut = raw.split('$')[0].split('{')[0];
	const trimmed = cut.replace(TRAILING_NOISE, '');
	const m = /^(https?):\/\/([^/?#]*)([\s\S]*)$/i.exec(trimmed);
	if (!m) return trimmed;
	const [, scheme, authority, rest] = m;
	const at = authority.lastIndexOf('@');
	const userinfo = at >= 0 ? authority.slice(0, at) : '';
	const hostport = at >= 0 ? authority.slice(at + 1) : authority;
	const host = hostport.toLowerCase();
	const suffix = rest.replace(TRAILING_NOISE, '').replace(/\/$/, '');
	return userinfo.length > 0
		? `${scheme.toLowerCase()}://${userinfo}@${host}${suffix}`
		: `${scheme.toLowerCase()}://${host}${suffix}`;
}

/**
 * Classify one URL literal against the canonical origin.
 *
 * `kind`:
 *   - `origin`     — the canonical production origin itself.
 *   - `first-party`— another host under the same registrable domain
 *                    (`media.rebuildup.dev`), i.e. still owner-operated
 *                    infrastructure, but a separate network dependency.
 *   - `external`   — any other host.
 *
 * `identifier` marks a non-dereferenced namespace / dialect /
 * license URL. `insecure` marks `http://` on a real (derefereferenced)
 * external host, `privateHost` marks a loopback / RFC 1918 /
 * site-local host, and `userinfo` marks embedded
 * `user:password@` credentials.
 */
export function classifyUrl(raw, { origin, firstPartyDomain }) {
	const identity = normalizeUrl(raw);
	const cut = raw.split('$')[0].split('{')[0];
	const m = /^(https?):\/\/([^/?#]*)/i.exec(cut.replace(TRAILING_NOISE, ''));
	const scheme = (m?.[1] ?? '').toLowerCase();
	const authority = m?.[2] ?? '';
	const at = authority.lastIndexOf('@');
	const userinfo = at >= 0 ? authority.slice(0, at) : '';
	const hostport = (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase();
	const host = hostport.replace(/:\d+$/, '');
	let kind = 'external';
	if (hostport.toLowerCase() === new URL(origin).host.toLowerCase()) kind = 'origin';
	else if (host === firstPartyDomain || host.endsWith(`.${firstPartyDomain}`)) kind = 'first-party';
	const identifier = IDENTIFIER_NAMESPACE_HOSTS.some(
		(namespaceHost) => host === namespaceHost || host.endsWith(`.${namespaceHost}`),
	);
	return {
		url: identity,
		host,
		kind,
		identifier,
		insecure: scheme === 'http' && kind !== 'origin' && !identifier,
		privateHost: isPrivateHost(host),
		userinfo: userinfo.length > 0,
	};
}

/**
 * The external HTTP boundary prefixes, read out of the worker entry
 * point that owns them (`src/server.ts`, AGENTS.md §3). These are
 * same-origin, non-sitemap machine surfaces, but they are part of
 * what a third party can reach, so the audit record states them.
 */
export function extractExternalBoundaryPrefixes(source) {
	const match = /EXTERNAL_BOUNDARY_PREFIXES\s*=\s*\[([\s\S]*?)\]/.exec(stripComments(source));
	if (!match) throw new Error('EXTERNAL_BOUNDARY_PREFIXES not found in the worker entry point');
	return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

/** Portfolio project slugs from the repo-controlled seed module. */
export function extractPortfolioSeedSlugs(source) {
	const slugs = [...stripComments(source).matchAll(/\bslug:\s*'([^']+)'/g)].map((m) => m[1]);
	return [...new Set(slugs)].sort();
}

/** Slugs of tools that get a linkable `/tools/<slug>` page. */
export function extractIntegratedToolSlugs(manifest) {
	const tools = Array.isArray(manifest?.tools) ? manifest.tools : [];
	const slugs = tools
		.filter((tool) => INTEGRATED_TOOL_DELIVERY_KINDS.includes(tool?.delivery?.kind))
		.map((tool) => tool?.slug)
		.filter((slug) => typeof slug === 'string' && slug.length > 0);
	return [...new Set(slugs)].sort();
}

/** Tools whose own source is served from this origin, with its checkout path. */
export function sameOriginStaticToolSubmodules(manifest) {
	const tools = Array.isArray(manifest?.tools) ? manifest.tools : [];
	return tools
		.filter((tool) => tool?.delivery?.kind === 'same_origin_static')
		.map((tool) => ({
			slug: tool?.slug,
			submodulePath: tool?.source?.submodule_path,
			pinnedSha: tool?.source?.pinned_sha,
		}))
		.filter((tool) => typeof tool.slug === 'string' && typeof tool.submodulePath === 'string');
}

/**
 * Public URLs that Cloudflare Static Assets serve directly out of
 * `public/**`, independent of the file-route declaration table.
 *
 * `public/index.html` is `/` and `public/<dir>/index.html` is `/<dir>/`
 * (Cloudflare Static Assets' `auto-trailing-slash` html handling).
 * Every other `.html` file is served verbatim at its own path, so
 * `public/<dir>/page.html` is `/<dir>/page.html`. Deleting one of
 * these files removes a reachable page, which is why they belong in
 * the compared public URL set rather than only in the sitemap set.
 */
export function staticAssetPublicPaths(publicFiles) {
	const paths = new Set();
	for (const file of publicFiles) {
		const withoutRoot = file.startsWith('public/') ? file.slice('public/'.length) : file;
		if (!withoutRoot.endsWith('.html')) continue;
		if (withoutRoot === 'index.html') {
			paths.add('/');
			continue;
		}
		if (withoutRoot.endsWith('/index.html')) {
			paths.add(`/${withoutRoot.slice(0, -'index.html'.length)}`);
			continue;
		}
		paths.add(`/${withoutRoot}`);
	}
	return [...paths].sort();
}

/** Route files on disk must each be claimed by exactly one declaration. */
export function assertRouteCoverage(routeFiles) {
	const claimed = new Map();
	for (const declaration of SURFACE_DECLARATIONS) {
		for (const file of declaration.files) {
			if (claimed.has(file)) {
				return {
					ok: false,
					findings: [
						{
							code: 'E006 orphan-surface-declaration',
							severity: 'error',
							message: `${file} is claimed by both "${claimed.get(file)}" and "${declaration.id}".`,
						},
					],
				};
			}
			claimed.set(file, declaration.id);
		}
	}
	const onDisk = new Set([...routeFiles, ...ROUTE_DIR_INERT_FILES]);
	const findings = [];
	for (const file of routeFiles) {
		// Defensive: the CLI already filters the inert files out before
		// calling in, but a caller that passes the whole tree should not
		// be punished for it.
		if (ROUTE_DIR_INERT_FILES.includes(file)) continue;
		if (!claimed.has(file)) {
			findings.push({
				code: 'E005 undeclared-route-file',
				severity: 'error',
				message: `${file} exists under src/routes/ but no surface declaration claims it. Declare its classification and sitemap membership before it ships.`,
			});
		}
	}
	for (const [file, id] of claimed) {
		if (!onDisk.has(file)) {
			findings.push({
				code: 'E006 orphan-surface-declaration',
				severity: 'error',
				message: `Declaration "${id}" claims ${file}, which no longer exists.`,
			});
		}
	}
	return { ok: findings.length === 0, findings };
}

/**
 * Build the publication surface from injected inputs.
 *
 * `inputs`:
 *   - `routeFiles`   repo-relative route files found on disk
 *   - `sourceFiles`  `{ path, text }` for every scanned shipped file
 *   - `publicFiles`  repo-relative files under `public/` (Static Assets)
 *   - `toolSourceFiles` `{ path, text }` for the shipped files of each
 *                    `same_origin_static` Tool checkout
 *   - `toolSourcesMissing` Tool checkout paths that are not on disk
 *   - `origin`       canonical production origin
 *   - `portfolioSeedSource` text of the portfolio seed module
 *   - `toolsManifest` parsed `src/tools/manifest.json`
 */
export function buildSurface({
	routeFiles,
	sourceFiles,
	publicFiles = [],
	toolSourceFiles = [],
	toolSourcesMissing = [],
	origin,
	portfolioSeedSource,
	toolsManifest,
	workerEntrySource = '',
}) {
	const firstPartyDomain = firstPartyDomainOf(origin);
	const coverage = assertRouteCoverage(routeFiles);
	const portfolioSlugs = extractPortfolioSeedSlugs(portfolioSeedSource);
	const toolSlugs = extractIntegratedToolSlugs(toolsManifest);

	const surfaces = SURFACE_DECLARATIONS.map((declaration) => {
		const urls = [];
		if (typeof declaration.path === 'string') urls.push(declaration.path);
		if (declaration.dynamic === 'portfolio-projects') {
			for (const slug of portfolioSlugs) urls.push(`/portfolio/${slug}`);
		}
		if (declaration.dynamic === 'integrated-tools') {
			for (const slug of toolSlugs) urls.push(`/tools/${slug}`);
		}
		return {
			id: declaration.id,
			path: declaration.path ?? null,
			classification: declaration.classification,
			sitemap: declaration.sitemap,
			dynamic: declaration.dynamic ?? null,
			files: [...declaration.files].sort(),
			urls: urls.sort(),
			reason: declaration.reason,
		};
	}).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	const sitemap = [...new Set(surfaces.filter((s) => s.sitemap).flatMap((s) => s.urls))].sort();

	// Everything an unauthenticated visitor can reach: the expanded URLs of
	// every `public` surface (sitemap targets AND the deliberately
	// non-sitemap ones such as `/admin/login`) plus the HTML documents
	// Static Assets serve out of `public/**`. The sitemap list stays a
	// separate concept; this is the set whose shrinkage is an accident.
	const staticAssetPages = staticAssetPublicPaths(publicFiles);
	const publicUrls = [
		...new Set([
			...surfaces.filter((s) => s.classification === 'public').flatMap((s) => s.urls),
			...staticAssetPages,
		]),
	].sort();

	const byUrl = new Map();
	for (const file of [...sourceFiles, ...toolSourceFiles]) {
		for (const literal of extractUrlLiterals(file.text)) {
			const entry = byUrl.get(literal) ?? {
				...classifyUrl(literal, { origin, firstPartyDomain }),
				files: [],
			};
			entry.files.push(file.path);
			byUrl.set(literal, entry);
		}
	}
	const externalUrls = [...byUrl.values()]
		.map((entry) => ({ ...entry, files: [...new Set(entry.files)].sort() }))
		.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

	const externalHosts = [
		...new Set(externalUrls.filter((e) => e.kind === 'external').map((e) => e.host)),
	].sort();
	const firstPartyHosts = [
		...new Set(externalUrls.filter((e) => e.kind === 'first-party').map((e) => e.host)),
	].sort();

	return {
		schema: SNAPSHOT_SCHEMA,
		origin,
		firstPartyDomain,
		externalBoundaryPrefixes:
			workerEntrySource.length > 0 ? extractExternalBoundaryPrefixes(workerEntrySource) : [],
		toolSourcesMissing: [...toolSourcesMissing].sort(),
		findings: coverage.findings,
		surfaces,
		sitemap,
		publicUrls,
		staticAssetPages,
		externalUrls,
		externalHosts,
		firstPartyHosts,
	};
}

/** Findings that hold for the surface on its own, independent of any baseline. */
export function invariantFindings(current) {
	const findings = [...current.findings];
	for (const missing of current.toolSourcesMissing ?? []) {
		findings.push({
			code: 'E013 tool-source-missing',
			severity: 'error',
			message: `Tool source ${missing} is not checked out, so the URLs its iframe ships to the visitor could not be audited. Run \`git submodule update --init --recursive\` (CI checks submodules out) and re-run \`pnpm run publication:check\`.`,
		});
	}
	for (const entry of current.externalUrls) {
		if (entry.privateHost) {
			findings.push({
				code: 'E009 loopback-or-private-host-url',
				severity: 'error',
				message: `${entry.url} points at a loopback / private / site-local host but lives in shipped source (${entry.files.join(', ')}).`,
			});
		}
		if (entry.userinfo) {
			findings.push({
				code: 'E008 external-url-with-userinfo',
				severity: 'error',
				message: `${entry.url} embeds userinfo (user:password@). Credentials in shipped source are a leak, not a link.`,
			});
		}
		if (entry.insecure) {
			findings.push({
				code: 'E007 insecure-external-url',
				severity: 'error',
				message: `${entry.url} is http:// on a real external host (${entry.files.join(', ')}). Ship https:// unless it is a declared non-dereferenced identifier namespace.`,
			});
		}
	}
	return findings;
}

const setDiff = (from, to) => {
	const fromSet = new Set(from);
	const toSet = new Set(to);
	return {
		added: [...toSet].filter((value) => !fromSet.has(value)),
		removed: [...fromSet].filter((value) => !toSet.has(value)),
	};
};

/**
 * Compare a committed baseline snapshot with the surface computed
 * from the working tree, and turn the delta into findings.
 *
 * `baseline` is `null` for the first run, which is a fail-closed
 * `E010` — the caller must run the write mode before the gate can
 * pass, so a surface is never approved silently.
 */
export function diffSurfaces({ baseline, current }) {
	const findings = [];
	if (!baseline) {
		return {
			findings: [
				...findings,
				{
					code: 'E010 snapshot-missing',
					severity: 'error',
					message:
						'No publication-surface snapshot is committed. Run `pnpm run publication:write` to record the surface that this change proposes to publish.',
				},
			],
			addedPublicUrls: current.publicUrls ?? current.sitemap,
			removedPublicUrls: [],
			addedExternalUrls: current.externalUrls.map((e) => e.url),
			removedExternalUrls: [],
			addedExternalHosts: current.externalHosts,
			removedExternalHosts: [],
			addedBoundaryPrefixes: current.externalBoundaryPrefixes ?? [],
			removedBoundaryPrefixes: [],
			classificationChanges: [],
		};
	}

	// The compared set is every publicly reachable URL, not only the
	// sitemap targets: `/admin/login`, `/admin/invitations/accept` and
	// `/design-system` are public by declaration, and the Static Assets
	// pages under `public/**` are public by being served at all.
	const urls = setDiff(
		baseline.publicUrls ?? baseline.sitemap,
		current.publicUrls ?? current.sitemap,
	);
	const boundary = setDiff(
		baseline.externalBoundaryPrefixes ?? [],
		current.externalBoundaryPrefixes ?? [],
	);
	const externalUrls = setDiff(
		baseline.externalUrls.map((e) => e.url),
		current.externalUrls.map((e) => e.url),
	);
	const hosts = setDiff(baseline.externalHosts ?? [], current.externalHosts);
	const before = new Map(baseline.surfaces.map((s) => [s.id, s.classification]));
	const classificationChanges = current.surfaces
		.filter((s) => before.has(s.id) && before.get(s.id) !== s.classification)
		.map((s) => ({ id: s.id, from: before.get(s.id), to: s.classification }))
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	for (const url of urls.removed) {
		findings.push({
			code: 'E001 removed-public-url',
			severity: 'error',
			message: `Public URL ${url} disappeared from the published surface. If that is intentional, re-record the surface with \`pnpm run publication:write\` and say so in the PR body.`,
		});
	}
	for (const prefix of boundary.removed) {
		findings.push({
			code: 'E012 external-boundary-prefix-removed',
			severity: 'error',
			message: `External HTTP boundary prefix ${prefix} no longer exists. Removing a public API or webhook prefix breaks third-party callers; re-record it deliberately and note it in the PR body.`,
		});
	}
	for (const change of classificationChanges) {
		if (change.to === 'public') {
			findings.push({
				code: 'E003 internal-surface-published',
				severity: 'error',
				message: `Surface ${change.id} moved ${change.from} -> public. Publishing a previously internal surface needs an explicit review.`,
			});
		} else {
			findings.push({
				code: 'E002 public-surface-withdrawn',
				severity: 'error',
				message: `Surface ${change.id} moved public -> ${change.to}. Withdrawing a public surface also removes its URLs; confirm that is intended.`,
			});
		}
	}
	for (const host of hosts.added) {
		findings.push({
			code: 'E004 external-host-added',
			severity: 'error',
			message: `New external host ${host} appears in shipped source. A new host is a new outbound dependency and a new privacy surface; record it deliberately with \`pnpm run publication:write\`.`,
		});
	}
	for (const url of externalUrls.added) {
		findings.push({
			code: 'W002 external-url-added',
			severity: 'warn',
			message: `External URL added: ${url}`,
		});
	}
	for (const url of externalUrls.removed) {
		findings.push({
			code: 'W003 external-url-removed',
			severity: 'warn',
			message: `External URL removed: ${url}`,
		});
	}
	for (const host of hosts.removed) {
		findings.push({
			code: 'W001 external-host-removed',
			severity: 'warn',
			message: `External host no longer referenced: ${host}`,
		});
	}
	for (const url of urls.added) {
		findings.push({
			code: 'W004 public-url-added',
			severity: 'warn',
			message: `Public URL added: ${url}`,
		});
	}
	for (const prefix of boundary.added) {
		findings.push({
			code: 'W005 external-boundary-prefix-added',
			severity: 'warn',
			message: `External HTTP boundary prefix added: ${prefix}`,
		});
	}

	return {
		findings,
		addedPublicUrls: urls.added,
		removedPublicUrls: urls.removed,
		addedExternalUrls: externalUrls.added,
		removedExternalUrls: externalUrls.removed,
		addedExternalHosts: hosts.added,
		removedExternalHosts: hosts.removed,
		addedBoundaryPrefixes: boundary.added,
		removedBoundaryPrefixes: boundary.removed,
		classificationChanges,
	};
}

/** `fail` when any finding has error severity; `review` for warnings only; else `pass`. */
export function verdictOf(findings) {
	if (findings.some((finding) => finding.severity === 'error')) return 'fail';
	if (findings.some((finding) => finding.severity === 'warn')) return 'review';
	return 'pass';
}

/**
 * Canonical surface core — the part of the snapshot that is a pure
 * function of what the source tree currently publishes. Stable key
 * order, sorted arrays, trailing newline.
 */
export function serializeSurfaceCore(surface) {
	return `${JSON.stringify(
		{
			origin: surface.origin,
			firstPartyDomain: surface.firstPartyDomain,
			externalBoundaryPrefixes: surface.externalBoundaryPrefixes ?? [],
			surfaces: surface.surfaces.map((s) => ({
				id: s.id,
				path: s.path,
				classification: s.classification,
				sitemap: s.sitemap,
				dynamic: s.dynamic,
				files: s.files,
				urls: s.urls,
				reason: s.reason,
			})),
			sitemap: surface.sitemap,
			publicUrls: surface.publicUrls ?? surface.sitemap,
			externalHosts: surface.externalHosts,
			firstPartyHosts: surface.firstPartyHosts,
			externalUrls: surface.externalUrls.map((entry) => ({
				url: entry.url,
				host: entry.host,
				kind: entry.kind,
				identifier: entry.identifier,
				files: entry.files,
			})),
		},
		null,
		'\t',
	)}\n`;
}

/**
 * The transition a `--write` run approved, stored beside the surface it
 * produced. `invariantFindings` ride along because they are facts about the
 * surface itself (a loopback URL shipped, a route file with no declaration),
 * and a reader of the report should see them next to the delta.
 */
export function transitionOf(diff, invariantFindings = []) {
	return {
		addedPublicUrls: diff.addedPublicUrls,
		removedPublicUrls: diff.removedPublicUrls,
		addedExternalUrls: diff.addedExternalUrls,
		removedExternalUrls: diff.removedExternalUrls,
		addedExternalHosts: diff.addedExternalHosts,
		removedExternalHosts: diff.removedExternalHosts,
		addedBoundaryPrefixes: diff.addedBoundaryPrefixes ?? [],
		removedBoundaryPrefixes: diff.removedBoundaryPrefixes ?? [],
		classificationChanges: diff.classificationChanges,
		findings: [...invariantFindings, ...diff.findings],
	};
}

/**
 * The tracked snapshot: the approved surface plus the transition
 * that was approved to reach it. Keeping the transition INSIDE the
 * snapshot is what lets the report stay a pure function of the
 * snapshot — otherwise a report regenerated after the write would
 * describe an empty delta and lose the evidence of the change.
 */
export function serializeSnapshot(surface, transition) {
	return `${JSON.stringify(
		{
			schema: SNAPSHOT_SCHEMA,
			surface: JSON.parse(serializeSurfaceCore(surface)),
			approvedTransition: transition,
		},
		null,
		'\t',
	)}\n`;
}

/** Parse a committed snapshot, validating the schema tag. */
export function parseSnapshot(text) {
	const parsed = JSON.parse(text);
	if (parsed?.schema !== SNAPSHOT_SCHEMA) {
		throw new Error(`unsupported publication-surface schema: ${parsed?.schema}`);
	}
	if (!parsed.surface || !Array.isArray(parsed.surface.sitemap)) {
		throw new Error('publication-surface snapshot has no usable surface block');
	}
	return parsed;
}

const bullet = (values, empty = '(none)') =>
	values.length === 0 ? `- ${empty}` : values.map((value) => `- \`${value}\``).join('\n');

/**
 * Human-readable report.
 *
 * A pure function of `{ surface, transition }` — both of which come
 * out of the committed snapshot — so the tracked file can be
 * byte-compared in check mode: any unrecorded surface change leaves
 * the report stale and the gate red.
 */
export function renderMarkdownReport({ surface, transition }) {
	const t = transition ?? {
		addedPublicUrls: [],
		removedPublicUrls: [],
		addedExternalUrls: [],
		removedExternalUrls: [],
		addedExternalHosts: [],
		removedExternalHosts: [],
		addedBoundaryPrefixes: [],
		removedBoundaryPrefixes: [],
		classificationChanges: [],
		findings: [],
	};
	const lines = [
		'# Publication surface diff report',
		'',
		'> Generated by `pnpm run publication:write` (`scripts/check-publication-diff.mjs`).',
		'> Do not hand-edit: `pnpm run publication:check` fails when this file no longer',
		'> matches the surface computed from the working tree.',
		'',
		'| Item | Value |',
		'| --- | --- |',
		`| Canonical origin | \`${surface.origin}\` |`,
		`| First-party domain | \`${surface.firstPartyDomain}\` |`,
		`| External HTTP boundary | ${surface.externalBoundaryPrefixes.length > 0 ? surface.externalBoundaryPrefixes.map((p) => `\`${p}\``).join(', ') : '—'} |`,
		`| Declared surfaces | ${surface.surfaces.length} |`,
		`| Publicly reachable surfaces | ${surface.surfaces.filter((s) => s.classification === 'public').length} |`,
		`| Sitemap target URLs | ${surface.sitemap.length} |`,
		`| Publicly reachable URLs (surface + Static Assets) | ${(surface.publicUrls ?? surface.sitemap).length} |`,
		`| External hosts | ${surface.externalHosts.length} |`,
		`| First-party hosts | ${surface.firstPartyHosts.length} |`,
		`| Approved transition | ${t.findings.length === 0 ? 'no delta (first record, or unchanged surface)' : `${t.findings.length} finding(s)`} |`,
		`| Verdict of the approved transition | **${verdictOf(t.findings)}** |`,
		'',
		'## Sitemap targets (what this release asks crawlers for)',
		'',
		bullet(surface.sitemap),
		'',
		'## Publicly reachable URLs (the compared surface)',
		'',
		'Everything an unauthenticated visitor can reach: every `public` surface above',
		'(including the deliberately non-sitemap ones) plus the HTML documents Static',
		'Assets serve out of `public/`. Shrinking this list is what `E001` fails on.',
		'',
		bullet(surface.publicUrls ?? surface.sitemap),
		'',
		'## Declared surfaces',
		'',
		'| Surface | Path | Classification | Sitemap | Basis |',
		'| --- | --- | --- | --- | --- |',
		...surface.surfaces.map(
			(entry) =>
				`| \`${entry.id}\` | ${entry.path ? `\`${entry.path}\`` : '—'} | ${entry.classification} | ${entry.sitemap ? 'yes' : 'no'} | ${entry.files.map((f) => `\`${f}\``).join(', ')} |`,
		),
		'',
		'## Approved transition against the previous snapshot',
		'',
		`### Added public URLs (${t.addedPublicUrls.length})`,
		'',
		bullet(t.addedPublicUrls),
		'',
		`### Removed public URLs (${t.removedPublicUrls.length})`,
		'',
		bullet(t.removedPublicUrls),
		'',
		`### Added external hosts (${t.addedExternalHosts.length})`,
		'',
		bullet(t.addedExternalHosts),
		'',
		`### Removed external hosts (${t.removedExternalHosts.length})`,
		'',
		bullet(t.removedExternalHosts),
		'',
		`### Added external HTTP boundary prefixes (${t.addedBoundaryPrefixes.length})`,
		'',
		bullet(t.addedBoundaryPrefixes),
		'',
		`### Removed external HTTP boundary prefixes (${t.removedBoundaryPrefixes.length})`,
		'',
		bullet(t.removedBoundaryPrefixes),
		'',
		'## Audit targets — external URLs in shipped source',
		'',
		'`identifier` rows are non-dereferenced namespaces / dialects / license IDs; every',
		'other external row is a link a visitor can follow, i.e. an outbound dependency.',
		'',
		'| URL | Host | Role | Files |',
		'| --- | --- | --- | --- |',
		...surface.externalUrls
			.filter((entry) => entry.kind !== 'origin')
			.map(
				(entry) =>
					`| \`${entry.url}\` | \`${entry.host}\` | ${entry.kind}${entry.identifier ? ' / identifier' : ''} | ${entry.files.map((f) => `\`${f}\``).join(', ')} |`,
			),
		'',
		'## Findings in the approved transition',
		'',
		...(t.findings.length === 0
			? ['_No findings._']
			: t.findings.map(
					(finding) =>
						`- **${finding.severity.toUpperCase()}** \`${finding.code}\` ${finding.message}`,
				)),
		'',
	];
	return `${lines
		.filter((line) => line !== undefined)
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')}\n`;
}

const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
	);

/**
 * Standalone, self-contained HTML rendering of the same report —
 * the verification-screen surface for `docs/verification/content/
 * publication-diff-report.webp`. No external stylesheet, no fonts,
 * no network: the artefact has to render identically offline.
 */
export function renderHtmlReport({ surface, transition }) {
	const t = transition ?? {
		addedPublicUrls: [],
		removedPublicUrls: [],
		addedExternalUrls: [],
		removedExternalUrls: [],
		addedExternalHosts: [],
		removedExternalHosts: [],
		addedBoundaryPrefixes: [],
		removedBoundaryPrefixes: [],
		classificationChanges: [],
		findings: [],
	};
	const publicUrls = surface.publicUrls ?? surface.sitemap;
	const verdict = verdictOf(t.findings);
	const row = (cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
	const listOrEmpty = (values, empty = 'none') =>
		values.length === 0
			? `<p class="muted">${escapeHtml(empty)}</p>`
			: `<ul>${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Publication surface diff report</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.6 -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; margin: 0; padding: 40px; color: #1a1a1a; background: #fbfbf9; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin: 32px 0 8px; border-bottom: 1px solid #e2e0da; padding-bottom: 6px; }
  .sub { color: #6b6b6b; margin: 0 0 24px; }
  .verdict { display: inline-block; padding: 3px 12px; border-radius: 999px; font-weight: 700; letter-spacing: 0.04em; }
  .verdict.pass { background: #e6f2e6; color: #1c5c2c; }
  .verdict.review { background: #fbf1da; color: #7a5410; }
  .verdict.fail { background: #fbe4e4; color: #8c1f1f; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #e2e0da; padding: 6px 10px; text-align: left; vertical-align: top; font-size: 13px; }
  th { background: #f2f1ec; font-weight: 600; }
  td.metric { font-variant-numeric: tabular-nums; font-weight: 600; width: 280px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  ul { margin: 4px 0; padding-left: 22px; }
  .muted { color: #8a8a8a; }
  .finding { border-left: 3px solid #cfcac0; padding: 2px 0 2px 12px; margin: 6px 0; }
  .finding.error { border-left-color: #c0392b; }
  .finding.warn { border-left-color: #c08a1e; }
  .tag { font-size: 11px; letter-spacing: 0.08em; font-weight: 700; margin-right: 8px; }
</style>
</head>
<body>
<h1>Publication surface diff report</h1>
<p class="sub">公開面のスナップショット比較 — scripts/check-publication-diff.mjs（Issue #505）</p>

<h2>Summary</h2>
<table>
  <tr><td class="metric">Verdict of the approved transition</td><td><span class="verdict ${verdict}">${verdict.toUpperCase()}</span></td></tr>
  <tr><td class="metric">Canonical origin</td><td><code>${escapeHtml(surface.origin)}</code></td></tr>
  <tr><td class="metric">External HTTP boundary</td><td>${surface.externalBoundaryPrefixes.map((p) => `<code>${escapeHtml(p)}</code>`).join(' ') || '—'}</td></tr>
  <tr><td class="metric">Declared surfaces</td><td>${surface.surfaces.length}</td></tr>
  <tr><td class="metric">Publicly reachable surfaces</td><td>${surface.surfaces.filter((s) => s.classification === 'public').length}</td></tr>
  <tr><td class="metric">Sitemap target URLs</td><td>${surface.sitemap.length}</td></tr>
  <tr><td class="metric">Publicly reachable URLs (surface + Static Assets)</td><td>${publicUrls.length}</td></tr>
  <tr><td class="metric">External hosts</td><td>${surface.externalHosts.length}</td></tr>
  <tr><td class="metric">First-party hosts</td><td>${surface.firstPartyHosts.length}</td></tr>
  <tr><td class="metric">Findings in the approved transition</td><td>${t.findings.length}</td></tr>
</table>

<h2>Approved transition against the previous snapshot</h2>
<table>
  <tr><th>Signal</th><th>Added</th><th>Removed</th></tr>
  <tr><td>Publicly reachable URLs</td><td>${t.addedPublicUrls.length}</td><td>${t.removedPublicUrls.length}</td></tr>
  <tr><td>External hosts</td><td>${t.addedExternalHosts.length}</td><td>${t.removedExternalHosts.length}</td></tr>
  <tr><td>External URLs</td><td>${t.addedExternalUrls.length}</td><td>${t.removedExternalUrls.length}</td></tr>
  <tr><td>External HTTP boundary prefixes</td><td>${t.addedBoundaryPrefixes.length}</td><td>${t.removedBoundaryPrefixes.length}</td></tr>
  <tr><td>Surface classification changes</td><td colspan="2">${t.classificationChanges.length === 0 ? 'none' : t.classificationChanges.map((c) => escapeHtml(`${c.id}: ${c.from} → ${c.to}`)).join(', ')}</td></tr>
</table>

<h2>Sitemap targets (${surface.sitemap.length})</h2>
${listOrEmpty(surface.sitemap)}

<h2>Publicly reachable URLs (${publicUrls.length})</h2>
<p class="muted">every <code>public</code> surface (including the deliberately non-sitemap ones)
plus the HTML documents Static Assets serve out of <code>public/</code>. Shrinking this list is what
<code>E001</code> fails on.</p>
${listOrEmpty(publicUrls)}

<h2>Added public URLs (${t.addedPublicUrls.length})</h2>
${listOrEmpty(t.addedPublicUrls)}
<h2>Removed public URLs (${t.removedPublicUrls.length})</h2>
${listOrEmpty(t.removedPublicUrls)}
<h2>Added external hosts (${t.addedExternalHosts.length})</h2>
${listOrEmpty(t.addedExternalHosts)}
<h2>Removed external hosts (${t.removedExternalHosts.length})</h2>
${listOrEmpty(t.removedExternalHosts)}

<h2>Audit targets — external URLs in shipped source</h2>
<table>
  <tr><th>URL</th><th>Host</th><th>Role</th><th>Files</th></tr>
  ${surface.externalUrls
		.filter((entry) => entry.kind !== 'origin')
		.map((entry) =>
			row([
				`<code>${escapeHtml(entry.url)}</code>`,
				`<code>${escapeHtml(entry.host)}</code>`,
				escapeHtml(`${entry.kind}${entry.identifier ? ' / identifier' : ''}`),
				entry.files.map((f) => `<code>${escapeHtml(f)}</code>`).join('<br />'),
			]),
		)
		.join('\n  ')}
</table>

<h2>Findings (${t.findings.length})</h2>
${
	!t.findings.length
		? '<p class="muted">No findings.</p>'
		: t.findings
				.map(
					(finding) =>
						`<div class="finding ${finding.severity}"><span class="tag">${escapeHtml(finding.severity.toUpperCase())}</span><code>${escapeHtml(finding.code)}</code> ${escapeHtml(finding.message)}</div>`,
				)
				.join('\n')
}
</body>
</html>
`;
}
