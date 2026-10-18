/**
 * Static secret-detection engine (Issue #475).
 *
 * Why this exists
 * ---------------
 * Issue #139 recorded a credential containment incident whose root cause
 * was a plaintext value reaching a transcript. GitHub Push Protection
 * (asynchronous, `quality/profile.yaml#security_gates.secret_scanning`)
 * is the only credential gate this repository had, and it is
 * asynchronous by design: it reviews pushes AFTER they land. A repository
 * that is public, that pins its whole delivery story on Cloudflare
 * Workers Builds, and whose runtime secret SoT is Infisical
 * (ADR-0015 §1) needs a *deterministic, pre-merge* gate on the same
 * obligation.
 *
 * What this module is
 * -------------------
 * A pure function from (file content, path) to a list of violations. No
 * I/O, no env reads, no network. The CLI wrapper
 * (`scripts/scan-secrets.mjs`) supplies the file set; the tests
 * (`scripts/scan-secrets.test.mjs`) supply fixtures. Keeping the
 * detector table here means the detectors are reviewable as DATA —
 * adding a provider means adding a row, not editing control flow.
 *
 * The disclosure invariant (AGENTS.md §4, "Agent invariant: no
 * value-listing of real secrets")
 * --------------------------------------------
 * A scanner hit is, by hypothesis, a credential. Echoing the matched
 * text into stdout would move the credential from a tracked file into a
 * CI log — which is a strictly worse leak, and the exact class of
 * operation AGENTS.md §4 forbids. Therefore every finding this module
 * produces carries only:
 *
 *   - the repo-relative path and line number
 *   - the detector id (a provider/shape name, never the value)
 *   - the matched value's LENGTH
 *   - a SHA-256 prefix of the matched value (8 hex chars)
 *
 * The fingerprint is what makes deduplication and "is this the same
 * value in two files?" answerable during rotation without a single
 * character of the value being rendered. See `describeMatch`.
 *
 * Rule design
 * -----------
 * Two tiers, because the same regex means different things in a
 * hand-written source file and in a minified bundle:
 *
 *   - `shape` rules (provider-prefixed tokens, PEM blocks, the
 *     `mk_home_` plaintext form, the Better Auth `1:<hex>` versioned
 *     form) are self-anchored: the prefix IS the assertion. They run in
 *     both source and bundle modes.
 *   - `assignment` rules (a secret-sounding NAME bound to a
 *     credential-shaped VALUE) are context rules. Minified output
 *     spells variables `t`, `n`, `e`, so an assignment rule there would
 *     be guessing. They run in source mode only.
 *
 * A credential-shaped VALUE is defined by `looksLikeCredentialValue`:
 * long enough, at least three character classes (so `mk_home_xyz`,
 * `abcdef123456`, and `redacted-by-infisical-fallback` are all NOT
 * credentials), not a placeholder, and not a code reference
 * (`env.FOO`, `process.env.FOO`, `${FOO}`).
 */

/** Text file extensions the scanner reads. Anything else is binary-by-policy. */
export const TEXT_EXTENSIONS = Object.freeze([
	'.cjs',
	'.css',
	'.csv',
	'.env',
	'.html',
	'.ini',
	'.js',
	'.json',
	'.jsonc',
	'.jsx',
	'.less',
	'.map',
	'.md',
	'.mdx',
	'.mjs',
	'.mts',
	'.patch',
	'.sql',
	'.toml',
	'.ts',
	'.tsx',
	'.txt',
	'.yaml',
	'.yml',
]);

/** Extensions always treated as binary regardless of content sniffing. */
export const BINARY_EXTENSIONS = Object.freeze([
	'.aac',
	'.avif',
	'.bin',
	'.br',
	'.eot',
	'.gif',
	'.gz',
	'.ico',
	'.jpeg',
	'.jpg',
	'.mov',
	'.mp3',
	'.mp4',
	'.otf',
	'.pdf',
	'.png',
	'.sqlite',
	'.ttf',
	'.wasm',
	'.webm',
	'.webp',
	'.woff',
	'.woff2',
	'.zip',
]);

/**
 * Filenames that must never be tracked. This is a PATH rule, not a
 * content rule: a `.dev.vars` holding nothing but placeholders is still
 * the file whose real sibling `.dev.vars` holds prod dev secrets, and
 * `.gitignore` already says the real one is untracked — so a tracked
 * copy is either a mistake or a leak, and both are red.
 *
 * `.example` / `.template` / `.dist` suffixes are the committed
 * documentation forms and are explicitly NOT matched.
 */
export const FORBIDDEN_TRACKED_PATHS = Object.freeze([
	{ pattern: /(^|\/)\.dev\.vars$/, reason: 'local Wrangler dev secret file (AGENTS.md §4)' },
	{
		pattern: /(^|\/)\.dev\.vars\.(?!example$|template$|dist$)[a-z0-9]+$/,
		reason: 'local Wrangler dev secret variant',
	},
	{ pattern: /(^|\/)\.env$/, reason: 'local env file (.env.example is the committed template)' },
	{
		pattern: /(^|\/)\.env\.(?!example$|template$|dist$|sample$)[a-z0-9]+$/,
		reason: 'local env file variant (.env.example is the template)',
	},
	{ pattern: /(^|\/)[^/]+\.pem$/, reason: 'PEM private key / certificate material' },
	{ pattern: /(^|\/)[^/]+\.key$/, reason: 'private key file' },
	{ pattern: /(^|\/)[^/]+\.p12$/, reason: 'PKCS#12 bundle (contains a private key)' },
	{ pattern: /(^|\/)[^/]+\.pfx$/, reason: 'PKCS#12 bundle (contains a private key)' },
	{
		pattern: /(^|\/)\.infisical\//,
		reason: 'Infisical bootstrap artefacts are gitignored operator state (AGENTS.md §4)',
	},
]);

/**
 * Detector table. `mode` is `both` | `source`.
 *
 * Each row is `{ id, mode, regex, group?, description }`. `group` names
 * the capture group holding the credential so a prefix/label inside the
 * match (e.g. `sk_live_`) does not get hashed into the fingerprint.
 */
export const DETECTORS = Object.freeze([
	{
		id: 'private-key-block',
		mode: 'both',
		regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
		description: 'PEM private key block. A committed key is a committed credential.',
	},
	{
		id: 'aws-access-key-id',
		mode: 'both',
		regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
		description: 'AWS access key id shape; R2 S3-compatible keys are issued in this format.',
	},
	{
		id: 'r2-s3-credential-assignment',
		mode: 'source',
		regex:
			/\b(?:aws|r2)_(?:access_key_id|secret_access_key)\s*[:=]\s*["']?([A-Za-z0-9/+=_-]{16,})/i,
		group: 1,
		description: 'R2 / S3 credential assignment (the Issue #475 "R2 key" case).',
	},
	{
		id: 'cloudflare-api-token',
		mode: 'both',
		regex: /\bv1\.0-[A-Za-z0-9_-]{20,}-[A-Za-z0-9_-]{20,}\b/,
		description: 'Cloudflare API token shape (the value `CLOUDFLARE_API_TOKEN` would carry).',
	},
	{
		id: 'github-token',
		mode: 'both',
		regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
		description: 'GitHub personal / app / refresh token.',
	},
	{
		id: 'slack-token',
		mode: 'both',
		regex: /\bxox[abpors]-[A-Za-z0-9-]{12,}/,
		description: 'Slack token.',
	},
	{
		id: 'stripe-secret-key',
		mode: 'both',
		regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
		description: 'Stripe secret / restricted key.',
	},
	{
		id: 'google-api-key',
		mode: 'both',
		regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
		description: 'Google API key.',
	},
	{
		id: 'jwt',
		mode: 'both',
		regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
		description: 'JSON Web Token (three base64url segments).',
	},
	{
		id: 'better-auth-versioned-secret',
		mode: 'both',
		regex: /(?:^|[^A-Za-z0-9_])([12]:[A-Za-z0-9_-]{32,})/,
		group: 1,
		description:
			'Better Auth versioned secret value (`1:<key>`) from the ADR-0015 §11.2 rotation contract.',
	},
	{
		id: 'home-consumer-api-key',
		mode: 'both',
		regex: /\b(mk_home_[A-Za-z]{32})\b/,
		group: 1,
		description:
			'Home consumer API key PLAINTEXT (the `mk_home_` + 32-char form from bootstrap-home-api-key.mjs).',
	},
	{
		id: 'secret-assignment',
		mode: 'source',
		regex:
			/(?:^|\n)[ \t]*[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]*[ \t]*[:=][ \t]*["']?([^\s"'#,;)\]}<>()$]{12,})/,
		group: 1,
		description:
			'Secret-sounding NAME bound to a credential-shaped VALUE (e.g. a committed `.dev.vars` line). ' +
			'Anchored at the start of a line on purpose: in JavaScript `NAME: value` is a property far more ' +
			'often than it is an env assignment.',
	},
]);

/**
 * Paths whose hits are known-safe, with the reason they are safe.
 *
 * An allowlist entry is an assertion about a specific file, reviewed
 * like code. It never suppresses a whole class of detector silently:
 * `detector` narrows the waiver to one detector id when a file needs
 * only that one. Anything not listed here is a failure.
 */
export const ALLOWLIST = Object.freeze([
	{
		path: 'scripts/rotate-home-api-key.test.mjs',
		detector: 'home-consumer-api-key',
		reason:
			'Rotation unit tests assert the SHA-256 hash of synthetic plaintexts. The values are fixed ' +
			'alphabetic strings chosen so the hash is stable; they grant nothing and are not issued by ' +
			'bootstrap-home-api-key.mjs.',
	},
	{
		path: 'scripts/bootstrap-home-api-key.test.mjs',
		detector: 'home-consumer-api-key',
		reason:
			'Bootstrap unit tests exercise provisioning with synthetic plaintexts. No provisioned key ' +
			'ever came from this file.',
	},
	{
		path: 'scripts/scan-secrets.test.mjs',
		reason:
			'The scanner own fixtures. They must CONTAIN credential shapes for the detector tests to ' +
			'mean anything; every value is synthetic and generated in-test, and the file is the reason the ' +
			'gate can be proven red at all.',
	},
	{
		path: 'scripts/check-sbom.test.mjs',
		detector: 'private-key-block',
		reason:
			'The SBOM gate own detector fixtures (Issue #471). A gate that asserts it REJECTS credential ' +
			'shapes must hold those shapes; they are the documented sample strings, not issued values.',
	},
	{
		path: 'scripts/check-sbom.test.mjs',
		detector: 'github-token',
		reason:
			'Same SBOM detector fixtures (Issue #471): the value under test is the literal alphabet ' +
			'`abcdefghijklmnopqrstuvwxyz0123456789`, which is a shape sample by construction.',
	},
	{
		path: 'scripts/check-sbom.test.mjs',
		detector: 'jwt',
		reason:
			'Same SBOM detector fixtures (Issue #471): the RFC 7519 example token, present precisely ' +
			'because the SBOM gate asserts it is rejected.',
	},
	{
		path: 'src/logging/redact.test.ts',
		detector: 'jwt',
		reason:
			'The log-redaction masking test (Issue #467). Asserting that a JWT is masked REQUIRES an ' +
			'unmasked JWT in the fixture; it is the header/payload/signature of the RFC 7519 example.',
	},
	{
		path: 'scripts/_secret-scan.mjs',
		reason: 'The detector table itself: regex sources are shapes, not values.',
	},
	{
		path: 'scripts/scan-secrets.mjs',
		reason:
			'The CLI wrapper: its self-test fixtures must contain credential shapes to be a fixture.',
	},
	{
		path: 'scripts/shoot-secret-scan-report.mjs',
		reason:
			'The verification-artefact generator. It runs the self-test and screenshots its report; it ' +
			'holds no value of its own.',
	},
]);

/** Placeholder / documentation markers that disqualify a value. */
const PLACEHOLDER_RE =
	/(?:redacted|placeholder|example|dummy|fake|stub|sample|not-?a-?real|changeme|change-me|replace-?me|insert-?me|your[_-]|todo|xxxx+|\.\.\.|<[^>]+>)/i;

/** Values that are code references, not literals. */
const CODE_REFERENCE_RE =
	/^(?:process\.env|env\.|c\.env|import\.meta\.env|require\(|bun\.|Deno\.|os\.environ)/;

/**
 * Credential prefixes that assert their own class. A value carrying one
 * of these IS the credential; no entropy heuristic is needed.
 */
const PROVIDER_PREFIX_RE =
	/mk_home_|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|gh[pousr]_|github_pat_|sk_(?:live|test)_|rk_(?:live|test)_|AIza|xox[abpors]-|v1\.0-/;

/** Better Auth / S3 credential encodings with no alphabet ambiguity. */
const HEX_CREDENTIAL_RE = /^[0-9a-f]{32,}$/i;
const BASE64_CREDENTIAL_RE = /^[A-Za-z0-9+/=_-]{32,}$/;

/** Better Auth versioned form with a full-length payload (`1:<key>`). */
const VERSIONED_SECRET_RE = /^[12]:[A-Za-z0-9+/=_-]{32,}$/;

/**
 * A hyphen followed by three or more lowercase letters is an English
 * word, not base64 noise. Test fixtures and marker strings
 * (`this-is-a-deliberately-unique-marker-XYZ-9876`) live in this
 * repository by design, and a credential gate that cries wolf on them
 * gets switched off.
 */
const HYPHENATED_WORD_RE = /-[a-z]{3,}/;

function characterClasses(value) {
	const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
	return classes.reduce((count, test) => count + (test.test(value) ? 1 : 0), 0);
}

/**
 * Is this captured value a credential rather than an identifier, a
 * placeholder, or a low-entropy fixture?
 *
 * This is the single place the `secret-assignment` detector decides, so
 * the decision is unit-testable rather than distributed across regex
 * escapes. It is a SHAPE test, not an entropy oracle: this repository's
 * credentials are hex digests, base64url material, or provider-prefixed
 * tokens, and every one of those is decidable without statistics. What
 * a shape test cannot see (an arbitrary low-entropy string that was
 * still a real credential) is covered by the asynchronous GitHub Push
 * Protection gate, which is where that judgement belongs.
 */
export function looksLikeCredentialValue(value) {
	if (!value || value.length < 12 || value.length > 512) return false;
	if (PLACEHOLDER_RE.test(value)) return false;
	if (CODE_REFERENCE_RE.test(value)) return false;
	if (/[({]/.test(value)) return false;
	// `FOO_BAR` is an identifier, not a value; `InfsclSyntheticFixtureValue000`
	// is a value even though it is alphanumeric, so the identifier check is
	// deliberately narrow (SCREAMING_SNAKE only) rather than "starts with a
	// letter".
	if (/^[A-Z][A-Z0-9_]*$/.test(value)) return false;
	if (/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/i.test(value)) return false;
	// Explicit shapes first: a credential prefix asserts its own class, so it
	// does not need the class-count discriminator below. `1:<48 zeros>` has
	// two character classes and is still the Better Auth value it claims to be.
	if (PROVIDER_PREFIX_RE.test(value)) return true;
	if (VERSIONED_SECRET_RE.test(value)) return true;
	// Hex is unambiguous on its own — `'a'.repeat(64)` has ONE character
	// class and is still a credential digest — so it is decided before the
	// class-count discriminator below.
	if (HEX_CREDENTIAL_RE.test(value)) return true;
	// Three classes is the discriminator for the ambiguous encodings.
	// Two-class strings (`mk_home_xyz`, `abcdef123456`, `redacted-by-infisical`)
	// are the shape of a fixture or a marker, and the repository is full of
	// them by design.
	if (characterClasses(value) < 3) return false;
	if (BASE64_CREDENTIAL_RE.test(value) && !HYPHENATED_WORD_RE.test(value)) return true;
	return false;
}

/** SHA-256 fingerprint prefix. `node:crypto`, imported lazily for tests. */
async function fingerprint(value) {
	const { createHash } = await import('node:crypto');
	return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/** Line number (1-based) of `index` within `content`. */
function lineAt(content, index) {
	let line = 1;
	for (let i = 0; i < index && i < content.length; i++) {
		if (content.charCodeAt(i) === 10) line++;
	}
	return line;
}

function allowlistEntryFor(path, detectorId) {
	return ALLOWLIST.find(
		(entry) =>
			entry.path === path && (entry.detector === undefined || entry.detector === detectorId),
	);
}

/** Repo-relative POSIX path (the allowlist is written in that form). */
function toPosix(repoRelative) {
	return repoRelative.split('\\').join('/');
}

/**
 * Should this path be read at all?
 *
 * Extension decides first (a `.png` is never scanned as text), then a
 * NUL-byte sniff catches extensionless binaries.
 */
export function isScannableText(path, buffer) {
	const lower = path.toLowerCase();
	if (BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false;
	if (lower.includes('/assets/files/') && /\.(?:woff2?|ttf|otf|pdf)$/i.test(lower)) return false;
	const sniffed = buffer.subarray(0, 4096);
	if (sniffed.includes(0)) return false;
	if (!TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false;
	return true;
}

/**
 * Scan one file's content.
 *
 * @param {string} repoRelative POSIX repo-relative path (used for reporting + allowlist)
 * @param {string|Buffer} content raw file bytes
 * @param {{ mode?: 'source'|'bundle', skipAllowlist?: boolean }} [options]
 * @returns {Promise<Array<object>>} violations, in file order
 */
export async function scanContent(repoRelative, content, options = {}) {
	const mode = options.mode ?? 'source';
	const path = toPosix(repoRelative);
	const violations = [];

	for (const rule of FORBIDDEN_TRACKED_PATHS) {
		if (!rule.pattern.test(path)) continue;
		if (!options.skipAllowlist && allowlistEntryFor(path, 'forbidden-path')) continue;
		violations.push({
			path,
			line: 0,
			detector: 'forbidden-path',
			length: 0,
			fingerprint: '-',
			description: rule.reason,
			allowlistReason: null,
		});
	}

	const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
	if (!isScannableText(path, buffer)) return violations;

	const text = buffer.toString('utf8');
	const seen = new Set();
	for (const rule of DETECTORS) {
		if (rule.mode !== 'both' && rule.mode !== mode) continue;
		const regex = new RegExp(
			rule.regex.source,
			rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`,
		);
		let match = regex.exec(text);
		while (match !== null) {
			const value = rule.group ? (match[rule.group] ?? '') : match[0];
			const detectorId = rule.id;
			const waived = !options.skipAllowlist ? allowlistEntryFor(path, detectorId) : undefined;
			const dedupeKey = `${detectorId}:${match.index}`;
			if (!seen.has(dedupeKey)) {
				seen.add(dedupeKey);
				const acceptable =
					detectorId === 'secret-assignment' ? looksLikeCredentialValue(value) : true;
				if (acceptable) {
					violations.push({
						path,
						line: lineAt(text, match.index),
						detector: detectorId,
						length: value.length,
						fingerprint: await fingerprint(value),
						description: rule.description,
						allowlistReason: waived?.reason ?? null,
					});
				}
			}
			if (match[0].length === 0) {
				// A ZERO-LENGTH match does not advance `lastIndex`, so
				// `exec` would return the same position forever. No shipped
				// detector can match empty — but an infinite loop inside a CI
				// gate is a denial of service on every PR, so the guard
				// belongs here rather than in a comment saying "don't do
				// that". (It also made the self-test hang when a test
				// temporarily weakened a detector to a never-matching
				// lookahead.)
				regex.lastIndex += 1;
			}
			match = regex.exec(text);
		}
	}

	return violations.sort((a, b) => a.line - b.line || a.detector.localeCompare(b.detector));
}

/**
 * Split violations into blocking failures and waived findings.
 *
 * A waived finding is still REPORTED (count + reason) so the waiver set
 * stays visible; it just does not turn the gate red.
 */
export function partition(violations) {
	const failures = [];
	const waived = [];
	for (const violation of violations) {
		if (violation.allowlistReason) waived.push(violation);
		else failures.push(violation);
	}
	return { failures, waived };
}

/**
 * Human/JSON-facing finding line. Deliberately omits the value: see the
 * module header's disclosure invariant.
 */
export function describeMatch(violation) {
	const where = violation.line > 0 ? `${violation.path}:${violation.line}` : violation.path;
	return `${where} [${violation.detector}] len=${violation.length} sha256:${violation.fingerprint} — ${violation.description}`;
}
/** Escape the five XML-significant characters. Report text is never raw HTML. */
export function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * Self-contained HTML report.
 *
 * Self-contained is a requirement, not a style choice: the report is the
 * screenshot artefact for this Issue, so it must render identically in a
 * headless browser with no network and no repository files. No external
 * stylesheet, no font, no script.
 *
 * Findings are rendered through `describeMatch`, i.e. path / line /
 * detector / length / fingerprint. No value is rendered, here or
 * anywhere else in this obligation.
 */
export function renderHtmlReport(report) {
	const verdict = report.failures.length === 0 ? 'PASS' : 'FAIL';
	const rows = report.failures
		.map(
			(failure) => `        <tr>
          <td class="mono">${escapeHtml(failure.path)}</td>
          <td class="mono num">${failure.line > 0 ? failure.line : '—'}</td>
          <td class="mono">${escapeHtml(failure.detector)}</td>
          <td class="mono num">${failure.length}</td>
          <td class="mono">sha256:${escapeHtml(failure.fingerprint)}</td>
          <td>${escapeHtml(failure.description)}</td>
        </tr>`,
		)
		.join('\n');
	const waivedRows = report.waived
		.map(
			(waiver) => `        <tr>
          <td class="mono">${escapeHtml(waiver.path)}</td>
          <td class="mono">${escapeHtml(waiver.detector)}</td>
          <td>${escapeHtml(waiver.allowlistReason ?? '')}</td>
        </tr>`,
		)
		.join('\n');
	const emptyRow = '<tr><td colspan="6" class="empty">no findings</td></tr>';
	const emptyWaiver = '<tr><td colspan="3" class="empty">no waivers</td></tr>';

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Supply-chain secret scan — ${escapeHtml(verdict)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        padding: 40px 48px 56px;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        line-height: 1.55;
        color: #14161a;
        background: #f6f6f4;
      }
      h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
      h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.09em; margin: 34px 0 10px; color: #55595f; }
      p { margin: 6px 0; max-width: 78ch; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
      .num { text-align: right; }
      .verdict {
        display: inline-block;
        padding: 6px 14px;
        border-radius: 999px;
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.06em;
      }
      .verdict.pass { background: #1c7c4a; color: #fff; }
      .verdict.fail { background: #b3261e; color: #fff; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 18px; margin: 18px 0 0; }
      dt { color: #55595f; font-size: 13px; }
      dd { margin: 0; font-size: 13px; }
      table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e2e2de; }
      th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #ececE8; vertical-align: top; }
      th { background: #f0f0ec; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #55595f; }
      tr:last-child td { border-bottom: none; }
      td.empty { color: #7a7f86; font-style: italic; }
      ol { padding-left: 20px; }
      li { margin: 5px 0; }
      .note {
        margin-top: 34px;
        padding: 12px 14px;
        border-left: 3px solid #b3261e;
        background: #fff;
        font-size: 13px;
      }
      footer { margin-top: 30px; font-size: 12px; color: #6b7076; }
    </style>
  </head>
  <body>
    <h1>Supply-chain secret scan</h1>
    <p><span class="verdict ${verdict.toLowerCase()}">${verdict}</span></p>
    <dl>
      <dt>Target</dt><dd class="mono">${escapeHtml(report.target)}</dd>
      <dt>Mode</dt><dd class="mono">${escapeHtml(report.mode)}</dd>
      <dt>Generated</dt><dd class="mono">${escapeHtml(report.generatedAt)}</dd>
      <dt>Files scanned</dt><dd class="mono">${report.scannedFiles}</dd>
      <dt>Blocking findings</dt><dd class="mono">${report.failures.length}</dd>
      <dt>Waived findings</dt><dd class="mono">${report.waived.length}</dd>
    </dl>

    <h2>Findings</h2>
    <table>
      <thead>
        <tr><th>Path</th><th>Line</th><th>Detector</th><th>Len</th><th>Fingerprint</th><th>Why it is a finding</th></tr>
      </thead>
      <tbody>
${report.failures.length > 0 ? rows : emptyRow}
      </tbody>
    </table>

    <h2>Waivers</h2>
    <table>
      <thead><tr><th>Path</th><th>Detector</th><th>Reason the waiver is safe</th></tr></thead>
      <tbody>
${report.waived.length > 0 ? waivedRows : emptyWaiver}
      </tbody>
    </table>

    <h2>Remediation</h2>
    <ol>
      <li>Do not paste the value anywhere. Findings render path, line, detector, length, and a SHA-256 prefix only.</li>
      <li>Treat the value as compromised: revoke / rotate it at the issuer first, then remove it from the tree.</li>
      <li>Purge the value from git history (rewrite + force-push the ticket branch), or open a leak report if the history is already public.</li>
      <li>Re-run <span class="mono">pnpm run secret:scan</span>; the gate must return to PASS.</li>
      <li>If the finding is a false positive, waive it in <span class="mono">scripts/_secret-scan.mjs</span> <span class="mono">ALLOWLIST</span> with a reason, never by weakening a detector.</li>
    </ol>

    <p class="note"><strong>No secret value is rendered by this report.</strong> ${
			report.disclosureNote ??
			'Every row is a status-only observation: path, line, detector id, value length, SHA-256 prefix.'
		}</p>

    <footer>Generated by <span class="mono">scripts/scan-secrets.mjs</span> (Issue #475). ${escapeHtml(
			report.footer ?? '',
		)}</footer>
  </body>
</html>
`;
}
