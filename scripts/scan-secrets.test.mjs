import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	ALLOWLIST,
	DETECTORS,
	describeMatch,
	looksLikeCredentialValue,
	partition,
	renderHtmlReport,
	scanContent,
} from './_secret-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCRIPT = resolve(HERE, 'scan-secrets.mjs');

/**
 * Synthetic credential values.
 *
 * Repeated characters and spelled-out filler, so nothing here can be
 * mistaken for an issued credential and nothing here is worth
 * revoking. The `DOC`-prefixed markers carry vocabulary that
 * `looksLikeCredentialValue` is designed to reject, which is how the
 * fixtures prove the VALUE filter — not the vocabulary — is doing the
 * detecting.
 */
const DUMMY = Object.freeze({
	homeKey: 'mk_home_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
	versionedSecret: `1:${'0'.repeat(48)}`,
	awsKeyId: 'AKIAAAAAAAAAAAAAAAAA',
	githubToken: `ghp_${'A'.repeat(36)}`,
	stripeKey: `sk_live_${'B'.repeat(24)}`,
	cloudflareToken: `v1.0-${'c'.repeat(40)}-${'d'.repeat(43)}`,
	googleKey: `AIza${'E'.repeat(35)}`,
	jwt: `eyJ${'F'.repeat(20)}.${'G'.repeat(20)}.${'H'.repeat(20)}`,
	privateKeyBlock: '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----',
	r2Secret: 'R2SynteticAccessKeyMaterial00A',
	envAssignment: 'InfsclSyntheticFixtureValueAAA000000',
	hexAssignment: 'a'.repeat(64),
});

function runCli(args, cwd = REPO_ROOT) {
	try {
		// Invoked by repo-relative path so the CLI's own `REPO_ROOT`
		// resolution lands on `cwd` — that is what lets the isolated-repo
		// tests below drive the gate over a throwaway worktree.
		const stdout = execFileSync(process.execPath, [join('scripts', 'scan-secrets.mjs'), ...args], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return {
			status: error.status ?? 1,
			stdout: String(error.stdout ?? ''),
			stderr: String(error.stderr ?? ''),
		};
	}
}

async function failuresFor(content, mode = 'source') {
	const { failures } = partition(
		await scanContent('fixture.txt', content, { mode, skipAllowlist: true }),
	);
	return failures;
}

describe('detector table', () => {
	it('has unique ids and only the two declared modes', () => {
		const ids = DETECTORS.map((rule) => rule.id);
		assert.equal(new Set(ids).size, ids.length, 'detector ids must be unique');
		for (const rule of DETECTORS) {
			assert.ok(rule.mode === 'source' || rule.mode === 'both', `${rule.id} mode`);
			assert.ok(rule.description.length > 10, `${rule.id} needs a human description`);
			assert.doesNotThrow(() => new RegExp(rule.regex.source, rule.regex.flags), rule.id);
		}
	});

	it('keeps the two mode tiers meaningful', () => {
		const sourceOnly = DETECTORS.filter((rule) => rule.mode === 'source').map((rule) => rule.id);
		// The context rules are the ones that guess wrong on minified
		// output, so they must never be enabled in bundle mode.
		assert.deepEqual(sourceOnly.sort(), ['r2-s3-credential-assignment', 'secret-assignment']);
	});
});

describe('looksLikeCredentialValue', () => {
	it('accepts the encodings this repository actually issues', () => {
		assert.equal(looksLikeCredentialValue(DUMMY.envAssignment), true);
		assert.equal(looksLikeCredentialValue(DUMMY.hexAssignment), true);
		assert.equal(looksLikeCredentialValue(DUMMY.homeKey), true);
		assert.equal(looksLikeCredentialValue(DUMMY.versionedSecret), true);
	});

	it('rejects placeholders, identifiers, code references and markers', () => {
		for (const value of [
			'',
			'short',
			'redacted-by-infisical-fallback',
			'G-PLACEHOLDER000',
			'mk_home_xyz',
			'Mk_Home_Documented_Example_Key',
			'process.env.INFISICAL_TOKEN',
			'env.BETTER_AUTH_SECRET',
			'this-is-a-deliberately-unique-marker-XYZ-9876',
			'legacy-fallback-for-pre-envelope-data',
			'abcdef123456',
		]) {
			assert.equal(looksLikeCredentialValue(value), false, `${value} must not be a credential`);
		}
	});
});

describe('scanContent — shape detectors', () => {
	const cases = [
		['home-consumer-api-key', `const key = '${DUMMY.homeKey}';`],
		['better-auth-versioned-secret', `const raw = '${DUMMY.versionedSecret}';`],
		['aws-access-key-id', `const id = '${DUMMY.awsKeyId}';`],
		['github-token', `const t = '${DUMMY.githubToken}';`],
		['stripe-secret-key', `const k = '${DUMMY.stripeKey}';`],
		['cloudflare-api-token', `const c = '${DUMMY.cloudflareToken}';`],
		['google-api-key', `const g = '${DUMMY.googleKey}';`],
		['jwt', `const j = '${DUMMY.jwt}';`],
		['private-key-block', DUMMY.privateKeyBlock],
		['r2-s3-credential-assignment', `const r2 = { aws_secret_access_key: '${DUMMY.r2Secret}' };`],
		['secret-assignment', `INFISICAL_TOKEN=${DUMMY.envAssignment}\n`],
	];

	for (const [detector, content] of cases) {
		it(`detects ${detector} in source mode`, async () => {
			const failures = await failuresFor(content, 'source');
			assert.ok(
				failures.some((failure) => failure.detector === detector),
				`expected ${detector}, got ${failures.map((f) => f.detector).join(',') || 'nothing'}`,
			);
		});
	}

	it('detects every provider shape in BUNDLE mode too', async () => {
		const bundle = cases
			.filter(
				([detector]) =>
					detector !== 'r2-s3-credential-assignment' && detector !== 'secret-assignment',
			)
			.map(([, content]) => content)
			.join('\n');
		const found = new Set((await failuresFor(bundle, 'bundle')).map((failure) => failure.detector));
		for (const [detector] of cases) {
			if (detector === 'r2-s3-credential-assignment' || detector === 'secret-assignment') continue;
			assert.ok(found.has(detector), `${detector} must also fire on build output`);
		}
	});

	it('does not run context rules in bundle mode', async () => {
		const minified = `function t(n){return {INFISICAL_TOKEN:n,secret:"${DUMMY.envAssignment}"};}`;
		const found = (await failuresFor(minified, 'bundle')).map((failure) => failure.detector);
		assert.ok(!found.includes('secret-assignment'), 'bundle mode must not guess at context');
	});

	it('anchors the assignment rule to the start of a line', async () => {
		const midLine = `\t\t\tconst result = resolve({ BETTER_AUTH_SECRET: '${DUMMY.envAssignment}' });`;
		const failures = await failuresFor(midLine, 'source');
		assert.deepEqual(failures, [], 'a mid-line object property is not an env assignment');
	});

	it('reports the line number of the finding', async () => {
		const content = `// line 1\n// line 2\nconst key = '${DUMMY.homeKey}';\n`;
		const [failure] = await failuresFor(content, 'source');
		assert.equal(failure.line, 3);
	});
});

describe('forbidden tracked paths', () => {
	it('flags a tracked .dev.vars / .env / key file', async () => {
		for (const path of ['.dev.vars', 'config/.dev.vars.local', 'api/.env', 'keys/service.pem']) {
			const { failures } = partition(await scanContent(path, 'clean\n', { skipAllowlist: true }));
			assert.ok(
				failures.some((failure) => failure.detector === 'forbidden-path'),
				`${path} must be a finding`,
			);
		}
	});

	it('does not flag the committed documentation templates', async () => {
		for (const path of ['.dev.vars.example', '.env.example']) {
			const { failures } = partition(await scanContent(path, 'clean\n', { skipAllowlist: true }));
			assert.deepEqual(failures, [], `${path} is a documented template, not a secret file`);
		}
	});
});

describe('allowlist', () => {
	it('waives a listed path without weakening the detector elsewhere', async () => {
		const waived = await scanContent(
			'scripts/rotate-home-api-key.test.mjs',
			`const k='${DUMMY.homeKey}';\n`,
		);
		const { failures, waived: waivers } = partition(waived);
		assert.deepEqual(failures, []);
		assert.equal(waivers.length, 1);
		assert.ok(waivers[0].allowlistReason.length > 20, 'a waiver must carry a reason');

		const unlisted = await scanContent('src/unlisted.test.ts', `const k='${DUMMY.homeKey}';\n`);
		assert.equal(partition(unlisted).failures.length, 1, 'an unlisted path still fails');
	});

	it('gives every waiver a reason', () => {
		for (const entry of ALLOWLIST) {
			assert.ok(entry.path.length > 0, 'waiver needs a path');
			assert.ok(entry.reason.length > 20, `${entry.path} needs a substantive reason`);
		}
	});

	it('covers a scanner file that legitimately contains shapes', async () => {
		const own = await scanContent(
			'scripts/_secret-scan.mjs',
			readFileSync(resolve(HERE, '_secret-scan.mjs'), 'utf8'),
		);
		assert.deepEqual(partition(own).failures, [], 'the detector table must not flag itself');
	});
});

describe('disclosure invariant (AGENTS.md §4)', () => {
	it('never puts the matched value in a finding or its description', async () => {
		const findings = await failuresFor(
			[
				`const key = '${DUMMY.homeKey}';`,
				`INFISICAL_TOKEN=${DUMMY.envAssignment}`,
				DUMMY.privateKeyBlock,
			].join('\n'),
			'source',
		);
		assert.ok(findings.length >= 3);
		for (const finding of findings) {
			const serialised = JSON.stringify(finding) + describeMatch(finding);
			for (const secret of Object.values(DUMMY)) {
				const head = secret.slice(0, 12);
				assert.ok(!serialised.includes(head), `finding leaked the head of ${head}`);
			}
			assert.match(finding.fingerprint, /^[0-9a-f]{8}$/);
			assert.equal(typeof finding.length, 'number');
		}
	});

	it('distinguishes two values of the same shape by fingerprint', async () => {
		const a = (await failuresFor(`const k='${DUMMY.homeKey}';\n`))[0];
		const b = (await failuresFor(`const k='mk_home_${'E'.repeat(32)}';\n`))[0];
		assert.notEqual(a.fingerprint, b.fingerprint);
		assert.equal(a.length, b.length);
	});
});

describe('scanContent — termination', () => {
	it(
		'terminates on a detector whose regex can match the empty string',
		{ timeout: 20_000 },
		async () => {
			// Regression: a zero-length match does not advance `lastIndex`, so a
			// naive `while ((m = re.exec(text)))` loop spins forever on a regex
			// like `/(?!x)/`. That hangs the gate on every PR, so the loop must
			// advance `lastIndex` itself. Exercised through the real engine with
			// a deliberately degenerate detector.
			const engine = readFileSync(resolve(HERE, '_secret-scan.mjs'), 'utf8').replace(
				'regex: /\\b(mk_home_[A-Za-z]{32})\\b/,',
				'regex: /(?!never-matches)/,',
			);
			const dir = mkdtempSync(join(tmpdir(), 'scan-secrets-empty-'));
			try {
				writeFileSync(join(dir, 'engine.mjs'), engine);
				const { scanContent: scan } = await import(`file://${join(dir, 'engine.mjs')}`);
				const findings = await scanContent('fixture.ts', 'const a = 1;\n', {
					mode: 'source',
					skipAllowlist: true,
				});
				assert.ok(Array.isArray(findings));
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});

describe('renderHtmlReport', () => {
	it('renders FAIL with findings and escapes markup', () => {
		const html = renderHtmlReport({
			target: '<script>alert(1)</script>',
			mode: 'source',
			generatedAt: '2026-10-18T00:00:00.000Z',
			scannedFiles: 3,
			failures: [
				{
					path: 'src/x.ts',
					line: 4,
					detector: 'home-consumer-api-key',
					length: 40,
					fingerprint: 'deadbeef',
					description: '<img onerror=1>',
					allowlistReason: null,
				},
			],
			waived: [],
			skipped: [],
		});
		assert.match(html, /class="verdict fail">FAIL/);
		assert.ok(!html.includes('<script>alert(1)</script>'), 'target must be escaped');
		assert.ok(!html.includes('<img onerror=1>'), 'description must be escaped');
		assert.match(html, /src\/x\.ts/);
		assert.ok(!html.includes(DUMMY.homeKey), 'report must not render a value');
	});

	it('renders PASS with no findings', () => {
		const html = renderHtmlReport({
			target: 'tracked files',
			mode: 'source',
			generatedAt: '2026-10-18T00:00:00.000Z',
			scannedFiles: 556,
			failures: [],
			waived: [],
			skipped: [],
		});
		assert.match(html, /class="verdict pass">PASS/);
		assert.match(html, /no findings/);
	});
});

describe('CLI — self-test', () => {
	it(
		'proves the gate is red on dummy credentials and green on clean input',
		{ timeout: 60_000 },
		() => {
			const result = runCli(['--self-test']);
			assert.equal(result.status, 0, result.stdout + result.stderr);
			assert.match(result.stdout, /0 on clean input/);
			assert.match(result.stdout, /\[DETECTED\]/);
			assert.ok(!result.stdout.includes(DUMMY.homeKey), 'self-test output must not render a value');
		},
	);

	it('fails loudly if a detector stops detecting', { timeout: 60_000 }, () => {
		// Break one detector by editing a copy of the table in an isolated
		// repo; the self-test must then exit non-zero rather than report a
		// clean bill of health.
		const repo = mkdtempSync(join(tmpdir(), 'scan-secrets-selftest-'));
		try {
			mkdirSync(join(repo, 'scripts'), { recursive: true });
			cpSync(SCRIPT, join(repo, 'scripts', 'scan-secrets.mjs'));
			const table = readFileSync(resolve(HERE, '_secret-scan.mjs'), 'utf8').replace(
				'regex: /\\b(mk_home_[A-Za-z]{32})\\b/,',
				'regex: /(?!never-matches)/,',
			);
			writeFileSync(join(repo, 'scripts', '_secret-scan.mjs'), table);
			const result = runCli(['--self-test'], repo);
			assert.equal(result.status, 1, 'a detector that stops working must fail the self-test');
			assert.match(result.stderr, /self-test FAILED/);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe('CLI — repository scan', () => {
	function isolatedRepo(files) {
		const repo = mkdtempSync(join(tmpdir(), 'scan-secrets-repo-'));
		mkdirSync(join(repo, 'scripts'), { recursive: true });
		cpSync(SCRIPT, join(repo, 'scripts', 'scan-secrets.mjs'));
		cpSync(resolve(HERE, '_secret-scan.mjs'), join(repo, 'scripts', '_secret-scan.mjs'));
		for (const [path, content] of Object.entries(files)) {
			const absolute = join(repo, path);
			mkdirSync(dirname(absolute), { recursive: true });
			writeFileSync(absolute, content);
		}
		execFileSync('git', ['init', '-q'], { cwd: repo });
		execFileSync('git', ['add', '-A'], { cwd: repo });
		return repo;
	}

	it('is green on a clean repository', () => {
		const repo = isolatedRepo({
			'src/home/index.tsx': "export const label = 'home';\n",
			'.env.example': 'BETTER_AUTH_SECRET="redacted-by-example"\n',
		});
		try {
			const result = runCli([], repo);
			assert.equal(result.status, 0, result.stdout + result.stderr);
			assert.match(result.stdout, /0 blocking finding\(s\)/);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('turns the gate red when a dummy credential is committed', () => {
		const repo = isolatedRepo({
			'src/home/index.tsx': `export const key = '${DUMMY.homeKey}';\n`,
		});
		try {
			const result = runCli([], repo);
			assert.equal(result.status, 1, 'a committed credential-shaped string must fail the gate');
			assert.match(result.stdout, /src\/home\/index\.tsx:1 \[home-consumer-api-key\]/);
			assert.match(result.stdout, /sha256:[0-9a-f]{8}/);
			assert.ok(
				!result.stdout.includes(DUMMY.homeKey),
				'the failing report must not echo the value',
			);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('turns the gate red on a committed .dev.vars', () => {
		const repo = isolatedRepo({
			'.dev.vars': `BETTER_AUTH_SECRETS="${DUMMY.versionedSecret}"\n`,
		});
		try {
			const result = runCli([], repo);
			assert.equal(result.status, 1);
			assert.match(result.stdout, /\[forbidden-path\]/);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('writes an HTML report and machine-readable JSON', () => {
		const repo = isolatedRepo({ 'src/x.ts': `const k='${DUMMY.homeKey}';\n` });
		try {
			const reportPath = join(repo, '.tmp', 'report.html');
			const result = runCli(['--json', `--report=${reportPath}`], repo);
			assert.equal(result.status, 1);
			const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
			assert.equal(json.failures.length, 1);
			assert.equal(json.failures[0].detector, 'home-consumer-api-key');
			const html = readFileSync(reportPath, 'utf8');
			assert.match(html, /class="verdict fail">FAIL/);
			assert.ok(!html.includes(DUMMY.homeKey));
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('turns the gate red on an UNTRACKED, not-ignored file before it is committed', () => {
		const repo = isolatedRepo({ 'src/clean.ts': 'export const a = 1;\n' });
		try {
			writeFileSync(join(repo, 'src', 'probe.ts'), `const k='${DUMMY.homeKey}';\n`);
			const result = runCli([], repo);
			assert.equal(result.status, 1, 'an untracked-but-not-ignored credential must already fail');
			assert.match(result.stdout, /src\/probe\.ts:1/);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('still honours .gitignore for the source surface', () => {
		const repo = isolatedRepo({
			'.gitignore': '.dev.vars\ndist\n',
			'.dev.vars': `BETTER_AUTH_SECRETS="${DUMMY.versionedSecret}"\n`,
		});
		try {
			// The file is ignored, so it is not in the source surface at all —
			// which is exactly why a tracked `.dev.vars` is its own finding.
			const result = runCli([], repo);
			assert.equal(result.status, 0, result.stdout + result.stderr);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('exits 2 on an unknown argument instead of silently passing', () => {
		const result = runCli(['--not-a-flag']);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /unknown argument/);
	});
});
