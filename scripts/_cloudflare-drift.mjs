/**
 * Cloudflare configuration drift policy (Issue #480).
 *
 * What this module decides
 * ------------------------
 * Since Issue #247 there is ONE Worker configuration
 * (`cloudflare.config.ts`) whose `ConfigContext.mode` chooses the
 * development or the production surface. That removed the duplicated
 * `wrangler.jsonc` / `wrangler.production.jsonc` pair, and with it the
 * *mechanical* half of configuration drift — but not the question the
 * duplication used to answer: "is the surface that ships to production
 * still the surface we meant to ship?"
 *
 * The claim this module enforces is a single one:
 *
 *   > the production Worker surface, the development Worker surface, the
 *   > production build / deploy commands, and the static-asset header
 *   > surface all still match the RECORDED production contract, and the
 *   > only differences between the two modes are the ones the record
 *   > declares.
 *
 * One differing item is one finding, and one finding is a red gate.
 * There is no tolerance, no percentage, and no "close enough" band.
 *
 * Why a record instead of comparing the config to itself
 * ------------------------------------------------------
 * A check that only asserts "the config agrees with itself" proves
 * nothing: editing `cloudflare.config.ts` moves the expectation and the
 * observation together, so the drift goes green again in the same commit.
 * The expectation therefore lives in data —
 * `quality/cloudflare-config-drift.json` — which is reviewable as a
 * configuration decision and diffable as a change.
 *
 * Status-only output (AGENTS.md §4)
 * ---------------------------------
 * Nothing here reads a credential, and two rules keep it that way:
 *
 *   1. A `secret` binding is normalized to its NAME. Every other field of
 *      a secret binding is dropped at normalization time, not at print
 *      time, so a value cannot reach a finding even if `cf/config` starts
 *      carrying one.
 *   2. A text binding value that DIFFERS from the record is never printed.
 *      An unexpected value is exactly where a credential would hide, so
 *      the finding reports `<redacted len=N>` and nothing else. A value
 *      that matches the record is already committed in this repository, so
 *      printing it adds no exposure and keeps the report readable.
 *
 * Non-secret identifiers (account id, database id, rate-limit
 * namespace) ARE printed on mismatch: they are public configuration
 * committed in `scripts/_cloudflare-identity.mjs`, they are what an
 * operator needs in order to act, and they are shape-ambiguous with
 * credentials by construction (a 32-hex id), so the leak guard is scoped
 * to text binding values instead of the whole report.
 *
 * What this module deliberately does NOT claim
 * ---------------------------------------------
 *   - The built artifact. `.cloudflare/output/v0/**` is the deployed
 *     truth and `scripts/check-cloudflare-contract.mjs --build` already
 *     asserts it. This gate owns the SOURCE side: the declaration, its
 *     mode behaviour, and the commands that consume it.
 *   - Header VALUES and header combination semantics. That is
 *     `scripts/check-security-headers.mjs` (Issue #449). This gate only
 *     asserts that the production static-asset header surface still
 *     COVERS the namespaces production serves — a surface that is inert
 *     under `vite dev` and therefore loses coverage silently.
 *   - The Cloudflare Dashboard configuration itself (Workers Builds
 *     variables, API token permissions). No local tool can read it; the
 *     repository can only prove that the commands it names still exist.
 */

/** Verdicts, kept distinct so "unknown" can never read as "fine". */
export const DRIFT_VERDICT = Object.freeze({
	match: 'MATCH',
	drift: 'DRIFT',
	undecidable: 'UNDECIDABLE',
});

/**
 * The dimensions the Issue names, in report order. Each finding carries
 * exactly one of them so a report line is attributable.
 */
export const DRIFT_DIMENSIONS = Object.freeze([
	'bindings',
	'routes',
	'headers',
	'build_commands',
	'mode',
]);

/** Finding kinds. `undeclared_mode_difference` is the dev/prod one. */
export const FINDING_KIND = Object.freeze({
	missing: 'missing',
	unexpected: 'unexpected',
	mismatch: 'mismatch',
	type_mismatch: 'type_mismatch',
	undeclared_mode_difference: 'undeclared_mode_difference',
	undeclared_mode_field_difference: 'undeclared_mode_field_difference',
	route_mismatch: 'route_mismatch',
	header_rule_missing: 'header_rule_missing',
	header_value_mismatch: 'header_value_mismatch',
	header_rule_uncovered: 'header_rule_uncovered',
	script_missing: 'script_missing',
	runbook_mismatch: 'runbook_mismatch',
});

/** Reasons the gate refuses to decide (fail-closed, exit 2). */
export const UNDECIDABLE_REASON = Object.freeze({
	recordUnreadable: 'record_unreadable',
	surfaceUnreadable: 'surface_unreadable',
	scriptsUnreadable: 'scripts_unreadable',
	runbookUnreadable: 'runbook_unreadable',
	headersUnreadable: 'headers_file_unreadable',
	policyUnreadable: 'header_policy_unreadable',
	inputUnreadable: 'input_unreadable',
	recordIncomplete: 'record_incomplete',
});

/**
 * Fields copied out of a `cf/config` binding.
 *
 * An allowlist, not a denylist: a binding shape added upstream must be
 * reviewed here before the gate can print it.
 */
const BINDING_FIELDS = Object.freeze(['value', 'name', 'id', 'namespace', 'simple']);

/** Production-surface scalar fields compared against the record. */
const SURFACE_FIELDS = Object.freeze([
	'accountId',
	'name',
	'compatibilityDate',
	'entrypoint',
	'observability',
]);

/**
 * Reduce one `cf/config` binding to the fields the gate may report.
 *
 * A secret binding keeps its TYPE and nothing else. This is the load-
 * bearing line of the status-only contract: the reduction happens here,
 * so no downstream function — diff, report, screenshot — can see a value
 * that does not exist.
 */
export function normalizeBinding(binding) {
	const type = typeof binding?.type === 'string' ? binding.type : null;
	if (type === null) return { type: 'unknown' };
	if (type === 'secret') return { type };
	const normalized = { type };
	for (const field of BINDING_FIELDS) {
		if (binding[field] === undefined) continue;
		normalized[field] = structuredClone(binding[field]);
	}
	return normalized;
}

/**
 * Resolve a `cf/config` export for one mode and normalize it.
 *
 * Accepts either the whole `defineConfig` result (`{accountId, worker}`)
 * or an already-resolved worker object, so a fixture can be normalized
 * without evaluating the real configuration.
 *
 * Returns `{ error }` when the shape is not something this gate can
 * judge — the caller turns that into UNDECIDABLE, never into a pass.
 */
export function normalizeWorkerSurface({ mode, config }) {
	if (!config || typeof config !== 'object') return { error: 'config_not_object' };
	const worker = typeof config.worker === 'function' ? config.worker({ mode }) : config.worker;
	// A worker object with no name is not a surface this gate can judge:
	// comparing it would produce findings for everything at once, which
	// reads as drift rather than as "the configuration did not resolve".
	if (!worker || typeof worker !== 'object' || typeof worker.name !== 'string') {
		return { error: 'worker_not_object' };
	}

	const env = worker.env && typeof worker.env === 'object' ? worker.env : {};
	const bindings = {};
	for (const name of Object.keys(env).sort()) bindings[name] = normalizeBinding(env[name]);

	return {
		mode,
		accountId: typeof config.accountId === 'string' ? config.accountId : null,
		name: typeof worker.name === 'string' ? worker.name : null,
		compatibilityDate:
			typeof worker.compatibilityDate === 'string' ? worker.compatibilityDate : null,
		compatibilityFlags: [...(worker.compatibilityFlags ?? [])].sort(),
		entrypoint: typeof worker.entrypoint === 'string' ? worker.entrypoint : null,
		observability: worker.observability?.enabled === true,
		// `domains` is the route surface (ADR-0014): empty in development
		// so `vite dev` can never inherit the production hostname.
		routes: [...(worker.domains ?? [])].sort(),
		bindings,
	};
}

/** Stable stringify for the small object fields (`simple: {limit,period}`). */
function stable(value) {
	return JSON.stringify(value ?? null);
}

function sameScalar(a, b) {
	return a === b;
}

function sameList(a, b) {
	const left = [...(a ?? [])].sort();
	const right = [...(b ?? [])].sort();
	return left.length === right.length && left.every((value, i) => value === right[i]);
}

/**
 * Printable rendering of an observed token.
 *
 * `sensitive` values are ALWAYS redacted — the raw value never enters a
 * finding, so this is a second, independent barrier rather than the only
 * one.
 */
export function renderToken(value, { sensitive = false } = {}) {
	if (value === undefined || value === null) return '-';
	if (sensitive) return `<redacted len=${String(value).length}>`;
	if (typeof value === 'string') return value;
	return stable(value);
}

/**
 * Does this finding's observed token carry a VALUE that could be a
 * credential?
 *
 * Only a text binding's `value` can. The rule is stated on the PATH
 * rather than passed in as a flag, so a new comparison site cannot
 * forget it.
 */
export function isSensitivePath(path) {
	return typeof path === 'string' && path.endsWith('.value');
}

/**
 * Does this finding's observed token carry a non-secret IDENTIFIER?
 *
 * Account id, D1 database id, R2 bucket name and rate-limit namespace are
 * printed on mismatch on purpose: an operator has to be able to read WHICH
 * resource drifted. They are shape-ambiguous with credentials (a 32-hex
 * id is exactly a credential digest's shape), so the leak guard is told
 * about them by path instead of being switched off.
 */
export function isIdentifierPath(path) {
	if (typeof path !== 'string') return false;
	if (/^production\.(accountId|name|entrypoint|compatibilityDate|compatibilityFlags)$/.test(path)) {
		return true;
	}
	if (/^bindings\.[A-Za-z0-9_]+\.(id|namespace|name)$/.test(path)) return true;
	return /^(production|development)\.routes/.test(path) || /^mode\./.test(path);
}

function finding(dimension, path, kind, expected, actual, options = {}) {
	return {
		dimension,
		path,
		kind,
		expected: renderToken(expected),
		actual: renderToken(actual, { sensitive: options.sensitive ?? isSensitivePath(path) }),
	};
}

/**
 * The mechanical half of the status-only contract.
 *
 * A finding may carry a credential-shaped token only where the token is a
 * redacted value, a non-secret identifier, or text this gate prints as a
 * fixed label (`pnpm run <script>`, a header name, a path pattern).
 * Anything else fails closed rather than reaching a transcript.
 */
export function assertStatusOnly(result, { isCredential = null } = {}) {
	// The shape test is injected so the gate reuses the repository's own
	// detector (`looksLikeCredentialValue`) instead of a second, weaker
	// regex living here.
	const shapeTest =
		typeof isCredential === 'function'
			? isCredential
			: (token) => typeof token === 'string' && /^[a-f0-9]{32,}$/i.test(token);
	for (const item of result.findings) {
		if (isSensitivePath(item.path) || isIdentifierPath(item.path)) continue;
		for (const [side, token] of [
			['expected', item.expected],
			['actual', item.actual],
		]) {
			if (!shapeTest(token)) continue;
			throw new Error(
				`refusing to emit a credential-shaped token (${item.path}.${side}); the report must stay status-only`,
			);
		}
	}
}

/**
 * Production surface vs. the record: bindings, routes, and the scalars
 * that decide what Cloudflare will run.
 */
export function diffProductionSurface(expected, actual) {
	const findings = [];
	if (!expected || typeof expected !== 'object') {
		return [
			finding(
				'bindings',
				'production',
				FINDING_KIND.missing,
				'a recorded production surface',
				null,
			),
		];
	}

	for (const field of SURFACE_FIELDS) {
		const want = expected[field];
		const have = actual?.[field];
		const same = Array.isArray(want) ? sameList(want, have) : sameScalar(want, have);
		if (!same)
			findings.push(finding('bindings', `production.${field}`, FINDING_KIND.mismatch, want, have));
	}

	const wantFlags = [...(expected.compatibilityFlags ?? [])].sort();
	if (!sameList(wantFlags, actual?.compatibilityFlags)) {
		findings.push(
			finding(
				'bindings',
				'production.compatibilityFlags',
				FINDING_KIND.mismatch,
				wantFlags,
				actual?.compatibilityFlags,
			),
		);
	}

	const wantRoutes = [...(expected.routes ?? [])].sort();
	if (!sameList(wantRoutes, actual?.routes)) {
		findings.push(
			finding(
				'routes',
				'production.routes',
				FINDING_KIND.route_mismatch,
				wantRoutes,
				actual?.routes,
			),
		);
	}

	const wantBindings = expected.bindings ?? {};
	const haveBindings = actual?.bindings ?? {};
	for (const name of Object.keys(wantBindings).sort()) {
		const want = wantBindings[name];
		const have = haveBindings[name];
		if (!have) {
			findings.push(
				finding('bindings', `bindings.${name}`, FINDING_KIND.missing, want?.type ?? null, null),
			);
			continue;
		}
		if (want.type !== have.type) {
			findings.push(
				finding('bindings', `bindings.${name}`, FINDING_KIND.type_mismatch, want.type, have.type),
			);
			continue;
		}
		for (const field of BINDING_FIELDS) {
			if (want[field] === undefined) continue;
			if (stable(want[field]) === stable(have[field])) continue;
			// A text VALUE is the only field that can carry a credential,
			// and an unexpected one is the only place it could hide.
			findings.push(
				finding(
					'bindings',
					`bindings.${name}.${field}`,
					FINDING_KIND.mismatch,
					want[field],
					have[field],
					{
						sensitive: field === 'value',
					},
				),
			);
		}
	}
	for (const name of Object.keys(haveBindings).sort()) {
		if (name in wantBindings) continue;
		findings.push(
			finding(
				'bindings',
				`bindings.${name}`,
				FINDING_KIND.unexpected,
				null,
				haveBindings[name]?.type ?? null,
			),
		);
	}
	return findings;
}

/**
 * Development vs. production: only the differences the record declares.
 *
 * This is the half a single-file configuration cannot check by itself —
 * before Issue #247 the two `wrangler*.jsonc` files simply had to be
 * kept in step, and nothing compared them. A mode-conditional branch in
 * `cloudflare.config.ts` can now add, drop, or change a binding without
 * any file-level diff showing it, so the declaration of intent has to be
 * data too (`development.mode_only_bindings`).
 */
export function diffModeSurfaces(record, production, development) {
	const findings = [];
	const productionOnly = [...(record?.development?.mode_only_bindings?.production_only ?? [])];
	const developmentOnly = [...(record?.development?.mode_only_bindings?.development_only ?? [])];
	const declared = new Set([...productionOnly, ...developmentOnly]);

	if (!sameList([...(record?.development?.routes ?? [])], development?.routes)) {
		findings.push(
			finding(
				'routes',
				'development.routes',
				FINDING_KIND.route_mismatch,
				record?.development?.routes ?? [],
				development?.routes,
			),
		);
	}

	for (const name of productionOnly) {
		// A name the record also lists under `production.bindings` is
		// already reported by the bindings dimension when it is absent, so
		// reporting it here too would turn one missing item into two
		// findings and make a count useless as a repair checklist.
		if (!production?.bindings?.[name] && !record?.production?.bindings?.[name]) {
			findings.push(
				finding('mode', `mode.production_only.${name}`, FINDING_KIND.missing, name, null),
			);
		}
		if (development?.bindings?.[name]) {
			findings.push(
				finding(
					'mode',
					`mode.development_only_absent.${name}`,
					FINDING_KIND.unexpected,
					null,
					name,
				),
			);
		}
	}
	for (const name of developmentOnly) {
		// A development-only binding is opt-in (`.dev.vars` may not set
		// it), so its absence in development is not a finding; its
		// presence in production is.
		if (production?.bindings?.[name]) {
			findings.push(
				finding('mode', `mode.production_only.${name}`, FINDING_KIND.unexpected, null, name),
			);
		}
	}

	for (const name of Object.keys(production?.bindings ?? {}).sort()) {
		if (declared.has(name)) continue;
		if (!development?.bindings?.[name]) {
			findings.push(
				finding(
					'mode',
					`mode.undeclared.${name}`,
					FINDING_KIND.undeclared_mode_difference,
					null,
					name,
				),
			);
			continue;
		}
		if (stable(production.bindings[name]) !== stable(development.bindings[name])) {
			findings.push(
				finding(
					'mode',
					`mode.field_difference.${name}`,
					FINDING_KIND.undeclared_mode_field_difference,
					null,
					name,
				),
			);
		}
	}
	for (const name of Object.keys(development?.bindings ?? {}).sort()) {
		if (declared.has(name)) continue;
		if (!production?.bindings?.[name]) {
			findings.push(
				finding(
					'mode',
					`mode.undeclared.${name}`,
					FINDING_KIND.undeclared_mode_difference,
					null,
					name,
				),
			);
		}
	}
	return findings;
}

/** `pnpm run <name>` -> `<name>`; anything else is a finding, not a guess. */
function scriptNameOf(command) {
	const match = /^pnpm run ([A-Za-z0-9:._-]+)$/.exec(String(command ?? '').trim());
	return match ? match[1] : null;
}

/**
 * The build / deploy commands the Workers Builds dashboard runs.
 *
 * No local tool can read that dashboard, so what this asserts is the half
 * the repository owns: the commands the runbook declares still name a
 * real `package.json` script, and the runbook still says what the record
 * says. A renamed or deleted script would otherwise leave production
 * building with a command that no longer exists.
 */
export function diffBuildCommands(record, scripts, runbookText) {
	const findings = [];
	const commands = record?.build_commands ?? {};
	for (const key of Object.keys(commands).sort()) {
		// `$comment` (and any other `$`-prefixed key) is documentation, not
		// a command. Reading it as one would make a comment a finding.
		if (key.startsWith('$')) continue;
		const command = commands[key];
		const name = scriptNameOf(command);
		if (name === null) {
			findings.push(
				finding(
					'build_commands',
					`build_commands.${key}`,
					FINDING_KIND.mismatch,
					'pnpm run <script>',
					command,
				),
			);
			continue;
		}
		if (typeof scripts?.[name] !== 'string') {
			findings.push(
				finding(
					'build_commands',
					`build_commands.${key}`,
					FINDING_KIND.script_missing,
					command,
					null,
				),
			);
			continue;
		}
		// The runbook is the human-facing mirror of the dashboard setting;
		// a record the runbook does not mention is drift nobody reads.
		const row = runbookRowFor(runbookText, key);
		if (row === null) {
			findings.push(
				finding(
					'build_commands',
					`build_commands.${key}.runbook`,
					FINDING_KIND.missing,
					command,
					null,
				),
			);
		} else if (row !== command) {
			findings.push(
				finding(
					'build_commands',
					`build_commands.${key}.runbook`,
					FINDING_KIND.runbook_mismatch,
					command,
					row,
				),
			);
		}
	}
	return findings;
}

/**
 * Read one `| Build command | \`pnpm run …\` |` style table row.
 *
 * Keyed on the row LABEL, not the row position, so inserting a row into
 * the runbook table cannot silently re-point this check at another field.
 */
export function runbookRowFor(runbookText, key) {
	const labels = {
		build: 'build command',
		deploy: 'deploy command',
		production_branch: 'production branch',
	};
	const label = labels[key];
	if (label === undefined || typeof runbookText !== 'string') return null;
	for (const line of runbookText.split('\n')) {
		const cells = line
			.split('|')
			.map((cell) => cell.trim())
			.filter((cell) => cell.length > 0);
		if (cells.length < 2) continue;
		if (cells[0].toLowerCase() !== label) continue;
		const value = cells[1].replace(/`/g, '').trim();
		return value === '' ? null : value;
	}
	return null;
}

/**
 * The static-asset header surface that ships to production.
 *
 * `public/_headers` is applied by Cloudflare Static Assets and is inert
 * under `vite dev`, so nothing in the development surface can notice that
 * a rule was dropped, a namespace was left uncovered, or the nosniff
 * baseline was edited away. `scripts/check-security-headers.mjs` owns
 * VALUE and combination semantics; this owns COVERAGE and existence.
 */
export function diffStaticAssetHeaders(record, rules, policy) {
	const findings = [];
	const config = record?.static_asset_headers ?? {};
	if (!Array.isArray(rules) || rules.length === 0) {
		return [
			finding(
				'headers',
				'headers.rules',
				FINDING_KIND.header_rule_missing,
				config.file ?? 'public/_headers',
				null,
			),
		];
	}

	for (const required of config.required_paths ?? []) {
		const covered = rules.some((rule) => rule.path === required);
		if (!covered) {
			findings.push(
				finding(
					'headers',
					`headers.coverage.${required}`,
					FINDING_KIND.header_rule_uncovered,
					required,
					null,
				),
			);
		}
	}

	const baselineRule = rules.find((rule) => rule.path === config.baseline_rule);
	const baselineHeader = config.baseline_header;
	// The header NAME (`x-content-type-options`, as `_headers` spells it)
	// and the policy KEY (`x_content_type_options`, as the JSON SoT spells
	// it) are two spellings of one contract; the value is read from the SoT
	// and never re-declared here.
	const wantValue = policy?.[config.baseline_policy_key];
	if (baselineRule && baselineHeader && wantValue !== undefined) {
		const haveValue = baselineRule.headers[baselineHeader];
		if (haveValue !== wantValue) {
			findings.push(
				finding(
					'headers',
					`headers.${config.baseline_rule}.${baselineHeader}`,
					FINDING_KIND.header_value_mismatch,
					wantValue,
					haveValue,
				),
			);
		}
	}
	return findings;
}

/** Collect one run's findings into a verdict. */
export function decide(findings, reason = null) {
	if (reason !== null) {
		return {
			verdict: DRIFT_VERDICT.undecidable,
			reason,
			findings: [],
			counts: Object.fromEntries(DRIFT_DIMENSIONS.map((dimension) => [dimension, 0])),
		};
	}
	const counts = Object.fromEntries(DRIFT_DIMENSIONS.map((dimension) => [dimension, 0]));
	for (const item of findings) {
		const dimension = counts[item.dimension] === undefined ? 'bindings' : item.dimension;
		counts[dimension] += 1;
	}
	return {
		verdict: findings.length === 0 ? DRIFT_VERDICT.match : DRIFT_VERDICT.drift,
		reason: null,
		findings,
		counts,
	};
}

/** 0 = match, 1 = drift, 2 = undecidable. The three are never merged. */
export function exitCodeFor(result) {
	if (result.verdict === DRIFT_VERDICT.match) return 0;
	if (result.verdict === DRIFT_VERDICT.drift) return 1;
	return 2;
}

/**
 * Validate a record before it is used as an expectation.
 *
 * A record that cannot state the contract is not a passing record: it is
 * UNDECIDABLE. The alternative — treating a malformed record as "no
 * findings" — is the silent-pass this gate exists to remove.
 */
export function readRecord(record) {
	if (!record || typeof record !== 'object')
		return undecidable(UNDECIDABLE_REASON.recordUnreadable);
	const production = record.production;
	if (!production || typeof production.bindings !== 'object' || !production.bindings) {
		return undecidable(UNDECIDABLE_REASON.recordIncomplete);
	}
	if (!Array.isArray(production.routes) || !record.build_commands || !record.static_asset_headers) {
		return undecidable(UNDECIDABLE_REASON.recordIncomplete);
	}
	for (const [name, binding] of Object.entries(production.bindings)) {
		if (!binding || typeof binding.type !== 'string') {
			return undecidable(`${UNDECIDABLE_REASON.recordIncomplete}:bindings.${name}`);
		}
		if (binding.type === 'secret' && Object.keys(binding).some((key) => key !== 'type')) {
			// A secret binding in the record must be a NAME. A value here
			// would be a committed credential, so the record is refused
			// rather than compared.
			return undecidable(`${UNDECIDABLE_REASON.recordIncomplete}:bindings.${name}`);
		}
	}
	if (!record.development?.mode_only_bindings) {
		return undecidable(UNDECIDABLE_REASON.recordIncomplete);
	}
	return null;
}

function undecidable(reason) {
	return { error: reason };
}

/**
 * The status-only report. Paste-safe into a PR, an Issue, or a CI log.
 *
 * `meta.counts` and `meta.notes` are printed as-is and must therefore be
 * status-only too; `assertStatusOnly` is the mechanical guard (see the
 * check script) rather than a promise.
 */
export function formatDriftReport(result, meta = {}) {
	const lines = [];
	const source = meta.source ?? 'repository';
	lines.push(`[cf-config-drift] source=${source} target=${meta.target ?? 'production'}`);
	lines.push(`[cf-config-drift] verdict=${result.verdict}`);
	lines.push(`[cf-config-drift] reason=${result.reason ?? '-'}`);
	lines.push(`[cf-config-drift] dimensions=${DRIFT_DIMENSIONS.join(',')}`);
	const dimText = DRIFT_DIMENSIONS.map(
		(dimension) => `${dimension}=${result.counts[dimension]}`,
	).join(' ');
	lines.push(`[cf-config-drift] findings=${result.findings.length} dim(${dimText})`);
	if (meta.summary) lines.push(`[cf-config-drift] observed=${meta.summary}`);
	for (const item of result.findings) {
		lines.push(
			`[cf-config-drift] finding=${item.path} kind=${item.kind} expected=${item.expected} actual=${item.actual}`,
		);
	}
	for (const note of meta.notes ?? []) lines.push(`[cf-config-drift] note=${note}`);
	lines.push(
		result.verdict === DRIFT_VERDICT.match
			? '[cf-config-drift] diff=none'
			: `[cf-config-drift] diff=${result.findings.length} item(s); release gate is red`,
	);
	return `${lines.join('\n')}\n`;
}

/**
 * Apply a fixture recipe to an observed surface.
 *
 * A recipe is a SINGLE-ITEM mutation recipe, which is what makes the
 * acceptance criterion demonstrable: the report and the unit test prove
 * that removing one binding — or one value — is enough to turn the gate
 * red, without recording a stale copy of the real configuration that
 * would itself become drift.
 */
export function applyDriftCase(productionSurface, developmentSurface, recipe = {}) {
	const production = structuredClone(productionSurface);
	const development = structuredClone(developmentSurface);

	if (typeof recipe.remove_binding === 'string') delete production.bindings[recipe.remove_binding];
	if (typeof recipe.remove_development_binding === 'string') {
		delete development.bindings[recipe.remove_development_binding];
	}
	if (recipe.add_binding && typeof recipe.add_binding.name === 'string') {
		production.bindings[recipe.add_binding.name] = normalizeBinding(recipe.add_binding.binding);
	}
	if (recipe.add_development_binding && typeof recipe.add_development_binding.name === 'string') {
		development.bindings[recipe.add_development_binding.name] = normalizeBinding(
			recipe.add_development_binding.binding,
		);
	}
	if (recipe.set_binding_field && typeof recipe.set_binding_field.name === 'string') {
		const binding = production.bindings[recipe.set_binding_field.name];
		if (binding) binding[recipe.set_binding_field.field] = recipe.set_binding_field.value;
	}
	if (Array.isArray(recipe.set_production_routes))
		production.routes = [...recipe.set_production_routes];
	if (Array.isArray(recipe.set_development_routes))
		development.routes = [...recipe.set_development_routes];
	return { production, development };
}
