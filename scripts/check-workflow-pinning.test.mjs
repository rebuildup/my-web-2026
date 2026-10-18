import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	RULES,
	auditWorkflows,
	externalActionRef,
	parseManifest,
	parsePermissions,
	parseWorkflow,
	renderTextReport,
	splitUsesValue,
} from './check-workflow-pinning.mjs';

/**
 * `check-workflow-pinning.mjs` tests (Issue #472).
 *
 * The interesting invariants:
 *   1. The repository's own workflows pass, with the exact pin inventory
 *      the manifest declares — a gate that fails on the shipped workflows
 *      is noise, and one that passes for the wrong reason is worse.
 *   2. Each rule fires on the smallest fixture that proves it (floating
 *      tag, missing ref comment, ref-comment drift, SHA drift, unknown
 *      action, unused manifest entry, missing / write-all / write
 *      permissions, untrusted trigger, production deploy, release
 *      publish, secret value access, unapproved secret reference).
 *   3. A manifest exception waives exactly one finding and stays visible.
 *   4. Malformed manifest input is an error (exit 2), never a silently
 *      empty allow-list.
 *   5. The committed abnormal fixture lives OUTSIDE `.github/workflows/`
 *      and still fails, with the rule set the docs claim.
 *   6. The CLI exit code is 0 / 1 / 2 for pass / findings / bad input.
 *   7. A YAML shape this scan cannot resolve fails CLOSED. `permissions`
 *      and `on:` have compact and aliased forms; reading only the block
 *      form reported a write-token, fork-triggered workflow as PASS.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SCRIPT = join(HERE, 'check-workflow-pinning.mjs');

const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262';
const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020';

const REAL_MANIFEST = join(ROOT, 'quality', 'actions-pins.json');
const FIXTURE_DIR = join(ROOT, 'quality', 'fixtures', 'actions-pinning');

const BASE_MANIFEST = {
	schema_version: 1,
	actions: {
		'actions/checkout': {
			sha: CHECKOUT_SHA,
			ref: 'v4.4.0',
			repository: 'https://github.com/actions/checkout',
			reviewed_on: '2026-10-18',
			review_issue: 472,
		},
	},
	permissions: { default: 'contents: read', allow_writes: [] },
	secrets: { allow_references: [] },
	exceptions: [],
};

/** Materialise a throwaway repository: workflows dir + manifest file. */
function makeRepo({ workflows, manifest = BASE_MANIFEST }) {
	const dir = mkdtempSync(join(tmpdir(), 'workflow-pins-'));
	mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
	for (const [name, body] of Object.entries(workflows)) {
		writeFileSync(join(dir, '.github', 'workflows', name), body);
	}
	writeFileSync(join(dir, 'actions-pins.json'), JSON.stringify(manifest, null, '\t'));
	return dir;
}

function auditTemp(dir, manifest = BASE_MANIFEST) {
	return auditWorkflows({
		workflowsDir: join(dir, '.github', 'workflows'),
		manifest: parseManifest(JSON.stringify(manifest)),
	});
}

const CLEAN_WORKFLOW = `name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${CHECKOUT_SHA} # v4.4.0
        with: { submodules: recursive }
`;

const rulesOf = (audit) => audit.findings.map((finding) => finding.rule).sort();

describe('repository workflows', () => {
	it('passes with the inventory the manifest declares', () => {
		const audit = auditWorkflows({
			workflowsDir: join(ROOT, '.github', 'workflows'),
			manifest: parseManifest(readFileSync(REAL_MANIFEST, 'utf8')),
			manifestSource: 'quality/actions-pins.json',
		});
		assert.deepEqual(audit.findings, []);
		assert.equal(audit.summary.status, 'PASS');
		assert.equal(audit.summary.workflows, 2);
		// ci.yml (checkout, setup-node, pnpm, bun, cache, upload-artifact x3)
		// + prod-smoke.yml (checkout, setup-node, pnpm, cache, upload-artifact)
		assert.equal(audit.summary.pins, 13);
		assert.deepEqual([...new Set(audit.pins.map((pin) => pin.repo))].sort(), [
			'actions/cache',
			'actions/checkout',
			'actions/setup-node',
			'actions/upload-artifact',
			'oven-sh/setup-bun',
			'pnpm/action-setup',
		]);
	});

	it('resolves every shipped job to contents=read', () => {
		const audit = auditWorkflows({
			workflowsDir: join(ROOT, '.github', 'workflows'),
			manifest: parseManifest(readFileSync(REAL_MANIFEST, 'utf8')),
		});
		const effective = audit.workflows.flatMap((workflow) =>
			workflow.jobs.map((job) => {
				const resolved = job.permissions ?? workflow.permissions;
				return `${job.name}:${resolved.mode}:${resolved.scopes.map((s) => `${s.scope}=${s.level}`).join(',')}`;
			}),
		);
		assert.deepEqual(effective.sort(), [
			'prod-smoke:map:contents=read',
			'validate:map:contents=read',
		]);
	});

	it('reports a clean audit as PASS with no waivers', () => {
		const audit = auditTemp(makeRepo({ workflows: { 'ci.yml': CLEAN_WORKFLOW } }));
		const report = renderTextReport(audit);
		assert.match(report, /status: PASS \(workflows 1, jobs 1, pins 1, waivers 0\)/);
		assert.match(report, /contents=read/);
	});
});

describe('pin rules', () => {
	it('rejects a floating tag ref', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						`actions/checkout@${CHECKOUT_SHA} # v4.4.0`,
						'actions/checkout@v4',
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(audit), ['PIN_NOT_SHA']);
		assert.match(audit.findings[0].message, /actions\/checkout@v4 \(a movable tag \/ branch\)/);
	});

	it('rejects a short SHA', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: { 'ci.yml': CLEAN_WORKFLOW.replace(CHECKOUT_SHA, CHECKOUT_SHA.slice(0, 12)) },
			}),
		);
		assert.deepEqual(rulesOf(audit), ['PIN_NOT_SHA']);
	});

	it('rejects a pinned SHA with no upstream ref comment', () => {
		const audit = auditTemp(
			makeRepo({ workflows: { 'ci.yml': CLEAN_WORKFLOW.replace(' # v4.4.0', '') } }),
		);
		assert.deepEqual(rulesOf(audit), ['PIN_MISSING_REF_COMMENT']);
	});

	it('rejects a ref comment that drifts from the manifest', () => {
		const audit = auditTemp(
			makeRepo({ workflows: { 'ci.yml': CLEAN_WORKFLOW.replace('# v4.4.0', '# v4.2.2') } }),
		);
		assert.deepEqual(rulesOf(audit), ['PIN_REF_COMMENT_MISMATCH']);
		assert.match(audit.findings[0].message, /comment # v4\.2\.2 != manifest ref v4\.4\.0/);
	});

	it('rejects a workflow SHA that drifts from the manifest', () => {
		const audit = auditTemp(
			makeRepo({ workflows: { 'ci.yml': CLEAN_WORKFLOW.replace(CHECKOUT_SHA, SETUP_NODE_SHA) } }),
		);
		assert.deepEqual(rulesOf(audit), ['PIN_SHA_MISMATCH']);
	});

	it('rejects an action the manifest does not pin', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'- uses:',
						`- uses: actions/setup-node@${SETUP_NODE_SHA} # v4.4.0\n      - uses:`,
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(audit), ['PIN_UNKNOWN_ACTION']);
	});

	it('rejects a manifest entry no workflow uses', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml':
						'name: ci\non:\n  push:\npermissions:\n  contents: read\njobs:\n  a:\n    steps: []\n',
				},
			}),
		);
		assert.deepEqual(rulesOf(audit), ['PIN_UNUSED_MANIFEST_ENTRY']);
	});

	it('requires a sha256 digest for a container image', () => {
		const digest = 'sha256:'.concat('a'.repeat(64));
		const withImage = (image) =>
			auditTemp(
				makeRepo({
					workflows: {
						'ci.yml': CLEAN_WORKFLOW.replace('- uses:', `- uses: ${image}\n      - uses:`),
					},
				}),
			);
		assert.deepEqual(rulesOf(withImage('docker://alpine:3.20')), ['PIN_NOT_SHA']);
		assert.deepEqual(rulesOf(withImage(`docker://alpine@${digest}`)), []);
	});

	it('treats a local action path as no pin at all', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'- uses:',
						'- uses: ./.github/actions/setup\n      - uses:',
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(audit), []);
		assert.equal(audit.summary.local_actions, 1);
	});
});

describe('token permission rules', () => {
	const withPermissions = (block) =>
		CLEAN_WORKFLOW.replace('permissions:\n  contents: read\n', block);

	it('rejects a workflow with no permissions block', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: { 'ci.yml': CLEAN_WORKFLOW.replace('permissions:\n  contents: read\n', '') },
			}),
		);
		// Once at the workflow (GITHUB_TOKEN takes the repository default)
		// and once at the job that inherits the absence.
		assert.deepEqual(rulesOf(audit), ['PERMISSIONS_MISSING', 'PERMISSIONS_MISSING']);
		assert.match(audit.findings[0].message, /GITHUB_TOKEN would take the repository default/);
	});

	it('rejects write-all at the workflow level', () => {
		const audit = auditTemp(
			makeRepo({ workflows: { 'ci.yml': withPermissions('permissions: write-all\n') } }),
		);
		assert.ok(rulesOf(audit).includes('PERMISSIONS_WRITE_ALL'));
	});

	it('rejects a write scope that the manifest does not allow-list', () => {
		const audit = auditTemp(
			makeRepo({ workflows: { 'ci.yml': withPermissions('permissions:\n  contents: write\n') } }),
		);
		assert.ok(rulesOf(audit).includes('PERMISSIONS_WRITE'));
		assert.match(
			audit.findings.find((f) => f.rule === 'PERMISSIONS_WRITE').message,
			/contents: write/,
		);
	});

	it('accepts an allow-listed write scope', () => {
		const manifest = {
			...BASE_MANIFEST,
			permissions: {
				default: 'contents: read',
				allow_writes: [
					{ scope: 'contents', workflow: '.github/workflows/ci.yml', reason: 'fixture' },
				],
			},
		};
		const audit = auditTemp(
			makeRepo({
				workflows: { 'ci.yml': withPermissions('permissions:\n  contents: write\n') },
				manifest,
			}),
			manifest,
		);
		assert.deepEqual(rulesOf(audit), []);
	});

	it('lets a job-level block override the workflow default', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'    runs-on: ubuntu-latest',
						'    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n      issues: write',
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(audit), ['PERMISSIONS_WRITE']);
		assert.match(audit.findings[0].message, /job "validate" requests issues: write/);
	});

	it('parses every documented permissions shape', () => {
		assert.deepEqual(parsePermissions(['  contents: read']), {
			mode: 'map',
			scopes: [{ scope: 'contents', level: 'read' }],
		});
		assert.deepEqual(parsePermissions(['read-all']), { mode: 'read-all', scopes: [] });
		assert.deepEqual(parsePermissions(['write-all']), { mode: 'write-all', scopes: [] });
		assert.deepEqual(parsePermissions(['{}']), { mode: 'none', scopes: [] });
		assert.deepEqual(parsePermissions(['{contents: read, issues: write}']), {
			mode: 'map',
			scopes: [
				{ scope: 'contents', level: 'read' },
				{ scope: 'issues', level: 'write' },
			],
		});
		assert.equal(parsePermissions(['not a mapping']).mode, 'invalid');
		// A YAML alias is valid YAML this scanner cannot resolve. It must
		// stay `invalid` so the caller fails closed instead of treating an
		// empty scope list as least privilege.
		assert.equal(parsePermissions(['*token']).mode, 'invalid');
	});

	it('reads a flow-mapping permissions block a job declares', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'    runs-on: ubuntu-latest',
						'    runs-on: ubuntu-latest\n    permissions: {contents: write}',
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(audit), ['PERMISSIONS_WRITE']);
		assert.match(audit.findings[0].message, /job "validate" requests contents: write/);
	});

	it('fails closed on a permissions shape it cannot resolve', () => {
		const jobAlias = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'    runs-on: ubuntu-latest',
						'    runs-on: ubuntu-latest\n    permissions: *token',
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(jobAlias), ['PERMISSIONS_UNPARSED']);
		assert.match(jobAlias.findings[0].message, /job "validate" declares an unreadable/);

		const workflowAlias = auditTemp(
			makeRepo({ workflows: { 'ci.yml': withPermissions('permissions: *token\n') } }),
		);
		// Once for the workflow block that declares it; the job that merely
		// inherits the unreadable value is not reported a second time.
		assert.deepEqual(rulesOf(workflowAlias), ['PERMISSIONS_UNPARSED']);
	});

	it('reads a job permissions block at any indentation', () => {
		const wide = [
			'name: ci',
			'on:',
			'  pull_request:',
			'permissions:',
			'  contents: read',
			'jobs:',
			'    validate:',
			'        runs-on: ubuntu-latest',
			'        permissions:',
			'            issues: write',
			'        steps:',
			`            - uses: actions/checkout@${CHECKOUT_SHA} # v4.4.0`,
			'',
		].join('\n');
		const audit = auditTemp(makeRepo({ workflows: { 'ci.yml': wide } }));
		assert.deepEqual(rulesOf(audit), ['PERMISSIONS_WRITE']);
		assert.match(audit.findings[0].message, /job "validate" requests issues: write/);
	});
});

describe('authority and secret-exposure rules', () => {
	const withOn = (block) => CLEAN_WORKFLOW.replace('on:\n  pull_request:\n', block);

	it('rejects an untrusted-code trigger', () => {
		for (const trigger of ['pull_request_target', 'workflow_run', 'issue_comment']) {
			const audit = auditTemp(
				makeRepo({ workflows: { 'ci.yml': withOn(`on:\n  ${trigger}:\n    types: [opened]\n`) } }),
			);
			assert.ok(rulesOf(audit).includes('AUTHZ_UNTRUSTED_TRIGGER'), trigger);
		}
	});

	it('rejects an untrusted-code trigger written in a compact form', () => {
		// Block form only would read these as "no triggers at all", which
		// is the one outcome the AUTHZ rules exist to prevent.
		for (const on of [
			'on: pull_request_target',
			"on: 'pull_request_target'",
			'on: [push, pull_request_target]',
			'on: [push, "workflow_run"]',
		]) {
			const audit = auditTemp(makeRepo({ workflows: { 'ci.yml': withOn(`${on}\n`) } }));
			assert.ok(rulesOf(audit).includes('AUTHZ_UNTRUSTED_TRIGGER'), on);
		}
	});

	it('fails closed when the `on:` value is a shape it cannot resolve', () => {
		const audit = auditTemp(makeRepo({ workflows: { 'ci.yml': withOn('on: *events\n') } }));
		assert.deepEqual(rulesOf(audit), ['AUTHZ_TRIGGER_UNPARSED']);
		assert.match(audit.findings[0].message, /unreadable `on:` entry/);
	});

	it('rejects a production deploy but allows the dry-run gate', () => {
		const withRun = (run) =>
			auditTemp(
				makeRepo({
					workflows: {
						'ci.yml': CLEAN_WORKFLOW.replace('- uses:', `- run: ${run}\n      - uses:`),
					},
				}),
			);
		assert.ok(rulesOf(withRun('pnpm run deploy:production')).includes('AUTHZ_PRODUCTION_DEPLOY'));
		assert.ok(
			rulesOf(withRun('pnpm exec wrangler deploy --dry-run')).includes(
				'AUTHZ_PRODUCTION_DEPLOY',
			) === false,
		);
		assert.ok(
			rulesOf(withRun('pnpm run deploy:cf:prebuilt:dry-run')).includes(
				'AUTHZ_PRODUCTION_DEPLOY',
			) === false,
		);
		assert.ok(
			rulesOf(withRun('pnpm exec cf deploy --prebuilt --dry-run')).includes(
				'AUTHZ_PRODUCTION_DEPLOY',
			) === false,
		);
	});

	it('rejects a GitHub Release publish from Actions', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'- uses:',
						'- run: gh release create v9.9.9\n      - uses:',
					),
				},
			}),
		);
		assert.ok(rulesOf(audit).includes('AUTHZ_RELEASE_PUBLISH'));
	});

	it('rejects every value-listing shape from AGENTS.md §4', () => {
		const runs = [
			'infisical secrets --env=prod --path=/',
			'infisical secrets get BETTER_AUTH_SECRET --plain',
			'wrangler secret list --format pretty',
			'printenv',
			'cat .dev.vars',
			'echo "$CLOUDFLARE_API_TOKEN"',
			'set -x; pnpm run deploy:production:prepared',
		];
		for (const run of runs) {
			const audit = auditTemp(
				makeRepo({
					workflows: {
						'ci.yml': CLEAN_WORKFLOW.replace('- uses:', `- run: ${run}\n      - uses:`),
					},
				}),
			);
			assert.ok(rulesOf(audit).includes('SECRET_VALUE_ACCESS'), run);
		}
	});

	it('rejects an unapproved repository secret reference', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'- uses:',
						'- run: echo "${{ secrets.CLOUDFLARE_API_TOKEN }}"\n      - uses:',
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(audit).includes('SECRET_REFERENCE'), true);
		assert.match(
			audit.findings.find((f) => f.rule === 'SECRET_REFERENCE').message,
			/secrets\.CLOUDFLARE_API_TOKEN is not approved/,
		);
	});

	it('rejects the index form of an unapproved secret reference', () => {
		// `${{ secrets['NAME'] }}` is accepted by actionlint and reaches the
		// same repository secret as the dot form.
		const withSecret = (expression) =>
			auditTemp(
				makeRepo({
					workflows: {
						'ci.yml': CLEAN_WORKFLOW.replace(
							'- uses:',
							// `\${{` is the GitHub expression opener, escaped
							// so JS does not read it as an interpolation.
							`- run: echo "\${{ ${expression} }}"\n      - uses:`,
						),
					},
				}),
			);
		const audit = withSecret("secrets['CLOUDFLARE_API_TOKEN']");
		assert.ok(rulesOf(audit).includes('SECRET_REFERENCE'));
		assert.match(
			audit.findings.find((f) => f.rule === 'SECRET_REFERENCE').message,
			/secrets\['CLOUDFLARE_API_TOKEN'\] is not approved/,
		);
		assert.ok(rulesOf(withSecret('secrets.CLOUDFLARE_API_TOKEN')).includes('SECRET_REFERENCE'));
	});

	it('accepts an approved secret reference in either expression form', () => {
		const manifest = {
			...BASE_MANIFEST,
			secrets: {
				allow_references: [{ name: 'CLOUDFLARE_API_TOKEN', workflow: 'ci.yml', reason: 'fixture' }],
			},
		};
		for (const expression of ['secrets.CLOUDFLARE_API_TOKEN', "secrets['CLOUDFLARE_API_TOKEN']"]) {
			const audit = auditTemp(
				makeRepo({
					workflows: {
						'ci.yml': CLEAN_WORKFLOW.replace(
							'- uses:',
							`- run: echo "\${{ ${expression} }}"\n      - uses:`,
						),
					},
					manifest,
				}),
				manifest,
			);
			assert.deepEqual(rulesOf(audit), [], expression);
		}
	});

	it('ignores a denied pattern that only appears in a comment', () => {
		const audit = auditTemp(
			makeRepo({
				workflows: {
					'ci.yml': CLEAN_WORKFLOW.replace(
						'name: ci',
						'# never run printenv or infisical secrets here\nname: ci',
					),
				},
			}),
		);
		assert.deepEqual(rulesOf(audit), []);
	});
});

describe('exceptions', () => {
	it('waives exactly the named rule and target, and stays visible', () => {
		const manifest = {
			...BASE_MANIFEST,
			exceptions: [
				{
					rule: 'PIN_NOT_SHA',
					target: '.github/workflows/ci.yml',
					reason: 'fixture waiver',
					review_issue: 472,
				},
			],
		};
		const audit = auditTemp(
			makeRepo({
				workflows: { 'ci.yml': CLEAN_WORKFLOW.replace(CHECKOUT_SHA, 'v4') },
				manifest,
			}),
			manifest,
		);
		assert.deepEqual(audit.findings, []);
		assert.equal(audit.waivers.length, 1);
		assert.equal(audit.waivers[0].rule, 'PIN_NOT_SHA');
		assert.match(renderTextReport(audit), /waived: .*\[PIN_NOT_SHA\] — fixture waiver/);
	});

	it('does not let a waiver for one rule silence another', () => {
		const manifest = {
			...BASE_MANIFEST,
			exceptions: [
				{ rule: 'PIN_NOT_SHA', target: '.github/workflows/ci.yml', reason: 'fixture waiver' },
			],
		};
		const audit = auditTemp(
			makeRepo({ workflows: { 'ci.yml': CLEAN_WORKFLOW.replace(' # v4.4.0', '') }, manifest }),
			manifest,
		);
		assert.deepEqual(rulesOf(audit), ['PIN_MISSING_REF_COMMENT']);
	});
});

describe('manifest parsing', () => {
	it('rejects malformed input instead of returning an empty allow-list', () => {
		assert.throws(() => parseManifest('not json'), /not valid JSON/);
		assert.throws(() => parseManifest('[]'), /must be a JSON object/);
		assert.throws(
			() => parseManifest(JSON.stringify({ schema_version: 2 })),
			/schema_version must be 1/,
		);
		assert.throws(
			() => parseManifest(JSON.stringify({ schema_version: 1 })),
			/actions must be an object/,
		);
		assert.throws(
			() =>
				parseManifest(
					JSON.stringify({
						schema_version: 1,
						actions: {
							'actions/checkout': { sha: 'v4', ref: 'v4', repository: 'https://github.com/x/y' },
						},
					}),
				),
			/sha must be a 40-char commit SHA/,
		);
		assert.throws(
			() =>
				parseManifest(
					JSON.stringify({
						schema_version: 1,
						actions: {
							'actions/checkout': { sha: CHECKOUT_SHA, ref: 'v4', repository: 'http://x' },
						},
					}),
				),
			/repository must be the https:\/\/github\.com\/ source URL/,
		);
		assert.throws(
			() =>
				parseManifest(
					JSON.stringify({
						schema_version: 1,
						actions: {},
						exceptions: [{ rule: 'NOT_A_RULE', target: 'x', reason: 'y' }],
					}),
				),
			/is not a known rule/,
		);
	});

	it('audits a manifest object that never declared `exceptions`', () => {
		// `parseManifest` treats the key as optional, so an importer of
		// `auditWorkflows` (the report generator) must not crash on it.
		const withoutExceptions = {
			schema_version: 1,
			actions: BASE_MANIFEST.actions,
			permissions: BASE_MANIFEST.permissions,
			secrets: BASE_MANIFEST.secrets,
		};
		assert.deepEqual(
			parseManifest(JSON.stringify(withoutExceptions)).exceptions,
			[],
			'parseManifest normalises the optional key',
		);
		const dir = makeRepo({ workflows: { 'ci.yml': CLEAN_WORKFLOW } });
		const audit = auditWorkflows({
			workflowsDir: join(dir, '.github', 'workflows'),
			manifest: withoutExceptions,
		});
		assert.deepEqual(rulesOf(audit), []);
		assert.equal(audit.summary.status, 'PASS');
	});

	it('documents every rule it can report', () => {
		for (const rule of [
			'PIN_NOT_SHA',
			'PIN_MISSING_REF_COMMENT',
			'PIN_REF_COMMENT_MISMATCH',
			'PIN_UNKNOWN_ACTION',
			'PIN_SHA_MISMATCH',
			'PIN_UNUSED_MANIFEST_ENTRY',
			'PERMISSIONS_MISSING',
			'PERMISSIONS_UNPARSED',
			'PERMISSIONS_WRITE',
			'PERMISSIONS_WRITE_ALL',
			'SECRET_REFERENCE',
			'SECRET_VALUE_ACCESS',
			'AUTHZ_UNTRUSTED_TRIGGER',
			'AUTHZ_TRIGGER_UNPARSED',
			'AUTHZ_PRODUCTION_DEPLOY',
			'AUTHZ_RELEASE_PUBLISH',
		]) {
			assert.ok(RULES[rule], rule);
		}
	});
});

describe('parsing helpers', () => {
	it('splits a uses value from its ref comment', () => {
		assert.deepEqual(splitUsesValue(`actions/checkout@${CHECKOUT_SHA} # v4.4.0`), {
			uses: `actions/checkout@${CHECKOUT_SHA}`,
			refComment: 'v4.4.0',
		});
		assert.deepEqual(splitUsesValue('actions/checkout@v4'), {
			uses: 'actions/checkout@v4',
			refComment: null,
		});
	});

	it('separates the action from the ref', () => {
		assert.deepEqual(externalActionRef(`actions/checkout@${CHECKOUT_SHA}`), {
			repo: 'actions/checkout',
			ref: CHECKOUT_SHA,
		});
		assert.equal(externalActionRef('./.github/actions/setup'), null);
		assert.equal(externalActionRef('docker://alpine@sha256:x'), null);
	});

	it('attributes a use to the job that declares it', () => {
		const workflow = parseWorkflow(
			[
				'name: ci',
				'permissions: {contents: read}',
				'jobs:',
				'  first:',
				'    steps:',
				'      - uses: a/b@v1',
				'  second:',
				'    steps:',
				'      - uses: c/d@v2',
			].join('\n'),
			'ci.yml',
		);
		assert.deepEqual(
			workflow.uses.map((use) => use.job),
			['first', 'second'],
		);
	});
});

describe('committed abnormal fixture', () => {
	it('stays outside .github/workflows so GitHub never runs it', () => {
		const fixturePath = resolve(FIXTURE_DIR);
		assert.ok(!fixturePath.startsWith(`${resolve(ROOT, '.github', 'workflows')}/`));
		// No shipped workflow may reach the fixture's shape, so the
		// "abnormal" evidence can never leak into a real workflow.
		const shipped = readdirSync(join(ROOT, '.github', 'workflows'))
			.map((name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8'))
			.join('\n');
		assert.ok(!shipped.includes('pull_request_target'));
		assert.ok(!shipped.includes('fixture-legacy-actions'));
		assert.ok(!shipped.includes('write-all'));
		// And no real credential name may appear in the fixture.
		const fixtureManifest = readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8');
		assert.doesNotMatch(fixtureManifest, /CLOUDFLARE_API_TOKEN|BETTER_AUTH_SECRET/);
		assert.doesNotMatch(
			readFileSync(join(FIXTURE_DIR, 'legacy-actions.yml'), 'utf8'),
			/secrets\.(?!FIXTURE_ONLY_TOKEN)/,
		);
	});

	it('fails with the documented rule set', () => {
		const audit = auditWorkflows({
			workflowsDir: FIXTURE_DIR,
			manifest: parseManifest(readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8')),
		});
		assert.equal(audit.summary.status, 'FAIL');
		assert.deepEqual(rulesOf(audit), [
			'AUTHZ_PRODUCTION_DEPLOY',
			'AUTHZ_RELEASE_PUBLISH',
			'AUTHZ_UNTRUSTED_TRIGGER',
			'PERMISSIONS_WRITE',
			'PERMISSIONS_WRITE',
			'PERMISSIONS_WRITE_ALL',
			'PIN_MISSING_REF_COMMENT',
			'PIN_NOT_SHA',
			'PIN_NOT_SHA',
			'SECRET_REFERENCE',
			'SECRET_VALUE_ACCESS',
			'SECRET_VALUE_ACCESS',
		]);
		// The one correct row still resolves, so the fixture also proves the
		// gate is not simply "everything fails".
		assert.deepEqual(
			audit.pins.map((pin) => `${pin.repo}@${pin.ref}`),
			['actions/checkout@v4.4.0'],
		);
	});
});

describe('cli', () => {
	const run = (args, cwd = ROOT) => {
		try {
			const stdout = execFileSync('node', [SCRIPT, ...args], {
				cwd,
				encoding: 'utf8',
				stdio: 'pipe',
			});
			return { code: 0, stdout, stderr: '' };
		} catch (error) {
			return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
		}
	};

	it('exits 0 on a passing audit and prints it on stdout', () => {
		const result = run([]);
		assert.equal(result.code, 0);
		assert.match(result.stdout, /status: PASS/);
	});

	it('exits 1 with findings on stderr', () => {
		const result = run([
			`--manifest=${join(FIXTURE_DIR, 'manifest.json')}`,
			`--workflows-dir=${FIXTURE_DIR}`,
		]);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /status: FAIL/);
	});

	it('prints machine-readable JSON without the raw workflow text', () => {
		const result = run(['--json']);
		assert.equal(result.code, 0);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.summary.status, 'PASS');
		assert.equal(parsed.summary.pins, 13);
		// A Set serialises to `{}`, which would make the machine-readable
		// output look like it referenced nothing.
		assert.deepEqual(parsed.referenced, [
			'actions/cache',
			'actions/checkout',
			'actions/setup-node',
			'actions/upload-artifact',
			'oven-sh/setup-bun',
			'pnpm/action-setup',
		]);
		assert.equal('lines' in parsed.workflows[0], false);
	});

	it('exits 2 on bad input', () => {
		assert.equal(run(['--nope']).code, 2);
		const dir = mkdtempSync(join(tmpdir(), 'workflow-pins-bad-'));
		writeFileSync(join(dir, 'bad.json'), '{');
		assert.equal(run([`--manifest=${join(dir, 'bad.json')}`]).code, 2);
		assert.equal(run([`--manifest=${join(dir, 'missing.json')}`]).code, 2);
		rmSync(dir, { recursive: true, force: true });
	});
});
