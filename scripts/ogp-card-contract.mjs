/**
 * Open Graph / Twitter card policy engine (Issue #421).
 *
 * ## One engine, two front-ends
 *
 * The CI gate is `test/integration/ogp-card.test.ts`, which drives the
 * REAL Worker through `SELF.fetch` and evaluates the SSR `<head>` each
 * public surface actually renders. `scripts/check-ogp-card.mjs --live
 * <baseUrl>` is the same engine pointed at a real origin. A rule cannot
 * pass in one and fail in the other.
 *
 * Plain `.mjs` with no `fs` and no JSON import on purpose: the same
 * file is loaded by the workerd test pool (which has no filesystem) and
 * by plain Node. The repository contract (`contract.json`) is NOT read
 * here — it is passed in as `policy` / `surfaces`, so this module never
 * holds a second copy of the site name, the locale or the fallback card
 * that `src/editorial/social-card/contract.ts` owns.
 *
 * ## What this engine does and does not decide
 *
 * It answers exactly one question: **does the rendered document match
 * the card contract this repository declares?** There is no OGP
 * validator service, no Rich-Results-style verdict, and no claim about
 * what any specific unfurler will render. `og:image` correctness on
 * somebody else's server is out of reach from here; the reach of this
 * gate is "the tags we emit say what we say they say".
 *
 * ## No silent passes
 *
 *   - A declared surface nobody observed is `inventory.unobserved`.
 *   - A request that errored is `observation.request-failed` — a
 *     transport failure is never reported as an absent card.
 *   - A surface declared `cardPolicy: 'none'` that emits an
 *     `og:image` is `card.undeclared-image`: the degradation a
 *     declaration hides must not accumulate quietly.
 *   - `evaluateSocialCard` returns the image SOURCE (`content` /
 *     `fallback`) in its verdict, so the report can show which
 *     representative URL rendered its own media and which one fell
 *     back — the missing-media case is a row, not an absence.
 */

/** @typedef {{ url: string, alt: string, width: number|null, height: number|null }} ResolvedImage */

/**
 * @typedef {object} SocialCardPolicy
 * @property {string} canonicalOrigin
 * @property {string} siteName
 * @property {string} siteLocale
 * @property {string} fallbackCardUrl
 * @property {string} fallbackCardAlt
 * @property {number} fallbackCardWidth
 * @property {number} fallbackCardHeight
 */

/**
 * @typedef {object} SocialCardSurface
 * @property {string} path          router route id, e.g. `/portfolio/$slug`
 * @property {boolean} public
 * @property {'implemented'|'not-implemented'} status
 * @property {string} [ogType]
 * @property {'content-first'|'none'} cardPolicy
 * @property {string} samplePath     concrete URL used for observation
 * @property {string} note
 */

/** Tag keys that carry an image claim, so `card.undeclared-image` is exhaustive. */
export const IMAGE_TAG_KEYS = Object.freeze([
	'og:image',
	'og:image:alt',
	'og:image:width',
	'og:image:height',
	'og:image:secure_url',
	'og:image:type',
	'og:image:url',
	'twitter:image',
	'twitter:image:src',
]);

/** Collapse whitespace the way the HTML parser leaves it. */
function collapse(value) {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim();
}

function firstContent(tags, key) {
	for (const tag of tags ?? []) {
		if (tag?.property === key || tag?.name === key) {
			return collapse(tag.content ?? '');
		}
	}
	return null;
}

function hasTag(tags, key) {
	return (tags ?? []).some((tag) => tag?.property === key || tag?.name === key);
}

/**
 * Normalize a parsed head into the card fields the rules read.
 *
 * @param {Array<{property?: string, name?: string, content?: string}>} tags
 * @returns {Record<string, string|null>}
 */
export function summarizeSocialCard(tags) {
	return {
		ogType: firstContent(tags, 'og:type'),
		ogSiteName: firstContent(tags, 'og:site_name'),
		ogLocale: firstContent(tags, 'og:locale'),
		ogTitle: firstContent(tags, 'og:title'),
		ogDescription: firstContent(tags, 'og:description'),
		ogUrl: firstContent(tags, 'og:url'),
		ogImage: firstContent(tags, 'og:image'),
		ogImageAlt: firstContent(tags, 'og:image:alt'),
		ogImageWidth: firstContent(tags, 'og:image:width'),
		ogImageHeight: firstContent(tags, 'og:image:height'),
		twitterCard: firstContent(tags, 'twitter:card'),
		twitterTitle: firstContent(tags, 'twitter:title'),
		twitterDescription: firstContent(tags, 'twitter:description'),
		twitterImage: firstContent(tags, 'twitter:image'),
	};
}

function finding(rule, surface, message) {
	return { rule, path: surface.path, samplePath: surface.samplePath, message };
}

/**
 * Classify the image the document published.
 *
 * `content` / `fallback` come from the URL alone — the document is the
 * only evidence available, and the fallback URL is declared, so the two
 * branches cannot be confused.
 *
 * @param {string|null} url
 * @param {SocialCardPolicy} policy
 * @returns {'content'|'fallback'|'none'}
 */
export function imageSourceOf(url, policy) {
	if (!url) return 'none';
	return url === policy.fallbackCardUrl ? 'fallback' : 'content';
}

/** Is this an absolute http(s) URL a crawler could fetch? */
function isAbsoluteHttpUrl(value) {
	return typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value);
}

/**
 * Evaluate one surface's rendered head against its declared contract.
 *
 * @param {{ surface: SocialCardSurface, tags: Array<object>, policy: SocialCardPolicy }} input
 * @returns {{ findings: Array<object>, head: Record<string, string|null>, image: { url: string, source: string }|null }}
 */
export function evaluateSocialCard({ surface, tags, policy }) {
	const head = summarizeSocialCard(tags);
	const findings = [];
	const image = head.ogImage
		? { url: head.ogImage, source: imageSourceOf(head.ogImage, policy) }
		: null;

	// A surface that declares no card must publish none. The finding is
	// the point: the day somebody adds an og:image here, the contract
	// and the document disagree and this fails.
	if (surface.cardPolicy === 'none') {
		for (const key of IMAGE_TAG_KEYS) {
			if (hasTag(tags, key)) {
				findings.push(
					finding(
						'card.undeclared-image',
						surface,
						`declares cardPolicy "none" but the document publishes ${key}`,
					),
				);
				break;
			}
		}
		if (head.twitterCard !== null && head.twitterCard !== 'summary') {
			findings.push(
				finding(
					'card.undeclared-card-type',
					surface,
					`declares cardPolicy "none" but twitter:card is "${head.twitterCard}"`,
				),
			);
		}
		return { findings, head, image };
	}

	// From here the surface claims a card, so it owes one.
	if (surface.status !== 'implemented') {
		findings.push(
			finding(
				'card.inconsistent-entry',
				surface,
				'cardPolicy is not "none" but status is not "implemented"',
			),
		);
		return { findings, head, image };
	}

	// A registry defect, not a document defect: without a declared
	// `og:type` every later comparison is against `undefined`, so the
	// document is not evaluated at all. The coverage gate fails the
	// entry separately; this keeps a broken entry from producing a pile
	// of misleading document findings on top of it.
	if (!surface.ogType) {
		findings.push(
			finding('card.inconsistent-entry', surface, 'implemented surface declares no og:type'),
		);
		return { findings, head, image };
	}

	if (head.ogType !== surface.ogType) {
		findings.push(
			finding(
				'card.og-type',
				surface,
				`og:type is "${head.ogType ?? '(absent)'}", contract says "${surface.ogType}"`,
			),
		);
	}
	if (head.ogSiteName !== policy.siteName) {
		findings.push(
			finding('card.site-name', surface, `og:site_name is "${head.ogSiteName ?? '(absent)'}"`),
		);
	}
	if (head.ogLocale !== policy.siteLocale) {
		findings.push(finding('card.locale', surface, `og:locale is "${head.ogLocale ?? '(absent)'}"`));
	}
	if (!head.ogTitle) findings.push(finding('card.title', surface, 'og:title is absent'));
	if (!head.ogDescription)
		findings.push(finding('card.description', surface, 'og:description is absent'));
	if (!isAbsoluteHttpUrl(head.ogUrl ?? '')) {
		findings.push(
			finding(
				'card.url',
				surface,
				`og:url is "${head.ogUrl ?? '(absent)'}" (want an absolute URL)`,
			),
		);
	} else if (!(head.ogUrl ?? '').startsWith(policy.canonicalOrigin)) {
		findings.push(
			finding('card.url-origin', surface, `og:url is not on ${policy.canonicalOrigin}`),
		);
	}

	if (!image) {
		// The whole Issue in one line: a surface with no composable
		// media must still publish the declared fallback card.
		findings.push(
			finding(
				'card.image-missing',
				surface,
				`no og:image published (neither content media nor the fallback card ${policy.fallbackCardUrl})`,
			),
		);
	} else {
		if (!isAbsoluteHttpUrl(image.url)) {
			findings.push(
				finding('card.image-absolute', surface, `og:image "${image.url}" is not absolute`),
			);
		}
		if (!head.ogImageAlt) {
			findings.push(finding('card.image-alt', surface, 'og:image:alt is absent or empty'));
		}
		if (image.source === 'fallback') {
			// The fallback declares its own intrinsic size; a fallback
			// without it makes `summary_large_image` a claim nobody can
			// check.
			if (head.ogImageWidth !== String(policy.fallbackCardWidth)) {
				findings.push(
					finding(
						'card.image-width',
						surface,
						`og:image:width is "${head.ogImageWidth ?? '(absent)'}"`,
					),
				);
			}
			if (head.ogImageHeight !== String(policy.fallbackCardHeight)) {
				findings.push(
					finding(
						'card.image-height',
						surface,
						`og:image:height is "${head.ogImageHeight ?? '(absent)'}"`,
					),
				);
			}
			if (head.ogImageAlt !== policy.fallbackCardAlt) {
				findings.push(
					finding('card.image-alt', surface, 'the fallback card must publish its declared alt'),
				);
			}
		} else {
			for (const key of ['og:image:width', 'og:image:height']) {
				const value = key === 'og:image:width' ? head.ogImageWidth : head.ogImageHeight;
				if (value !== null && !/^\d+$/.test(value)) {
					findings.push(
						finding('card.image-dimensions', surface, `${key} is "${value}" (want an integer)`),
					);
				}
			}
		}
		if (head.twitterCard !== 'summary_large_image') {
			findings.push(
				finding(
					'card.twitter-card',
					surface,
					`twitter:card is "${head.twitterCard ?? '(absent)'}"`,
				),
			);
		}
		if (head.twitterImage !== image.url) {
			findings.push(
				finding('card.twitter-image', surface, 'twitter:image does not match og:image'),
			);
		}
		if (head.twitterTitle !== head.ogTitle) {
			findings.push(
				finding('card.twitter-title', surface, 'twitter:title does not match og:title'),
			);
		}
		if (head.twitterDescription !== head.ogDescription) {
			findings.push(
				finding(
					'card.twitter-description',
					surface,
					'twitter:description does not match og:description',
				),
			);
		}
	}

	return { findings, head, image };
}

/**
 * Evaluate every declared surface.
 *
 * @param {{ surfaces: SocialCardSurface[], observations: Array<object>, policy: SocialCardPolicy }} input
 * @returns {{ findings: Array<object>, rows: Array<object> }}
 */
export function evaluateSocialCards({ surfaces, observations, policy }) {
	const findings = [];
	const rows = [];

	for (const surface of surfaces) {
		const observation = (observations ?? []).find(
			(candidate) => candidate?.path === surface.samplePath,
		);

		if (!observation) {
			findings.push(
				finding('inventory.unobserved', surface, 'declared surface produced no observation'),
			);
			continue;
		}
		if (observation.requestFailed) {
			findings.push(
				finding(
					'observation.request-failed',
					surface,
					`request failed: ${observation.requestError ?? 'unknown error'}`,
				),
			);
			continue;
		}
		if (typeof observation.status === 'number' && observation.status !== 200) {
			findings.push(
				finding(
					'observation.status',
					surface,
					`answered HTTP ${observation.status}, expected a document`,
				),
			);
			continue;
		}

		const {
			findings: surfaceFindings,
			head,
			image,
		} = evaluateSocialCard({
			surface,
			tags: observation.tags ?? [],
			policy,
		});
		findings.push(...surfaceFindings);
		rows.push({
			path: surface.path,
			samplePath: surface.samplePath,
			status: surface.status,
			cardPolicy: surface.cardPolicy,
			ogType: head.ogType,
			image: image ? { url: image.url, source: image.source } : null,
			twitterCard: head.twitterCard,
			ok: surfaceFindings.length === 0,
		});
	}

	return { findings, rows };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** Plain-text report — the shape an operator reads in a terminal. */
export function renderTextReport(result) {
	const lines = [`Open Graph / Twitter card — ${result.rows.length} surface(s)`];
	for (const row of result.rows) {
		const image = row.image ? `${row.image.source}  ${row.image.url}` : '(no image)';
		lines.push(`  ${row.ok ? 'PASS' : 'FAIL'}  ${row.samplePath.padEnd(34)} ${image}`);
	}
	for (const item of result.findings) {
		lines.push(`  [${item.rule}] ${item.path}: ${item.message}`);
	}
	lines.push(result.findings.length === 0 ? 'no findings' : `${result.findings.length} finding(s)`);
	return lines.join('\n');
}

/**
 * Self-contained HTML report.
 *
 * Deliberately inlines the image itself when the document published the
 * site fallback card (it is same-origin and committed), and otherwise
 * prints the URL as text instead of embedding it: a report must render
 * the same thing on an offline machine as on CI, and an `<img>` pointing
 * at a media host would silently degrade to a broken box.
 */
export function renderHtmlReport(result, { fallbackCardDataUri = null } = {}) {
	const rows = result.rows
		.map((row) => {
			const image = row.image
				? row.image.source === 'fallback' && fallbackCardDataUri
					? `<img src="${escapeHtml(fallbackCardDataUri)}" alt="site fallback card" />`
					: `<span class="placeholder">image not embedded (remote URL)</span>`
				: `<span class="placeholder">no og:image</span>`;
			return `<tr class="${row.ok ? 'ok' : 'bad'}">
    <td class="status">${row.ok ? 'PASS' : 'FAIL'}</td>
    <td><code>${escapeHtml(row.samplePath)}</code></td>
    <td><code>${escapeHtml(row.cardPolicy)}</code></td>
    <td><code>${escapeHtml(row.ogType ?? '(absent)')}</code></td>
    <td><code>${escapeHtml(row.image?.source ?? 'none')}</code></td>
    <td><code>${escapeHtml(row.image?.url ?? '(none)')}</code></td>
    <td class="thumb">${image}</td>
  </tr>`;
		})
		.join('\n');

	const findingRows = result.findings.length
		? result.findings
				.map(
					(item) =>
						`<tr class="bad"><td><code>${escapeHtml(item.rule)}</code></td><td><code>${escapeHtml(item.path)}</code></td><td>${escapeHtml(item.message)}</td></tr>`,
				)
				.join('\n')
		: '<tr><td colspan="3">no findings</td></tr>';

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Open Graph / Twitter card — Issue #421</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: 0.02em; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; max-width: 900px; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; word-break: break-all; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 60px; }
  tr.ok .status { color: #1c6b3a; }
  tr.bad .status, tr.bad { color: #a12020; }
  .thumb img { width: 160px; border: 1px solid #dedcd2; display: block; }
  .placeholder { color: #77776a; font-size: 12px; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>Open Graph / Twitter card — Issue #421</h1>
  <p class="sub">実 SSR 応答の <code>&lt;head&gt;</code> を <code>src/editorial/social-card/contract.json</code> の宣言に対して評価した結果。image 列の <code>content</code> / <code>fallback</code> は出力された <code>og:image</code> の URL そのものから判定しており、fallback の場合だけサイト既定カードを埋め込んでいる（リモート URL はこの環境では到達できないため、あえて埋め込まない）。</p>

  <h2>surface ごとの結果</h2>
  <table>
    <thead><tr><th style="width:60px">result</th><th style="width:200px">sample</th><th style="width:110px">policy</th><th style="width:80px">og:type</th><th style="width:80px">image</th><th>og:image</th><th style="width:180px">preview</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>findings</h2>
  <table>
    <thead><tr><th style="width:220px">rule</th><th style="width:160px">surface</th><th>message</th></tr></thead>
    <tbody>
${findingRows}
    </tbody>
  </table>

  <footer>my-web-2026 · Issue #421 · scripts/check-ogp-card.mjs / test/integration/ogp-card.test.ts</footer>
</body>
</html>
`;
}
