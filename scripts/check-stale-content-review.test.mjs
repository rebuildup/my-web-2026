import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CLASSIFICATIONS,
	DIMENSIONS,
	FIXTURE_DIR,
	REGISTRY_PATH,
	collectSegments,
	daysBetween,
	detectLocale,
	detectTimeTokens,
	evaluateRegistry,
	provenanceState,
	validateRegistry,
} from './check-stale-content-review.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-stale-content-review.mjs');
const FIXTURE_ROOT = join(REPO_ROOT, FIXTURE_DIR);
const FIXTURE_REGISTRY = `${FIXTURE_DIR}/registry.json`;
const FIXTURE_SURFACES = `${FIXTURE_DIR}/surfaces.json`;
const TODAY = '2026-10-22';

/**
 * Fixture coverage for the stale public copy review-date gate
 * (Issue #437).
 *
 * The gate's whole value is that an expression nobody has read for a
 * while is reported instead of quietly shipped. The suite therefore
 * pins three things:
 *
 *   1. the **detector's precision** — a token inside a longer word is
 *      not a time claim, and a noisy detector would make the registry
 *      unreviewable;
 *   2. the **four classifications**, including the property that a
 *      text edit invalidates the record (the edited sentence waits for
 *      a review again);
 *   3. the **invariants** — the gate reads only, it never declares a
 *      sentence untrue, and it fails closed (exit 2) when it cannot
 *      decide.
 */

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function runCli(args, { cwd = REPO_ROOT } = {}) {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
	}
}

function runFixtureCli(extra = [], { cwd = REPO_ROOT } = {}) {
	return runCli(
		[
			`--root=${FIXTURE_DIR}`,
			`--registry=${FIXTURE_REGISTRY}`,
			`--surfaces=${FIXTURE_SURFACES}`,
			`--today=${TODAY}`,
			...extra,
		],
		{ cwd },
	);
}

/** A hash of every file in a tree — the "the gate changed nothing" probe. */
function treeDigest(root) {
	const hash = createHash('sha256');
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			hash.update(relative(root, full));
			hash.update(readFileSync(full));
		}
	};
	walk(root);
	return hash.digest('hex');
}

const fixtureSurfaces = readJson(join(FIXTURE_ROOT, 'surfaces.json'));
const fixtureRegistry = readJson(join(FIXTURE_ROOT, 'registry.json'));

describe('check-stale-content-review — the detector stays precise', () => {
	it('does not read a time claim inside a longer word', () => {
		for (const text of ['現状', '応答', '実在', '実現在', '状現在']) {
			assert.equal(detectLocale(text), null, `"${text}" must not be read as a time claim`);
		}
	});

	it('does not read a fixed compound as a time claim', () => {
		// 最新鋭 is a fixed evaluative adjective, 今月 / 今年 / 今朝 / 今度
		// are calendar compounds, and 至今 is a fixed adverbial.
		for (const text of [
			'最新鋭の library',
			'今月の成果',
			'今年の計画',
			'今朝の会議',
			'今度のリリース',
			'至今の実績',
		]) {
			assert.equal(detectLocale(text), null, `"${text}" must not be read as a time claim`);
		}
	});

	it('reads the words that point at now', () => {
		for (const text of [
			'現在、公開作品はありません。',
			'今日 build した。',
			'最新の到達性。',
			'今、時間を割いています。',
			'現時点では受け付けていません。',
		]) {
			assert.equal(detectLocale(text), 'ja', `"${text}" must be read as a time claim`);
		}
	});

	it('matches the longest token once, so 今日 is not also 今', () => {
		const matches = detectTimeTokens('今日の font stack');
		assert.equal(matches.length, 1);
		assert.equal(matches[0].token, '今日');
	});

	it('gives a mixed segment the Japanese locale', () => {
		// `現在 / Today` carries both a Japanese and a Latin token; the
		// Japanese locale comes first because the corpus is Japanese.
		assert.equal(detectLocale('現在 / Today'), 'ja');
	});

	it('reads a Latin expression in its own locale', () => {
		assert.equal(detectLocale('Currently, no public work is listed here.'), 'en');
		assert.equal(detectLocale('the latest release'), 'en');
	});
});

describe('check-stale-content-review — the four classifications', () => {
	const { segments } = collectSegments(FIXTURE_ROOT, fixtureSurfaces, {
		excludedPaths: fixtureRegistry.excludedPaths ?? [],
		excludedExpressions: fixtureRegistry.excludedExpressions ?? [],
	});
	const result = evaluateRegistry({ segments, registry: fixtureRegistry, today: TODAY });

	it('collects every fixture expression', () => {
		assert.equal(result.entries.length, 5);
	});

	it('resolves each expression to its expected classification', () => {
		const byText = new Map(result.entries.map((entry) => [entry.text, entry]));
		assert.equal(byText.get('現在、公開されている作品はありません。').status, 'current');
		assert.equal(byText.get('最新の到達性を示しています。').status, 'stale');
		assert.equal(byText.get('現在利用できる contact channel はありません。').status, 'unrecorded');
		assert.equal(byText.get('今日の font stack はそのままです。').status, 'current');
		assert.equal(byText.get('Currently, no public work is listed here.').status, 'not-scanned');
	});

	it('uses only the four declared classifications', () => {
		for (const entry of result.entries) {
			assert.ok(CLASSIFICATIONS.includes(entry.status), `unexpected status ${entry.status}`);
		}
	});

	it('keeps the two review dimensions apart', () => {
		const byText = new Map(result.entries.map((entry) => [entry.text, entry]));
		assert.equal(byText.get('現在、公開されている作品はありません。').record.dimension, 'prose');
		assert.equal(byText.get('今日の font stack はそのままです。').record.dimension, 'typography');
		for (const dimension of DIMENSIONS) {
			assert.ok(DIMENSIONS.includes(dimension));
		}
	});

	it('puts only the waiting expressions into the review queue', () => {
		assert.deepEqual(result.queue.map((entry) => entry.status).sort(), ['stale', 'unrecorded']);
	});

	it('exits 1 while the queue is not empty', () => {
		const result = runFixtureCli();
		assert.equal(result.status, 1);
	});
});

describe('check-stale-content-review — a text edit invalidates the record', () => {
	it('turns an edited expression into an unrecorded one', () => {
		const workdir = mkdtempSync(join(tmpdir(), 'stale-review-'));
		try {
			cpSync(FIXTURE_ROOT, workdir, { recursive: true });
			const page = join(workdir, 'src/fixture/page.tsx');
			// The leading tabs make the search string unique: the fixture's
			// header comment quotes the same sentence, and a comment is
			// never a segment.
			const edited = readFileSync(page, 'utf8').replace(
				"{'最新の到達性を示しています。'}",
				"{'最新の到達性を示しています（改訂）。'}",
			);
			writeFileSync(page, edited, 'utf8');

			const result = runCli(
				[
					`--root=${workdir}`,
					`--registry=${join(workdir, 'registry.json')}`,
					`--surfaces=${join(workdir, 'surfaces.json')}`,
					`--today=${TODAY}`,
					'--format=json',
				],
				{ cwd: workdir },
			);
			assert.equal(result.status, 1);
			const report = JSON.parse(result.stdout);
			const entry = report.entries.find((item) => item.text.includes('改訂'));
			assert.ok(entry, 'the edited expression must be reported');
			assert.equal(entry.status, 'unrecorded');
			assert.equal(entry.reviewedAt, null);
			// The old record no longer matches any text: it is reported
			// as an orphan instead of silently covering the new wording.
			const orphan = report.orphanRecords.find((record) => record.id === 'fixture-stale');
			assert.ok(orphan, 'the invalidated record must be reported as an orphan');
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});
});

describe('check-stale-content-review — the freshness window boundary', () => {
	const registry = {
		...fixtureRegistry,
		expressions: [
			{
				...fixtureRegistry.expressions[0],
				id: 'boundary',
				expression: '現在、公開されている作品はありません。',
				reviewedAt: '2026-07-24',
			},
		],
	};
	const { segments } = collectSegments(FIXTURE_ROOT, fixtureSurfaces, {
		excludedPaths: [],
		excludedExpressions: [],
	});

	it('counts the day inside the window as current', () => {
		const result = evaluateRegistry({ segments, registry, today: TODAY });
		const entry = result.entries.find(
			(item) => item.text === '現在、公開されている作品はありません。',
		);
		assert.equal(daysBetween('2026-07-24', TODAY), 90);
		assert.equal(entry.status, 'current');
	});

	it('counts the day outside the window as stale', () => {
		const later = {
			...registry,
			expressions: [{ ...registry.expressions[0], reviewedAt: '2026-07-23' }],
		};
		const result = evaluateRegistry({ segments, registry: later, today: TODAY });
		const entry = result.entries.find(
			(item) => item.text === '現在、公開されている作品はありません。',
		);
		assert.equal(daysBetween('2026-07-23', TODAY), 91);
		assert.equal(entry.status, 'stale');
	});
});

describe('check-stale-content-review — the gate never changes what is published', () => {
	it('leaves the scanned tree byte-identical', () => {
		const before = treeDigest(FIXTURE_ROOT);
		runFixtureCli();
		runFixtureCli(['--format=json']);
		assert.equal(treeDigest(FIXTURE_ROOT), before);
	});

	it('refuses to write a report inside src/', () => {
		const result = runCli(['--out=src/.stale-review-report.html']);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /refusing to write inside src\//);
	});

	it('never uses a verdict word that declares an expression untrue', () => {
		for (const format of ['text', 'json', 'html']) {
			const result = runFixtureCli([`--format=${format}`]);
			const output = `${result.stdout}${result.stderr}`.toLowerCase();
			for (const word of ['false', 'unpublish', 'outdated']) {
				assert.ok(!output.includes(word), `the ${format} report must not use the word "${word}"`);
			}
		}
	});

	it('calls the waiting expressions "review pending" in the human reports', () => {
		for (const format of ['text', 'html']) {
			const result = runFixtureCli([`--format=${format}`]);
			assert.match(result.stdout.toLowerCase(), /review pending/);
		}
	});

	it('says what the gate does not do', () => {
		const result = runFixtureCli();
		assert.match(result.stdout, /does not decide whether a sentence is correct/);
		assert.match(result.stdout, /does not remove a sentence from the publication/);
		assert.match(result.stdout, /does not propose a replacement wording/);
		assert.match(result.stdout, /does not publish anything/);
	});
});

describe('check-stale-content-review — fail closed', () => {
	it('exits 2 on a malformed registry', () => {
		const workdir = mkdtempSync(join(tmpdir(), 'stale-review-bad-'));
		try {
			cpSync(FIXTURE_ROOT, workdir, { recursive: true });
			writeFileSync(
				join(workdir, 'registry.json'),
				JSON.stringify({ ...fixtureRegistry, expressions: 'not-an-array' }, null, 2),
				'utf8',
			);
			const result = runCli(
				[
					`--root=${workdir}`,
					`--registry=${join(workdir, 'registry.json')}`,
					`--surfaces=${join(workdir, 'surfaces.json')}`,
					`--today=${TODAY}`,
				],
				{ cwd: workdir },
			);
			assert.equal(result.status, 2);
			assert.match(result.stderr, /cannot be read/);
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('exits 2 on an unparsable review date', () => {
		const { problems } = validateRegistry(
			{
				...fixtureRegistry,
				expressions: [{ ...fixtureRegistry.expressions[0], reviewedAt: '2026-13-40' }],
			},
			{ today: TODAY },
		);
		assert.ok(problems.some((problem) => problem.includes('reviewedAt')));
	});

	it('exits 2 on a review date in the future', () => {
		const { problems } = validateRegistry(
			{
				...fixtureRegistry,
				expressions: [{ ...fixtureRegistry.expressions[0], reviewedAt: '2026-10-23' }],
			},
			{ today: TODAY },
		);
		assert.ok(problems.some((problem) => problem.includes('later than today')));
	});

	it('exits 2 when the registry file is missing', () => {
		const result = runCli([`--registry=${FIXTURE_DIR}/does-not-exist.json`]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /not found/);
	});

	it('exits 2 on an unparsable --today', () => {
		const result = runCli(['--today=yesterday']);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--today must be an ISO date/);
	});
});

describe('check-stale-content-review — the locale is opt-in', () => {
	it('reports a locale that is not opted in and queues nothing for it', () => {
		const result = runFixtureCli(['--format=json']);
		const report = JSON.parse(result.stdout);
		assert.deepEqual(report.locales, ['ja']);
		assert.deepEqual(report.notScannedLocales, ['en']);
		const notScanned = report.entries.filter((entry) => entry.status === 'not-scanned');
		assert.equal(notScanned.length, 1);
		assert.ok(
			!report.queue.some((entry) => entry.locale === 'en' || entry.text.includes('Currently')),
			'a locale that is not opted in must not contribute a queue entry',
		);
	});

	it('scans a locale once the owner opts in', () => {
		const workdir = mkdtempSync(join(tmpdir(), 'stale-review-en-'));
		try {
			cpSync(FIXTURE_ROOT, workdir, { recursive: true });
			const registry = readJson(join(workdir, 'registry.json'));
			registry.locales = ['ja', 'en'];
			writeFileSync(join(workdir, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');
			const result = runCli(
				[
					`--root=${workdir}`,
					`--registry=${join(workdir, 'registry.json')}`,
					`--surfaces=${join(workdir, 'surfaces.json')}`,
					`--today=${TODAY}`,
					'--format=json',
				],
				{ cwd: workdir },
			);
			const report = JSON.parse(result.stdout);
			const entry = report.entries.find((item) => item.text.includes('Currently'));
			assert.equal(entry.locale, 'en');
			assert.equal(entry.status, 'unrecorded');
			assert.deepEqual(report.notScannedLocales, []);
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});
});

describe('check-stale-content-review — the shipped registry', () => {
	it('parses and validates', () => {
		const registry = readJson(join(REPO_ROOT, REGISTRY_PATH));
		const { problems } = validateRegistry(registry, { today: TODAY });
		assert.deepEqual(problems, []);
	});

	it('covers every scanned expression of the live tree', () => {
		const surfaces = readJson(join(REPO_ROOT, 'quality/copy-editorial-surfaces.json'));
		const registry = readJson(join(REPO_ROOT, REGISTRY_PATH));
		const { segments } = collectSegments(REPO_ROOT, surfaces, {
			excludedPaths: registry.excludedPaths ?? [],
			excludedExpressions: registry.excludedExpressions ?? [],
		});
		const result = evaluateRegistry({ segments, registry, today: TODAY });
		assert.deepEqual(result.queue, [], 'the shipped registry must have no waiting expression');
		assert.ok(result.entries.length > 0, 'the live tree must carry time-sensitive expressions');
	});

	it('carries a provenance on every record and reports the two populations', () => {
		const registry = readJson(join(REPO_ROOT, REGISTRY_PATH));
		for (const record of registry.expressions) {
			assert.ok(record.provenance, `${record.id} must carry a provenance`);
			assert.ok(['owner-review', 'agent-recorded', 'unverified'].includes(record.provenance.kind));
			assert.ok(['confirmed', 'unconfirmed'].includes(record.provenance.ownerConfirmation));
			if (record.provenance.kind === 'owner-review') {
				assert.ok(
					typeof record.provenance.reference === 'string' && record.provenance.reference.length > 0,
					`${record.id} claims an owner review and must name the artefact`,
				);
			}
		}
		const result = evaluateRegistry({ segments: [], registry, today: TODAY });
		assert.equal(result.provenanceSummary.records, registry.expressions.length);
		assert.equal(result.provenanceSummary.missingProvenance, 0);
		assert.equal(
			result.provenanceSummary.ownerConfirmed + result.provenanceSummary.awaitingConfirmation,
			result.provenanceSummary.records,
		);
	});
});

describe('check-stale-content-review — the provenance of a review record (Issue #720)', () => {
	it('separates an owner-confirmed record from one an automated side wrote', () => {
		const confirmed = provenanceState({
			provenance: {
				kind: 'owner-review',
				reference: 'https://github.com/rebuildup/my-web-2026/issues/437#issuecomment-1',
				recordedBy: 'rebuildup',
				ownerConfirmation: 'confirmed',
			},
		});
		assert.equal(confirmed.ownerConfirmed, true);
		assert.match(confirmed.label, /owner-confirmed/);

		const agent = provenanceState({
			provenance: {
				kind: 'agent-recorded',
				reference: null,
				recordedBy: 'agent',
				ownerConfirmation: 'unconfirmed',
			},
		});
		assert.equal(agent.ownerConfirmed, false);
		assert.match(agent.label, /awaiting owner confirmation/);

		const missing = provenanceState({});
		assert.equal(missing.ownerConfirmed, false);
		assert.match(missing.label, /no provenance recorded/);
	});

	it('never presents an unconfirmed record as an owner review', () => {
		const registry = readJson(join(REPO_ROOT, REGISTRY_PATH));
		const surfaces = readJson(join(REPO_ROOT, 'quality/copy-editorial-surfaces.json'));
		const { segments } = collectSegments(REPO_ROOT, surfaces, {
			excludedPaths: registry.excludedPaths ?? [],
			excludedExpressions: registry.excludedExpressions ?? [],
		});
		const result = evaluateRegistry({ segments, registry, today: TODAY });
		for (const entry of result.entries) {
			if (!entry.record) continue;
			const state = provenanceState(entry.record);
			if (!state.ownerConfirmed) {
				assert.match(state.label, /awaiting owner confirmation|no provenance recorded/);
			}
		}
	});

	it('reports the two populations in the human report', () => {
		const result = runFixtureCli();
		assert.equal(result.status, 1);
		assert.match(result.stdout, /owner-confirmed 0, awaiting owner confirmation 3/);
		assert.match(
			result.stdout,
			/owner confirmation: (awaiting owner confirmation|no provenance recorded)/,
		);
	});

	it('fails closed on a malformed provenance', () => {
		const { problems } = validateRegistry(
			{
				...fixtureRegistry,
				expressions: [
					{
						...fixtureRegistry.expressions[0],
						provenance: { kind: 'made-up', recordedBy: 42 },
					},
				],
			},
			{ today: TODAY },
		);
		assert.ok(problems.some((problem) => problem.includes('provenance.kind')));
		assert.ok(problems.some((problem) => problem.includes('provenance.recordedBy')));
	});
});
