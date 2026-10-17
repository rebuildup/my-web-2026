#!/usr/bin/env node
/**
 * GitHub Actions supply-chain audit (Issue #472).
 *
 * Usage:
 *   node scripts/check-workflow-pinning.mjs
 *   node scripts/check-workflow-pinning.mjs --manifest=<path> --workflows-dir=<dir>
 *   node scripts/check-workflow-pinning.mjs --json
 *
 * What it proves — statically, offline, and without touching a secret:
 *
 *   PIN_*      Every `uses:` resolves to a full 40-char commit SHA, the
 *              workflow still records the upstream ref that SHA was
 *              pinned from, and the SHA matches the pin manifest
 *              (`quality/actions-pins.json`) byte for byte. A tag ref
 *              (`@v4`) is a moving target: whoever can publish
 *              `actions/checkout` decides what runs in this repository
 *              with this repository's token. The manifest is the SoT for
 *              "which upstream release did we review", so the pin stays
 *              auditable instead of becoming an opaque 40-hex string.
 *
 *   PERM_*     Every job resolves to explicit GITHUB_TOKEN permissions,
 *              and any `write` scope fails unless it is allow-listed with
 *              a justification in the manifest. `write-all` and a missing
 *              `permissions:` block are findings, not defaults.
 *
 *   SECRET_*   A workflow may not reach a runtime secret value at all
 *              (AGENTS.md §4: Infisical is the secret SoT, Cloudflare
 *              Workers Builds is the deploy path), and may only reference
 *              a repository secret that the manifest approves by name.
 *
 *   AUTHZ_*    No untrusted trigger (`pull_request_target`,
 *              `workflow_run`), no production deploy and no GitHub
 *              Release publish from Actions — the release-merge human gate
 *              in AGENTS.md §6 must not become a workflow step.
 *
 * Every rule can be waived, but only through a manifest `exceptions`
 * entry that names the rule, the target, the reason and the reviewing
 * Issue. Waivers are printed, so an exception is visible in CI output
 * rather than hidden in review history.
 *
 * Exit codes: 0 = pass, 1 = at least one finding, 2 = bad input.
 *
 * Scope: this is a structural scan of `.github/workflows/*.y*ml`, not a
 * YAML parse. It reads `uses:`, `permissions:`, `on:` and `run:` shapes —
 * the four places a supply-chain or token-privilege mistake can hide — and
 * actionlint remains the syntax gate (`pnpm run lint:ci`).
 *
 * Fail closed: a `permissions:` or `on:` value this scanner cannot
 * resolve is a finding (`PERMISSIONS_UNPARSED`,
 * `AUTHZ_TRIGGER_UNPARSED`), never an inherited silence. An audit that
 * cannot read a shape must not report it as clean.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** Full commit SHA. A tag or branch name is never acceptable. */
const SHA_RE = /^[0-9a-f]{40}$/;
/** Anything that is *not* a full SHA but still looks like a git ref. */
const REFISH_RE = /^[0-9a-f]{7,39}$|^v?\d|^main$|^master$|^latest$/;
/** `docker://image:tag` — mutable unless it carries a digest. */
const DOCKER_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/** Rules are listed here so the report can explain a failure in place. */
export const RULES = {
	PIN_NOT_SHA: '`uses:` must pin a full 40-char commit SHA, not a tag or branch',
	PIN_MISSING_REF_COMMENT: 'pinned `uses:` must record the upstream ref it came from',
	PIN_REF_COMMENT_MISMATCH: 'the `# <ref>` comment must match the manifest ref',
	PIN_UNKNOWN_ACTION: 'the action is absent from the pin manifest',
	PIN_SHA_MISMATCH: 'the workflow SHA does not match the pin manifest SHA',
	PIN_UNUSED_MANIFEST_ENTRY: 'the manifest pins an action no workflow uses',
	PERMISSIONS_MISSING: 'workflow or job has no explicit `permissions:` block',
	PERMISSIONS_UNPARSED:
		'a `permissions:` block is in a shape the gate cannot resolve, so its scopes are unproved',
	PERMISSIONS_WRITE: 'a write scope needs a manifest `permissions.allow_writes` entry',
	PERMISSIONS_WRITE_ALL: '`write-all` is never least privilege',
	SECRET_REFERENCE: 'the workflow references a repository secret the manifest does not approve',
	SECRET_VALUE_ACCESS: 'the workflow can reach a runtime secret value',
	AUTHZ_UNTRUSTED_TRIGGER: 'untrusted-code triggers execute workflow code with repository secrets',
	AUTHZ_TRIGGER_UNPARSED:
		'the `on:` value is a shape the gate cannot resolve, so which events run this workflow is unproved',
	AUTHZ_PRODUCTION_DEPLOY: 'production deploy is owned by Cloudflare Workers Builds (AGENTS.md §4)',
	AUTHZ_RELEASE_PUBLISH: 'release PR merge / tag / Release publish is a human gate (AGENTS.md §6)',
};

/**
 * Value-printing and production-path patterns, straight from the
 * anti-pattern list in AGENTS.md §4 and the deploy/release authority in
 * §4 / §6. Matched against comment-stripped workflow text, line by line.
 *
 * `wrangler deploy` and `cf deploy` are allowed only on a line that also
 * says `--dry-run` (the validate gate) — see `scanAuthority`.
 */
const SECRET_VALUE_PATTERNS = [
	{ re: /\binfisical\s+secrets\b/, why: 'Infisical CLI in CI reaches runtime secret values' },
	{ re: /\bwrangler\s+secret\s+list\b/, why: 'wrangler secret list may print values' },
	{ re: /\bprintenv\b/, why: 'printenv dumps the whole environment' },
	{ re: /\bcat\s+[^\s|]*\.dev\.vars\b/, why: '.dev.vars holds development credentials' },
	{
		re: /\becho\b[^\n]*\$\{?\s*(BETTER_AUTH|CLOUDFLARE|INFLISICAL|MY_WEB_[A-Z0-9_]*)/,
		why: 'echo of a credential-shaped variable name',
	},
	{ re: /\bset\s+-x\b/, why: 'shell tracing echoes every expanded credential' },
];

const UNTRUSTED_TRIGGERS = new Set(['pull_request_target', 'workflow_run', 'issue_comment']);

const DEPLOY_TOKENS = [
	{ re: /\bwrangler\s+deploy\b/, cmd: 'wrangler deploy' },
	{ re: /\bcf\s+deploy\b/, cmd: 'cf deploy' },
	{ re: /\bdeploy:production\b/, cmd: 'pnpm run deploy:production' },
];

const RELEASE_PUBLISH_RE = /\bgh\s+release\s+(create|upload|delete|edit)\b/;

/**
 * Parse and shape-check the pin manifest.
 *
 * The manifest is data, so it gets the same treatment as any other
 * machine-read input: bad shape is an error (exit 2), not a silently
 * empty allow-list.
 */
export function parseManifest(raw, source = 'manifest') {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`${source}: not valid JSON: ${error.message}`);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${source}: must be a JSON object`);
	}
	if (parsed.schema_version !== 1) {
		throw new Error(`${source}: schema_version must be 1`);
	}
	if (typeof parsed.actions !== 'object' || parsed.actions === null) {
		throw new Error(`${source}: actions must be an object`);
	}
	for (const [name, entry] of Object.entries(parsed.actions)) {
		if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(name)) {
			throw new Error(`${source}: actions["${name}"] is not an owner/repo[/path] key`);
		}
		if (!SHA_RE.test(entry?.sha ?? '')) {
			throw new Error(`${source}: actions["${name}"].sha must be a 40-char commit SHA`);
		}
		if (typeof entry?.ref !== 'string' || entry.ref.length === 0) {
			throw new Error(`${source}: actions["${name}"].ref must name the upstream tag`);
		}
		if (
			typeof entry?.repository !== 'string' ||
			!/^https:\/\/github\.com\//.test(entry.repository)
		) {
			throw new Error(
				`${source}: actions["${name}"].repository must be the https://github.com/ source URL`,
			);
		}
	}
	const permissions = parsed.permissions ?? {};
	if (!Array.isArray(permissions.allow_writes ?? [])) {
		throw new Error(`${source}: permissions.allow_writes must be an array`);
	}
	const secrets = parsed.secrets ?? {};
	if (!Array.isArray(secrets.allow_references ?? [])) {
		throw new Error(`${source}: secrets.allow_references must be an array`);
	}
	const exceptions = parsed.exceptions ?? [];
	if (!Array.isArray(exceptions)) {
		throw new Error(`${source}: exceptions must be an array`);
	}
	// Normalised once here, so every consumer — including a caller that
	// imports `auditWorkflows` directly — can read the key without
	// re-deriving whether the manifest declared it.
	parsed.exceptions = exceptions;
	for (const entry of exceptions) {
		if (!RULES[entry?.rule]) {
			throw new Error(`${source}: exception rule "${entry?.rule}" is not a known rule`);
		}
		if (!entry?.target || !entry?.reason) {
			throw new Error(`${source}: each exception needs target and reason`);
		}
	}
	return parsed;
}

/** Remove a YAML comment. `uses:` values cannot contain '#'. */
function stripComment(line) {
	const hash = line.indexOf('#');
	return (hash === -1 ? line : line.slice(0, hash)).trimEnd();
}

/** Indentation width in columns; YAML forbids tabs here (profile.yaml). */
function indentOf(line) {
	return /^\s*/.exec(line)[0].length;
}

function isSkippable(line) {
	const trimmed = line.trim();
	return trimmed === '' || trimmed.startsWith('#');
}

/** Strip one layer of YAML quoting. `'push'` and `"push"` are the same key. */
function unquote(value) {
	return value.replace(/^['"]|['"]$/g, '');
}

/** `{ scope: level }` entries, or null when a line is not a mapping. */
function parseScopeEntries(entries) {
	const scopes = [];
	for (const raw of entries) {
		const m = /^([A-Za-z0-9-]+):\s*(.+)$/.exec(raw.trim());
		if (!m) return null;
		scopes.push({ scope: m[1], level: m[2].trim() });
	}
	return scopes;
}

/**
 * A `permissions:` value, resolved into an explicit scope list.
 *
 * Returns `{ mode, scopes }` where mode is `map`, `read-all`, `write-all`
 * or `none` (`{}`). `scopes` is `[{ scope, level }]`. `invalid` means the
 * shape is one this gate does not model (a YAML alias, a folded scalar,
 * ...); the caller must fail closed on it rather than assume a default.
 */
export function parsePermissions(lines) {
	const entries = lines.map((line) => stripComment(line).trim()).filter((line) => line !== '');
	if (entries.length === 0) return { mode: 'none', scopes: [] };
	const first = entries[0].trim();
	if (first === 'read-all') return { mode: 'read-all', scopes: [] };
	if (first === 'write-all') return { mode: 'write-all', scopes: [] };
	if (first === '{}') return { mode: 'none', scopes: [] };
	// Flow mapping on one line: `permissions: {contents: read, issues: write}`.
	// Modelling it stops a compact-but-valid workflow from inheriting a
	// default nobody wrote.
	if (entries.length === 1 && first.startsWith('{') && first.endsWith('}')) {
		const inner = first.slice(1, -1).trim();
		const flow = parseScopeEntries(inner === '' ? [] : inner.split(','));
		if (flow === null) return { mode: 'invalid', scopes: [], raw: entries };
		return { mode: 'map', scopes: flow };
	}
	const scopes = parseScopeEntries(entries);
	if (scopes === null) return { mode: 'invalid', scopes: [], raw: entries };
	return { mode: 'map', scopes };
}

/** Lines that belong to a block key: everything indented deeper than it. */
function blockLines(lines, keyIndex, keyIndent) {
	const out = [];
	for (let i = keyIndex + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (isSkippable(line)) {
			out.push(line);
			continue;
		}
		if (indentOf(line) <= keyIndent) break;
		out.push(line);
	}
	return out;
}

function headerRow(columns, widths) {
	return formatRow(columns, widths).trimEnd();
}

function rowWidths(rows) {
	const widths = [];
	for (const row of rows) {
		row.forEach((cell, index) => {
			widths[index] = Math.max(widths[index] ?? 0, String(cell).length);
		});
	}
	return widths;
}

function formatRow(row, widths) {
	return row
		.map((cell, index) => String(cell).padEnd(widths[index] ?? 0))
		.join('  ')
		.trimEnd();
}

function findKey(lines, indent, name, from = 0, to = lines.length) {
	for (let i = from; i < to; i += 1) {
		if (isSkippable(lines[i])) continue;
		if (indentOf(lines[i]) !== indent) continue;
		const m = new RegExp(`^${' '.repeat(indent)}["']?${name}["']?:\\s*(.*)$`).exec(lines[i]);
		if (m) return { index: i, inline: stripComment(m[1]).trim(), lines };
	}
	return null;
}

/**
 * The `on:` triggers, in every shape the gate models: the block form
 * (`on:` + an indented `pull_request:`), the scalar form
 * (`on: pull_request_target`) and the flow sequence
 * (`on: [push, pull_request_target]`).
 *
 * A compact form is still a trigger declaration. Reading only the block
 * form made `on: pull_request_target` audit as "no triggers at all",
 * which is the one outcome the AUTHZ rules exist to prevent.
 */
export function parseTriggers(onKey) {
	if (onKey === null) return [];
	if (onKey.inline !== '') {
		const flow = onKey.inline.replace(/^\[/, '').replace(/\]$/, '');
		return flow
			.split(',')
			.map((name) => unquote(name.trim()))
			.filter((name) => name !== '');
	}
	return blockLines(onKey.lines, onKey.index, 0)
		.map((line) => unquote(stripComment(line).trim()))
		.filter((name) => name !== '');
}

/**
 * Split a workflow file into jobs.
 *
 * `jobs:` is a top-level key; each job is a key at the first indentation
 * level below it. Every non-blank line after a job header belongs to that
 * job until the next job header.
 */
export function parseWorkflow(text, file) {
	const lines = text.split('\n');
	const jobsKey = findKey(lines, 0, 'jobs');
	// The `jobs:` block ends at the next top-level key, so a workflow that
	// puts `jobs` in the middle of the file does not leak later keys into
	// the job list.
	const jobsEnd = jobsKey
		? (() => {
				for (let i = jobsKey.index + 1; i < lines.length; i += 1) {
					if (isSkippable(lines[i])) continue;
					return indentOf(lines[i]) === 0 ? i : lines.length;
				}
				return lines.length;
			})()
		: 0;
	const workflowPermissions = findKey(lines, 0, 'permissions');
	const onKey = findKey(lines, 0, 'on') ?? findKey(lines, 0, 'true');

	const workflow = {
		file,
		jobs: [],
		uses: [],
		permissions: workflowPermissions
			? parsePermissions(
					workflowPermissions.inline
						? [workflowPermissions.inline]
						: blockLines(lines, workflowPermissions.index, 0),
				)
			: null,
		workflowPermissionsLine: workflowPermissions ? workflowPermissions.index + 1 : null,
		triggersLine: onKey ? onKey.index + 1 : null,
		triggers: parseTriggers(onKey),
		lines,
	};

	let jobIndent = null;
	let current = null;
	for (let i = jobsKey ? jobsKey.index + 1 : 0; i < jobsEnd; i += 1) {
		const line = lines[i];
		if (isSkippable(line)) continue;
		const indent = indentOf(line);
		if (jobIndent === null && indent > 0) jobIndent = indent;
		if (jobIndent !== null && indent <= jobIndent) {
			const header = /^\s{0,4}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
			if (header) {
				current = {
					name: header[1],
					startLine: i + 1,
					permissions: null,
					permissionsLine: null,
				};
				workflow.jobs.push(current);
			}
			continue;
		}
		if (!current) continue;

		const uses = /^\s*(?:-\s+)?uses:\s*(.*)$/.exec(line);
		if (uses) {
			workflow.uses.push({
				file,
				line: i + 1,
				job: current.name,
				...splitUsesValue(uses[1]),
			});
		}

		// Any `permissions:` deeper than the job header is that job's own
		// block. Keying it on an exact `jobIndent + 2` missed the same block
		// written at a wider indentation, which is still valid YAML.
		const permissions = /^(\s+)permissions:\s*(.*)$/.exec(line);
		if (permissions && indent > jobIndent) {
			const inline = stripComment(permissions[2]);
			current.permissions = parsePermissions(inline ? [inline] : blockLines(lines, i, indent));
			current.permissionsLine = i + 1;
		}
	}
	return workflow;
}

/** Split `owner/repo@ref # v4.2.2` into its value and its ref comment. */
export function splitUsesValue(rest) {
	let value = rest;
	let comment = null;
	const hash = value.indexOf('#');
	if (hash !== -1) {
		comment = value.slice(hash + 1).trim();
		value = value.slice(0, hash);
	}
	return {
		uses: value.trim().replace(/^['"]|['"]$/g, ''),
		refComment: comment,
	};
}

/** `owner/repo` / `owner/repo/path` for a `uses:` value, or null if local. */
export function externalActionRef(uses) {
	if (uses.startsWith('./') || uses.startsWith('../') || uses.startsWith('docker://')) return null;
	const at = uses.lastIndexOf('@');
	if (at <= 0) return { repo: uses, ref: null };
	return { repo: uses.slice(0, at), ref: uses.slice(at + 1) };
}

function finding(audit, rule, file, line, message, extra = {}) {
	audit.findings.push({ rule, file, line, message, ...extra });
}

/**
 * Token-privilege and authority scan over one workflow's comment-stripped
 * lines. Split out so the same logic covers a workflow with no `uses:` at
 * all — a workflow that only runs shell is still a supply-chain surface.
 */
function scanAuthority(workflow, audit) {
	const allowedWriteScopes = new Set(
		audit.manifest.permissions?.allow_writes?.map((e) => e.scope) ?? [],
	);
	const allowedSecrets = new Set(
		audit.manifest.secrets?.allow_references?.map((e) => e.name) ?? [],
	);

	if (workflow.permissions === null) {
		finding(
			audit,
			'PERMISSIONS_MISSING',
			workflow.file,
			1,
			'workflow declares no top-level `permissions:`; GITHUB_TOKEN would take the repository default',
		);
	} else if (workflow.permissions.mode === 'write-all') {
		finding(
			audit,
			'PERMISSIONS_WRITE_ALL',
			workflow.file,
			workflow.workflowPermissionsLine,
			'top-level `permissions: write-all`',
		);
	} else if (workflow.permissions.mode === 'invalid') {
		finding(
			audit,
			'PERMISSIONS_UNPARSED',
			workflow.file,
			workflow.workflowPermissionsLine,
			`unreadable permissions block: ${JSON.stringify(workflow.permissions.raw)}`,
		);
	}

	for (const job of workflow.jobs) {
		const effective = job.permissions ?? workflow.permissions;
		if (effective === null) {
			finding(
				audit,
				'PERMISSIONS_MISSING',
				workflow.file,
				job.startLine,
				`job "${job.name}" resolves no explicit permissions`,
			);
			continue;
		}
		// Fail closed. An unreadable block must not fall through to the
		// empty `scopes` list and inherit the workflow default in silence:
		// that is how `permissions: {contents: write}` audited as clean.
		if (effective.mode === 'invalid') {
			// Only the block that declares the bad shape is reported; a job
			// that merely inherits an unreadable workflow block is already
			// covered by the workflow-level finding above.
			if (job.permissions !== null) {
				finding(
					audit,
					'PERMISSIONS_UNPARSED',
					workflow.file,
					job.permissionsLine,
					`job "${job.name}" declares an unreadable permissions block: ${JSON.stringify(effective.raw)}`,
				);
			}
			continue;
		}
		if (job.permissions && effective.mode === 'write-all') {
			finding(
				audit,
				'PERMISSIONS_WRITE_ALL',
				workflow.file,
				job.permissionsLine,
				`job "${job.name}" requests write-all`,
			);
		}
		for (const { scope, level } of effective.scopes) {
			if (level === 'write' && !allowedWriteScopes.has(scope)) {
				finding(
					audit,
					'PERMISSIONS_WRITE',
					workflow.file,
					(job.permissions ? job.permissionsLine : workflow.workflowPermissionsLine) ?? 1,
					`job "${job.name}" requests ${scope}: write`,
				);
			}
		}
	}

	for (let i = 0; i < workflow.lines.length; i += 1) {
		const line = stripComment(workflow.lines[i]);
		if (line === '') continue;
		const lineNo = i + 1;
		for (const { re, why } of SECRET_VALUE_PATTERNS) {
			if (re.test(line)) finding(audit, 'SECRET_VALUE_ACCESS', workflow.file, lineNo, why);
		}
		for (const token of DEPLOY_TOKENS) {
			if (token.re.test(line) && !line.includes('--dry-run')) {
				finding(
					audit,
					'AUTHZ_PRODUCTION_DEPLOY',
					workflow.file,
					lineNo,
					`\`${token.cmd}\` runs without --dry-run`,
				);
			}
		}
		if (RELEASE_PUBLISH_RE.test(line)) {
			finding(
				audit,
				'AUTHZ_RELEASE_PUBLISH',
				workflow.file,
				lineNo,
				'GitHub Release publish from Actions',
			);
		}
		// Both GitHub expression forms reach a repository secret:
		// `${{ secrets.NAME }}` and `${{ secrets['NAME'] }}`. Reading only
		// the dot form let the index form through an allow-list that is
		// empty on purpose.
		for (const secret of line.matchAll(
			/\bsecrets\.([A-Za-z0-9_]+)\b|\bsecrets\s*\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g,
		)) {
			const name = secret[1] ?? secret[2];
			if (!allowedSecrets.has(name)) {
				finding(
					audit,
					'SECRET_REFERENCE',
					workflow.file,
					lineNo,
					`${secret[1] !== undefined ? `secrets.${name}` : `secrets['${name}']`} is not approved in the manifest`,
				);
			}
		}
	}

	for (const trigger of workflow.triggers) {
		const name = trigger.split(':')[0].trim();
		// A name the gate cannot read (an alias such as `on: *events`, a
		// flow mapping) means the trigger set is unproved. Failing closed
		// here is the difference between "no untrusted trigger found" and
		// "the gate could not look".
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
			finding(
				audit,
				'AUTHZ_TRIGGER_UNPARSED',
				workflow.file,
				workflow.triggersLine ?? 1,
				`unreadable \`on:\` entry: ${JSON.stringify(trigger)}`,
			);
			continue;
		}
		if (UNTRUSTED_TRIGGERS.has(name)) {
			finding(
				audit,
				'AUTHZ_UNTRUSTED_TRIGGER',
				workflow.file,
				workflow.triggersLine ?? 1,
				`\`${name}\` executes fork-authored code with repository secrets`,
			);
		}
	}
}

/** Pin rules over every `uses:` in every workflow. */
function scanPins(workflow, audit) {
	for (const use of workflow.uses) {
		if (use.uses.startsWith('./') || use.uses.startsWith('../')) {
			audit.localActions.push({ ...use, kind: 'local' });
			continue;
		}
		if (use.uses.startsWith('docker://')) {
			const image = use.uses.slice('docker://'.length);
			const at = image.lastIndexOf('@');
			if (at === -1 || !DOCKER_DIGEST_RE.test(image.slice(at + 1))) {
				finding(
					audit,
					'PIN_NOT_SHA',
					workflow.file,
					use.line,
					`docker image must use a sha256 digest: ${use.uses}`,
				);
				continue;
			}
			audit.pins.push({ ...use, repo: use.uses.slice(0, at), ref: image.slice(at + 1) });
			continue;
		}

		const { repo, ref } = externalActionRef(use.uses) ?? { repo: use.uses, ref: null };
		// Recorded before any validation, so a broken pin reports its own
		// rule only; `PIN_UNUSED_MANIFEST_ENTRY` stays a statement about
		// manifest drift rather than a second copy of the same mistake.
		audit.referenced.add(repo);
		const entry = audit.manifest.actions[repo];
		if (ref === null) {
			finding(audit, 'PIN_NOT_SHA', workflow.file, use.line, `no @ref in ${use.uses}`);
			continue;
		}
		if (!SHA_RE.test(ref)) {
			const hint = REFISH_RE.test(ref) ? ' (a movable tag / branch)' : '';
			finding(audit, 'PIN_NOT_SHA', workflow.file, use.line, `${repo}@${ref}${hint}`);
			continue;
		}
		if (!entry) {
			finding(
				audit,
				'PIN_UNKNOWN_ACTION',
				workflow.file,
				use.line,
				`${repo} is not in the pin manifest`,
			);
			continue;
		}
		if (entry.sha !== ref) {
			finding(
				audit,
				'PIN_SHA_MISMATCH',
				workflow.file,
				use.line,
				`${repo}: workflow ${ref.slice(0, 12)} != manifest ${entry.sha.slice(0, 12)} (${entry.ref})`,
			);
			continue;
		}
		if (!use.refComment) {
			finding(
				audit,
				'PIN_MISSING_REF_COMMENT',
				workflow.file,
				use.line,
				`${repo}@${ref} has no \`# <ref>\` comment`,
			);
			continue;
		}
		if (use.refComment !== entry.ref) {
			finding(
				audit,
				'PIN_REF_COMMENT_MISMATCH',
				workflow.file,
				use.line,
				`${repo}: comment # ${use.refComment} != manifest ref ${entry.ref}`,
			);
			continue;
		}
		audit.pins.push({ ...use, repo, ref: entry.ref, sha: ref });
	}
}

/** A manifest entry no workflow references is drift in the other direction. */
function scanUnusedManifestEntries(audit) {
	for (const [repo, entry] of Object.entries(audit.manifest.actions)) {
		if (!audit.referenced.has(repo)) {
			finding(
				audit,
				'PIN_UNUSED_MANIFEST_ENTRY',
				audit.manifestSource,
				1,
				`${repo}@${entry.sha.slice(0, 12)} (${entry.ref}) is pinned but no workflow uses it`,
			);
		}
	}
}

/** A manifest exception downgrades one finding and stays visible. */
function applyExceptions(audit) {
	const kept = [];
	for (const item of audit.findings) {
		// `target` is written the way a human reads it (a repository path),
		// while `item.file` may be absolute (a fixture audit). Matching the
		// suffix keeps the manifest readable without weakening the rule.
		const waiver = (audit.manifest.exceptions ?? []).find(
			(exception) =>
				exception.rule === item.rule &&
				(exception.target === '*' ||
					exception.target === item.file ||
					item.file.endsWith(`/${exception.target}`)) &&
				(exception.job === undefined || exception.job === item.job),
		);
		if (waiver)
			audit.waivers.push({
				...item,
				reason: waiver.reason,
				review_issue: waiver.review_issue ?? null,
			});
		else kept.push(item);
	}
	audit.findings = kept;
}

export function listWorkflowFiles(workflowsDir) {
	return readdirSync(workflowsDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
		.map((entry) => join(workflowsDir, entry.name))
		.sort();
}

/**
 * Audit a workflows directory against a parsed manifest.
 * Pure: it touches the filesystem only through the paths it is given.
 */
export function auditWorkflows({ workflowsDir, manifest, manifestSource = 'manifest' }) {
	const audit = {
		manifest,
		manifestSource,
		workflows: [],
		pins: [],
		localActions: [],
		referenced: new Set(),
		findings: [],
		waivers: [],
	};
	for (const file of listWorkflowFiles(workflowsDir)) {
		const workflow = parseWorkflow(readFileSync(file, 'utf8'), file);
		audit.workflows.push(workflow);
		scanAuthority(workflow, audit);
		scanPins(workflow, audit);
	}
	scanUnusedManifestEntries(audit);
	applyExceptions(audit);
	audit.findings.sort(
		(a, b) =>
			a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule),
	);
	audit.summary = {
		status: audit.findings.length === 0 ? 'PASS' : 'FAIL',
		workflows: audit.workflows.length,
		jobs: audit.workflows.reduce((total, w) => total + w.jobs.length, 0),
		pins: audit.pins.length,
		local_actions: audit.localActions.length,
		findings: audit.findings.length,
		waivers: audit.waivers.length,
	};
	return audit;
}

/**
 * A machine-readable view of the audit: the same status data, without
 * the raw workflow text and without a `Set` that `JSON.stringify` would
 * flatten to `{}`.
 */
export function jsonReport(audit) {
	return {
		...audit,
		referenced: [...audit.referenced].sort(),
		workflows: audit.workflows.map(({ lines, ...rest }) => rest),
	};
}

/** Human-readable, status-only report. Never prints a secret value. */
export function renderTextReport(audit) {
	const rel = (file) => file.replace(`${ROOT}/`, '');
	const lines = [];
	lines.push('supply-chain: GitHub Actions pin / permission audit (Issue #472)');
	lines.push('');

	// Column widths come from the data, not from a guess: a long fixture
	// path must not push the upstream-ref column off the row.
	const pinRows = audit.pins.map((pin) => [
		rel(pin.file),
		pin.job,
		pin.repo,
		pin.ref,
		pin.sha.slice(0, 12),
	]);
	for (const local of audit.localActions) {
		pinRows.push([rel(local.file), local.job, local.uses, 'local', '-']);
	}
	const pinWidths = rowWidths(pinRows);
	lines.push(headerRow(['workflow', 'job', 'action', 'upstream', 'sha'], pinWidths));
	for (const row of pinRows) lines.push(formatRow(row, pinWidths));

	lines.push('');
	const permissionRows = [];
	for (const workflow of audit.workflows) {
		for (const job of workflow.jobs) {
			const effective = job.permissions ?? workflow.permissions;
			const text =
				effective === null
					? '(none declared)'
					: effective.mode === 'map'
						? effective.scopes.map((s) => `${s.scope}=${s.level}`).join(' ')
						: effective.mode;
			permissionRows.push([`${rel(workflow.file)} › ${job.name}`, text]);
		}
	}
	const permissionWidths = rowWidths(permissionRows);
	lines.push(headerRow(['job', 'effective GITHUB_TOKEN permissions'], permissionWidths));
	for (const row of permissionRows) lines.push(formatRow(row, permissionWidths));

	lines.push('');
	if (audit.findings.length === 0) {
		lines.push('findings: 0');
	} else {
		lines.push(`findings: ${audit.findings.length}`);
		for (const item of audit.findings) {
			lines.push(`  ${rel(item.file)}:${item.line}  [${item.rule}]  ${item.message}`);
			lines.push(`      ${RULES[item.rule]}`);
		}
	}
	for (const waiver of audit.waivers) {
		lines.push(`  waived: ${rel(waiver.file)}:${waiver.line} [${waiver.rule}] — ${waiver.reason}`);
	}
	lines.push('');
	lines.push(
		`status: ${audit.summary.status} (workflows ${audit.summary.workflows}, jobs ${audit.summary.jobs}, pins ${audit.summary.pins}, waivers ${audit.summary.waivers})`,
	);
	return lines.join('\n');
}

function parseArgs(argv) {
	const options = {
		manifest: join(ROOT, 'quality', 'actions-pins.json'),
		workflowsDir: join(ROOT, '.github', 'workflows'),
		json: false,
	};
	for (const arg of argv) {
		if (arg.startsWith('--manifest=')) options.manifest = resolve(arg.slice('--manifest='.length));
		else if (arg.startsWith('--workflows-dir='))
			options.workflowsDir = resolve(arg.slice('--workflows-dir='.length));
		else if (arg === '--json') options.json = true;
		else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

function main(argv) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[check-workflow-pinning] ${error.message}\n`);
		return 2;
	}
	let manifest;
	try {
		manifest = parseManifest(readFileSync(options.manifest, 'utf8'), options.manifest);
	} catch (error) {
		process.stderr.write(`[check-workflow-pinning] ${error.message}\n`);
		return 2;
	}
	let audit;
	try {
		audit = auditWorkflows({ ...options, manifest });
	} catch (error) {
		process.stderr.write(
			`[check-workflow-pinning] cannot audit ${options.workflowsDir}: ${error.message}\n`,
		);
		return 2;
	}
	const report = options.json
		? JSON.stringify(jsonReport(audit), null, 2)
		: renderTextReport(audit);
	const stream = audit.summary.status === 'PASS' ? process.stdout : process.stderr;
	stream.write(`${report}\n`);
	return audit.summary.status === 'PASS' ? 0 : 1;
}

// Run as a CLI only when invoked directly. The audit is also imported by
// the test suite and by the verification report generator, and a module
// that runs its gate on import would exit the importing process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(main(process.argv.slice(2)));
}
