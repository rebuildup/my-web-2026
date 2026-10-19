/**
 * Content link model — pure library (Issue #434).
 *
 * What this owns
 * --------------
 * A *content reference* is a link or an image written by an author in
 * something this repository publishes: a Markdown body (portfolio
 * content) or an HTML document served straight out of `public/`.
 * This module answers one question about each reference:
 *
 *   - an **internal** target that does not exist is an ERROR
 *     (a release must not publish a 404),
 *   - an **external** target is never authoritative about this
 *     release: a timeout / unreachable host / 5xx is a WARNING,
 *   - an image must carry alt text and a resolvable `src`.
 *
 * Nothing here rewrites, normalizes or "fixes" authored text. The
 * link checker reports; the author and the publication decision stay
 * with the content owner (the same separation `docs/portfolio/
 * markdown-format.md` draws between safety, typography and prose
 * quality). In particular this module deliberately does NOT call
 * `normalize()` on a path or a fragment: Issue #433's Unicode policy
 * applies to the whole shipped surface, and a validator that folded
 * two different strings together would hide exactly the collision it
 * is supposed to report.
 *
 * External checking is split in two:
 *
 *   - `classifyReference` is offline and deterministic. It can still
 *     fail a dangerous scheme (`javascript:`, `file:`, …) or a
 *     credential-bearing URL, because those are content defects.
 *   - `checkExternalTargets` dereferences the network only when the
 *     caller passes a fetch implementation (the CLI's explicit
 *     `--external` mode). Every failure there is a warning by
 *     construction, so an outage at a third party can never block a
 *     release of this repository.
 *
 * Pure by contract: no filesystem, no network, no clock. The CLI
 * layer (`scripts/check-content-links.mjs`) reads the files and owns
 * the exit code.
 */

import { isPrivateHost } from './publication-surface.mjs';

/**
 * Severity vocabulary.
 *
 * `error`   — a release must stop (internal 404, unsafe target,
 *             missing image alt).
 * `warning` — a reviewer should look, but a release is not blocked
 *             (external timeout, placeholder `#`, decorative-image
 *             review items).
 * `info`    — recorded for the report; never actionable on its own.
 */
export const SEVERITY = Object.freeze({
	ERROR: 'error',
	WARNING: 'warning',
	INFO: 'info',
});

/** Schemes that are never a legitimate published content target. */
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'vbscript:', 'file:']);

/** Schemes that carry no dereferenceable address. */
const NON_HTTP_SCHEMES = new Set(['mailto:', 'tel:', 'sms:', 'urn:']);

/**
 * ASCII C0 controls + DEL + the Unicode line / paragraph separators.
 *
 * A browser strips TAB / LF / CR from a URL before the scheme parser
 * runs, so `java&#9;script:alert(1)` navigates as `javascript:`.
 * `src/portfolio/markdown.lexer.ts` (`CONTROL_CHARACTERS`) is the
 * renderer's oracle; this gate must reject the same set on the raw
 * AND the entity-decoded value, otherwise the link is classified as
 * an ordinary external target and the forbidden scheme is lost.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point — the pattern is the deny-list.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/**
 * Named references that can spell a scheme or a control character.
 * Kept in step with `NAMED_ENTITIES` in `markdown.lexer.ts`; the two
 * names an author can use to hide a colon or a TAB must be decoded by
 * both the renderer and this gate.
 */
const HTML_ENTITY_MAP = {
	amp: '&',
	apos: "'",
	colon: ':',
	gt: '>',
	lt: '<',
	nbsp: '\u00a0',
	NewLine: '\n',
	quot: '"',
	semi: ';',
	sol: '/',
	Tab: '\t',
};

/** Decode the small entity set that can appear inside an attribute. */
export function decodeHtmlEntities(value) {
	return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
		const lower = body.toLowerCase();
		if (lower.startsWith('#x')) {
			const code = Number.parseInt(lower.slice(2), 16);
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
			try {
				return String.fromCodePoint(code);
			} catch {
				return match;
			}
		}
		if (lower.startsWith('#')) {
			const code = Number.parseInt(lower.slice(1), 10);
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
			try {
				return String.fromCodePoint(code);
			} catch {
				return match;
			}
		}
		return HTML_ENTITY_MAP[body] ?? HTML_ENTITY_MAP[lower] ?? match;
	});
}

/**
 * Remove the parts of an HTML document that are not markup: comments,
 * `<script>` bodies and `<style>` bodies. A static page usually carries
 * its search index and navigation logic in a script; scanning that text
 * would report JavaScript string literals as broken links.
 */
export function stripNonMarkup(html) {
	// Whitespace is preserved (newlines included) so a reported line number
	// still points at the authored line in the original document.
	const blank = (text) => text.replace(/[^\n]/g, '');
	return String(html ?? '')
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(
			/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi,
			(_, open, close) => `${open}${blank(close)}`,
		)
		.replace(
			/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi,
			(_, open, close) => `${open}${blank(close)}`,
		)
		.replace(
			/(<template\b[^>]*>)[\s\S]*?(<\/template\s*>)/gi,
			(_, open, close) => `${open}${blank(close)}`,
		);
}

/** Parse a tag's attributes into a lower-cased name → value map. */
export function parseAttributes(tag) {
	const attributes = new Map();
	const body = String(tag ?? '')
		.replace(/^<\s*\/?\s*[^\s/>]+/, '')
		.replace(/\/?>$/, '');
	const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
	let match = pattern.exec(body);
	while (match !== null) {
		const name = match[1].toLowerCase();
		if (!attributes.has(name)) {
			const raw = match[2] ?? match[3] ?? match[4] ?? '';
			attributes.set(name, decodeHtmlEntities(raw));
		}
		match = pattern.exec(body);
	}
	return attributes;
}

/**
 * Find element tags while skipping the void elements that the parser
 * does not need. The returned offsets are the line-number anchors the
 * report uses; they are not a DOM.
 */
function elementTags(html, tagName) {
	const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
	const tags = [];
	let match = pattern.exec(html);
	while (match !== null) {
		tags.push({ tag: match[0], index: match.index });
		match = pattern.exec(html);
	}
	return tags;
}

/** 1-based line number for a character offset. */
export function lineAt(text, offset) {
	let line = 1;
	for (let index = 0; index < offset && index < text.length; index += 1) {
		if (text[index] === '\n') line += 1;
	}
	return line;
}

/** A document id/anchor set, in document order. */
function idsOf(html) {
	const ids = new Set();
	for (const name of ['id', 'name']) {
		for (const { tag } of elementTags(html, '[a-z][a-z0-9-]*')) {
			const value = parseAttributes(tag).get(name);
			if (value) ids.add(value);
		}
	}
	return ids;
}

/**
 * Parse one HTML document into the references it actually publishes.
 *
 * Only elements a reader can activate or that load an image are
 * collected; `<link>`, `<script>` and `<style>` URLs are build concerns,
 * not authored content.
 */
export function parseHtmlDocument({ path, html }) {
	const source = stripNonMarkup(html);
	const references = [];
	const images = [];

	for (const { tag, index } of elementTags(source, 'a')) {
		const attributes = parseAttributes(tag);
		if (!attributes.has('href')) continue;
		references.push({
			kind: 'link',
			sourcePath: path,
			line: lineAt(source, index),
			raw: attributes.get('href') ?? '',
			label: attributes.get('aria-label') ?? attributes.get('title') ?? '',
		});
	}

	for (const { tag, index } of elementTags(source, 'img')) {
		const attributes = parseAttributes(tag);
		const src = attributes.get('src');
		if (src === undefined) {
			// A src-less image is usually a placeholder the page's script
			// fills (`#zoom img` in the share document). It cannot be
			// resolved, so it is reported but is not a broken URL.
			images.push({
				kind: 'image',
				sourcePath: path,
				line: lineAt(source, index),
				raw: '',
				alt: attributes.get('alt'),
				hasAlt: attributes.has('alt'),
				hasSrc: false,
				decorative:
					attributes.get('role') === 'presentation' || attributes.get('aria-hidden') === 'true',
			});
			continue;
		}
		images.push({
			kind: 'image',
			sourcePath: path,
			line: lineAt(source, index),
			raw: src,
			alt: attributes.get('alt'),
			hasAlt: attributes.has('alt'),
			hasSrc: true,
			decorative:
				attributes.get('role') === 'presentation' || attributes.get('aria-hidden') === 'true',
		});

		// `srcset` carries additional candidates; each one is a URL a
		// browser may fetch, so it is validated with the same policy.
		const srcset = attributes.get('srcset');
		if (srcset) {
			for (const candidate of srcset.split(',')) {
				const [url] = candidate.trim().split(/\s+/);
				if (!url) continue;
				images.push({
					kind: 'image',
					sourcePath: path,
					line: lineAt(source, index),
					raw: url,
					alt: attributes.get('alt'),
					hasAlt: attributes.has('alt'),
					hasSrc: true,
					decorative:
						attributes.get('role') === 'presentation' || attributes.get('aria-hidden') === 'true',
					srcsetCandidate: true,
				});
			}
		}
	}

	return {
		kind: 'html',
		path,
		ids: idsOf(source),
		references,
		images,
	};
}

/**
 * Remove fenced code blocks and inline code spans before looking for
 * Markdown links. A link written inside code is documentation about a
 * link, not a link.
 */
export function stripMarkdownCode(markdown) {
	const blank = (text) => text.replace(/[^\n]/g, '');
	return String(markdown ?? '')
		.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, blank)
		.replace(/`{2,}[^`]*`{2,}/g, blank)
		.replace(/`[^`\n]*`/g, blank);
}

/**
 * Parse the link and image syntax the Portfolio Markdown contract
 * accepts (`[text](url)`, `![alt](url)`). Raw HTML in a Markdown body is
 * deliberately NOT parsed: `src/portfolio/markdown.lexer.ts` renders it
 * as inert text, so it publishes no reference.
 *
 * Images are not rendered by the current lexer (Issue #435's contract
 * records that), but they are still checked: the authored reference is
 * what a future renderer would publish, and publishing it broken is a
 * content defect either way.
 */
export function parseMarkdownDocument({ path, markdown }) {
	const source = stripMarkdownCode(markdown);
	const references = [];
	const images = [];

	const imagePattern = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
	let match = imagePattern.exec(source);
	while (match !== null) {
		images.push({
			kind: 'image',
			sourcePath: path,
			line: lineAt(source, match.index),
			raw: match[2],
			alt: match[1],
			hasAlt: true,
			hasSrc: true,
			decorative: false,
		});
		match = imagePattern.exec(source);
	}

	// Links. The image syntax has already been consumed; removing it
	// keeps the leading `!` from being read as a link label boundary.
	const withoutImages = source.replace(imagePattern, '');
	const linkPattern = /\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
	match = linkPattern.exec(withoutImages);
	while (match !== null) {
		references.push({
			kind: 'link',
			sourcePath: path,
			line: lineAt(withoutImages, match.index),
			raw: match[2],
			label: match[1],
		});
		match = linkPattern.exec(withoutImages);
	}

	return {
		kind: 'markdown',
		path,
		ids: new Set(),
		references,
		images,
	};
}

/** True when a URL parses as absolute with a scheme. */
function schemeOf(raw) {
	const match = /^([a-z][a-z0-9+.-]*:)/i.exec(String(raw ?? '').trim());
	return match ? match[1].toLowerCase() : null;
}

/**
 * Resolve a reference against the document that contains it.
 *
 * Returns `{ kind: 'internal' | 'external' | 'non-http' | 'forbidden' |
 * 'empty', ... }`. Resolution uses WHATWG `URL` with a fixed base, not
 * a hand-written path concatenation, so `..`, `.`, encoded octets and
 * query strings behave the way a browser behaves.
 */
export function classifyReference(raw, { documentPath, origin = 'https://rebuildup.dev' } = {}) {
	const value = String(raw ?? '').trim();
	if (value === '') return { kind: 'empty', target: '' };

	// Reject an obfuscated scheme before either the regex or `new URL()`
	// sees it. `java\tscript:` and `java&#9;script:` are the same URL to
	// a browser; the raw / decoded pair is also the pair the renderer's
	// `classifyHref` checks. The authored string stays the reported
	// target so the author can find the character that must go.
	const decoded = decodeHtmlEntities(value);
	if (CONTROL_CHARACTERS.test(value) || CONTROL_CHARACTERS.test(decoded)) {
		return { kind: 'control-character', target: value };
	}

	const scheme = schemeOf(decoded);
	if (scheme && FORBIDDEN_SCHEMES.has(scheme)) {
		return { kind: 'forbidden', target: value, scheme };
	}
	if (scheme && NON_HTTP_SCHEMES.has(scheme)) {
		return { kind: 'non-http', target: value, scheme };
	}
	if (scheme && scheme !== 'http:' && scheme !== 'https:') {
		return { kind: 'forbidden', target: value, scheme };
	}

	let url;
	try {
		url = new URL(decoded, new URL(documentPath, origin));
	} catch {
		return { kind: 'invalid', target: value };
	}

	const sameOrigin = url.origin === new URL(origin).origin;
	if (!sameOrigin) {
		return {
			kind: 'external',
			target: value,
			url: url.href,
			protocol: url.protocol,
			host: url.hostname,
			hasCredentials: url.username !== '' || url.password !== '',
			insecure: url.protocol === 'http:',
			privateHost: isPrivateHost(url.hostname),
		};
	}

	return {
		kind: 'internal',
		target: value,
		url,
		path: url.pathname,
		fragment: url.hash.startsWith('#') ? url.hash.slice(1) : '',
	};
}

/** Candidate filesystem/route names for an internal path. */
export function internalPathCandidates(path) {
	const candidates = new Set();
	const decoded = (() => {
		try {
			return decodeURIComponent(path);
		} catch {
			return null;
		}
	})();
	// A percent-decoded value is a useful candidate for an encoded space or
	// a Unicode filename, but `%2F` must NOT become a path separator: static
	// hosting does not treat it as one, so accepting it would hide a 404.
	const decodedAddsSeparator =
		decoded !== null && decoded.split('/').length !== path.split('/').length;
	const bases = decoded === null || decodedAddsSeparator ? [path] : [path, decoded];
	for (const base of bases) {
		candidates.add(base);
		if (base.endsWith('/')) {
			candidates.add(`${base}index.html`);
		} else {
			candidates.add(`${base}/`);
			candidates.add(`${base}/index.html`);
		}
	}
	return candidates;
}

/**
 * Does this internal path exist in the release surface?
 *
 * `surface` carries two sets:
 *   - `publicFiles` — every file under `public/`, as a URL path
 *     (`/share/procon2026/assets/...`);
 *   - `routePaths` — every URL a route declaration produces, including
 *     dynamic expansions (`/portfolio/<slug>`).
 *
 * A directory-style link (`/portfolio/`) and its canonical form
 * (`/portfolio`) are the same surface entry.
 */
export function resolveInternalTarget(
	path,
	{ publicFiles = new Set(), routePaths = new Set() } = {},
) {
	const candidates = internalPathCandidates(path);
	for (const candidate of candidates) {
		if (publicFiles.has(candidate) || routePaths.has(candidate)) {
			return {
				exists: true,
				candidate,
			};
		}
	}
	return { exists: false, candidate: null, document: false };
}

/** Canonical form used when comparing a path against the surface sets. */
export function canonicalSurfacePath(path) {
	if (path === '/') return '/';
	return path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Build the surface sets from the callsite's already-read inputs.
 * `publicFiles` are repo-relative paths (`public/share/.../index.html`).
 */
export function buildSurfaceSets({ publicFiles = [], routePaths = [] } = {}) {
	const files = new Set();
	for (const file of publicFiles) {
		const withoutRoot = file.startsWith('public/') ? file.slice('public/'.length) : file;
		files.add(`/${withoutRoot}`);
		if (withoutRoot === 'index.html') files.add('/');
		if (withoutRoot.endsWith('/index.html')) {
			files.add(`/${withoutRoot.slice(0, -'index.html'.length)}`);
			files.add(`/${withoutRoot}`);
		}
	}
	const routes = new Set();
	for (const path of routePaths) {
		routes.add(canonicalSurfacePath(path));
		routes.add(path.endsWith('/') ? path : `${path}/`);
	}
	return { publicFiles: files, routePaths: routes };
}

function finding({ severity, code, message, sourcePath, line, target, kind }) {
	return { severity, code, message, sourcePath, line, target, kind };
}

/**
 * Offline validation: every reference and image in every document.
 *
 * `documentsById` maps a public URL path (`/share/.../index.html`) to
 * the parsed document, so a fragment on a static target can be checked
 * against that target's real ids. A fragment on a route page is not
 * checked: React owns ids there and this gate would be guessing.
 */
export function validateDocuments({
	documents,
	surface,
	origin = 'https://rebuildup.dev',
	documentsById = new Map(),
}) {
	const findings = [];

	for (const document of documents) {
		const documentPath = document.urlPath ?? document.path;
		for (const reference of document.references) {
			const classified = classifyReference(reference.raw, { documentPath, origin });
			const where = {
				sourcePath: reference.sourcePath,
				line: reference.line,
				target: reference.raw,
				kind: 'link',
			};

			switch (classified.kind) {
				case 'empty':
					findings.push(
						finding({
							...where,
							severity: SEVERITY.WARNING,
							code: 'W108 empty-link',
							message: 'an anchor has an empty href; it points at the current document',
						}),
					);
					break;
				case 'forbidden':
					findings.push(
						finding({
							...where,
							severity: SEVERITY.ERROR,
							code: 'E102 forbidden-scheme',
							message: `the "${classified.scheme}" scheme is refused by the content policy`,
						}),
					);
					break;
				case 'control-character':
					findings.push(
						finding({
							...where,
							severity: SEVERITY.ERROR,
							code: 'E111 control-character',
							message:
								'the target contains TAB / LF / CR or another control character; a browser removes it before resolving the scheme',
						}),
					);
					break;
				case 'invalid':
					findings.push(
						finding({
							...where,
							severity: SEVERITY.ERROR,
							code: 'E103 invalid-url',
							message: 'the URL cannot be parsed',
						}),
					);
					break;
				case 'non-http':
					findings.push(
						finding({
							...where,
							severity: SEVERITY.INFO,
							code: 'I101 non-http-target',
							message: `"${classified.scheme}" target is not dereferenced by this gate`,
						}),
					);
					break;
				case 'external':
					if (classified.hasCredentials) {
						findings.push(
							finding({
								...where,
								severity: SEVERITY.ERROR,
								code: 'E104 credential-url',
								message: 'a published URL must not carry a username or password',
							}),
						);
					}
					if (classified.privateHost) {
						findings.push(
							finding({
								...where,
								severity: SEVERITY.ERROR,
								code: 'E110 private-host',
								message: 'a published link must not point at a loopback / private address',
							}),
						);
					}
					if (classified.insecure) {
						findings.push(
							finding({
								...where,
								severity: SEVERITY.WARNING,
								code: 'W101 insecure-external',
								message: 'external target uses http; the browser will downgrade the link',
							}),
						);
					}
					findings.push(
						finding({
							...where,
							severity: SEVERITY.INFO,
							code: 'I102 external-target',
							message:
								'external target; dereferenced only in --external mode (failures are warnings)',
						}),
					);
					break;
				case 'internal': {
					if (classified.fragment === '' && reference.raw.trim() === '#') {
						findings.push(
							finding({
								...where,
								severity: SEVERITY.WARNING,
								code: 'W102 placeholder-link',
								message: '`href="#"` is a placeholder; it navigates nowhere',
							}),
						);
						break;
					}
					const resolved = resolveInternalTarget(classified.path, surface);
					if (!resolved.exists) {
						findings.push(
							finding({
								...where,
								severity: SEVERITY.ERROR,
								code: 'E105 internal-404',
								message: `no public file or route serves ${classified.path}`,
							}),
						);
						break;
					}
					if (classified.fragment && classified.fragment !== 'top') {
						const targetDocument = documentsById.get(resolved.candidate);
						if (targetDocument && !targetDocument.ids.has(classified.fragment)) {
							findings.push(
								finding({
									...where,
									severity: SEVERITY.ERROR,
									code: 'E106 missing-fragment',
									message: `#${classified.fragment} does not exist in ${resolved.candidate}`,
								}),
							);
						}
					}
					break;
				}
				default:
					break;
			}
		}

		for (const image of document.images) {
			const where = {
				sourcePath: image.sourcePath,
				line: image.line,
				target: image.raw,
				kind: 'image',
			};
			if (!image.hasAlt) {
				findings.push(
					finding({
						...where,
						severity: SEVERITY.ERROR,
						code: 'E107 image-alt-missing',
						message: 'an image has no alt attribute; a reader without the image gets nothing',
					}),
				);
			} else if ((image.alt ?? '').trim() === '' && !image.decorative) {
				findings.push(
					finding({
						...where,
						severity: SEVERITY.WARNING,
						code: 'W103 image-alt-empty',
						message: 'empty alt is decorative; mark it role="presentation" if that is intended',
					}),
				);
			}

			if (!image.hasSrc) {
				findings.push(
					finding({
						...where,
						severity: SEVERITY.WARNING,
						code: 'W104 image-src-missing',
						message: 'the image has no src; a script must supply it at runtime',
					}),
				);
				continue;
			}

			const classified = classifyReference(image.raw, { documentPath, origin });
			if (classified.kind === 'external') {
				findings.push(
					finding({
						...where,
						severity: SEVERITY.INFO,
						code: 'I103 external-image',
						message: 'external image; dereferenced only in --external mode (failures are warnings)',
					}),
				);
			} else if (classified.kind === 'internal') {
				if (!resolveInternalTarget(classified.path, surface).exists) {
					findings.push(
						finding({
							...where,
							severity: SEVERITY.ERROR,
							code: 'E108 image-404',
							message: `image source ${classified.path} does not exist in the published surface`,
						}),
					);
				}
			} else if (
				classified.kind === 'forbidden' ||
				classified.kind === 'invalid' ||
				classified.kind === 'control-character'
			) {
				findings.push(
					finding({
						...where,
						severity: SEVERITY.ERROR,
						code: 'E109 image-scheme',
						message: 'the image source is not a permitted URL',
					}),
				);
			}
		}
	}

	return findings;
}

/**
 * Dereference external targets. Every outcome that is not a 2xx/3xx is
 * a WARNING: the third party is not this release's authority, and the
 * Issue explicitly asks for `timeout` to be distinguishable from an
 * internal 404 rather than to fail the build.
 */
export async function checkExternalTargets(
	targets,
	{ fetchImpl = null, timeoutMs = 5000, origin = 'https://rebuildup.dev' } = {},
) {
	if (typeof fetchImpl !== 'function') return [];

	const unique = [...new Set(targets)].sort();
	const findings = [];
	for (const raw of unique) {
		const classified = classifyReference(raw, { documentPath: '/', origin });
		if (classified.kind !== 'external') continue;
		// Defence in depth: the caller filters too, but this function is
		// exported and must never send a request to a loopback / private
		// address (cloud metadata included) or replay a credential. A
		// `--external` run is operator-initiated, not a licence to SSRF.
		if (classified.privateHost || classified.hasCredentials) continue;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(classified.url, {
				method: 'HEAD',
				// Do not follow a redirect automatically: a public URL can
				// redirect into private space. A 3xx is reported as a
				// warning for a reviewer instead of being dereferenced.
				redirect: 'manual',
				signal: controller.signal,
			});
			if (!response.ok) {
				findings.push(
					finding({
						severity: SEVERITY.WARNING,
						code: 'W105 external-http-status',
						message: `external target answered HTTP ${response.status}`,
						sourcePath: '--external',
						line: 0,
						target: raw,
						kind: 'external',
					}),
				);
			}
		} catch (error) {
			const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
			findings.push(
				finding({
					severity: SEVERITY.WARNING,
					code: timedOut ? 'W106 external-timeout' : 'W107 external-unreachable',
					message: timedOut
						? `external target did not answer within ${timeoutMs} ms`
						: `external target could not be reached (${error?.message ?? 'network error'})`,
					sourcePath: '--external',
					line: 0,
					target: raw,
					kind: 'external',
				}),
			);
		} finally {
			clearTimeout(timer);
		}
	}
	return findings;
}

/**
 * Replace the `userinfo` of an absolute URL before it is printed or
 * rendered. The gate reports a credential-bearing target as an error;
 * the report must not become the place the credential leaks.
 */
export function redactTarget(value) {
	const text = String(value ?? '');
	let url;
	try {
		url = new URL(text);
	} catch {
		return text;
	}
	if (url.username === '' && url.password === '') return text;
	url.username = url.username ? '***' : '';
	url.password = url.password ? '***' : '';
	return url.href;
}

/**
 * Media rows authored in the portfolio seed carry alt text but an R2 key,
 * not a URL. The key is not a published path (the public media base URL is
 * an environment value), so only the alt contract is checkable offline.
 */
export function validateMediaAlt({ slug, media = [] }) {
	const findings = [];
	for (const item of media) {
		if (typeof item.alt !== 'string' || item.alt.trim() === '') {
			findings.push(
				finding({
					severity: SEVERITY.ERROR,
					code: 'E107 image-alt-missing',
					message: `media "${item.r2Key ?? '(no key)'}" has no alt text`,
					sourcePath: 'src/portfolio/seed.ts',
					line: 0,
					target: item.r2Key ?? '',
					kind: 'media',
					slug,
				}),
			);
		}
	}
	return findings;
}

/** Collapse findings that describe the same defect at the same place. */
export function groupFindings(findings) {
	const groups = new Map();
	for (const item of findings) {
		// Line numbers are collapsed on purpose: the share document has the
		// same runtime placeholder 31 times, and a reviewer needs one row,
		// not 31 copies of it. The first occurrence is the location shown.
		const key = [item.code, item.sourcePath, item.target, item.message].join('|');
		const existing = groups.get(key);
		if (existing) existing.count += 1;
		else groups.set(key, { ...item, count: 1 });
	}
	return [...groups.values()].sort((a, b) => {
		const rank = { error: 0, warning: 1, info: 2 };
		if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
		if (a.sourcePath !== b.sourcePath) return a.sourcePath < b.sourcePath ? -1 : 1;
		if (a.line !== b.line) return a.line - b.line;
		return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
	});
}

/** Counts used by the CLI, the report and the tests. */
export function summarize(findings) {
	const counts = { error: 0, warning: 0, info: 0 };
	for (const item of findings) counts[item.severity] += 1;
	return {
		...counts,
		total: findings.length,
		verdict: counts.error === 0 ? 'pass' : 'fail',
	};
}

/** The relative path a public file is served at. */
export function publicUrlPath(publicFile) {
	const withoutRoot = publicFile.startsWith('public/')
		? publicFile.slice('public/'.length)
		: publicFile;
	if (withoutRoot === 'index.html') return '/';
	if (withoutRoot.endsWith('/index.html')) {
		return `/${withoutRoot.slice(0, -'index.html'.length)}`;
	}
	return `/${withoutRoot}`;
}
