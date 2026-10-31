import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync,
	mkdirSync,
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
	ARTICLE_REVIEW_STATUSES,
	ARTICLE_SOURCE_STATUSES,
	CLASSIFICATIONS,
	DEFAULT_ARTICLE_SOURCES,
	DIMENSIONS,
	FIXTURE_DIR,
	REGISTRY_PATH,
	collectSegments,
	daysBetween,
	detectLocale,
	detectTimeTokens,
	evaluateRegistry,
	markdownSegments,
	runReview,
	validateArticleSources,
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
});

/**
 * The public article source inventory (Issue #723).
 *
 * The gate used to read only the Issue #506 public copy surfaces, so a
 * green gate could mean "no article prose was examined at all". The
 * inventory makes the difference visible: a source that is declared but
 * absent, a source that cannot be read offline and a source that
 * exists but was not scanned are all named, and none of them may pass
 * as "reviewed".
 */
function writeArticleFixture({ surface = false } = {}) {
	const workdir = mkdtempSync(join(tmpdir(), 'stale-articles-'));
	mkdirSync(join(workdir, 'content/articles'), { recursive: true });
	mkdirSync(join(workdir, 'content/blog'), { recursive: true });
	mkdirSync(join(workdir, 'src'), { recursive: true });
	writeFileSync(
		join(workdir, 'surfaces.json'),
		JSON.stringify(
			{
				version: 1,
				publicCopyGlobs: surface ? ['src/**'] : [],
				excludeGlobs: [],
			},
			null,
			2,
		),
		'utf8',
	);
	writeFileSync(
		join(workdir, 'registry.json'),
		JSON.stringify(
			{ version: 1, freshnessWindowDays: 90, locales: ['ja'], expressions: [] },
			null,
			2,
		),
		'utf8',
	);
	writeFileSync(
		join(workdir, 'articles.json'),
		JSON.stringify(
			{
				version: 1,
				sources: [
					{
						id: 'fixture-articles',
						kind: 'repository',
						globs: ['content/articles/**/*.md'],
						routes: ['/portfolio/<slug>'],
						description: 'The committed article Markdown of the fixture.',
					},
					{
						id: 'fixture-absent',
						kind: 'repository',
						globs: ['content/blog/**/*.md'],
						routes: [],
						description: 'A declared source whose files do not exist.',
					},
					{
						id: 'fixture-unreadable',
						kind: 'repository',
						globs: ['content/blog/**/*.txt'],
						routes: [],
						description: 'A declared source whose file type this gate cannot read.',
					},
					{
						id: 'fixture-external',
						kind: 'external',
						location: 'the D1 rows of the fixture',
						routes: ['/portfolio'],
						description: 'A source outside the repository.',
					},
				],
			},
			null,
			2,
		),
		'utf8',
	);
	writeFileSync(
		join(workdir, 'content/articles/one.md'),
		'# 記事\n\nこの本文は現在coefficientの更新を述べています。\n',
		'utf8',
	);
	writeFileSync(join(workdir, 'content/blog/old.txt'), '今は blog の本文です。\n', 'utf8');
	if (surface) {
		writeFileSync(
			join(workdir, 'src/page.tsx'),
			'export const Page = () => <p>現在のページです。</p>;\n',
			'utf8',
		);
	}
	return workdir;
}

function runArticleFixture(workdir, extra = []) {
	return runCli(
		[
			`--root=${workdir}`,
			`--registry=${join(workdir, 'registry.json')}`,
			`--surfaces=${join(workdir, 'surfaces.json')}`,
			`--article-sources=${join(workdir, 'articles.json')}`,
			'--japanese-surfaces=none',
			`--today=${TODAY}`,
			...extra,
		],
		{ cwd: workdir },
	);
}

describe('check-stale-content-review — the public article source inventory', () => {
	it('lists every declared source of the live repository', () => {
		const result = runCli(['--format=json']);
		assert.equal(result.status, 0);
		const report = JSON.parse(result.stdout);
		const records = report.articleInventory.sources;
		assert.equal(records.length, DEFAULT_ARTICLE_SOURCES.sources.length);
		for (const record of records) {
			assert.ok(
				ARTICLE_SOURCE_STATUSES.includes(record.status),
				`unexpected source status ${record.status}`,
			);
			assert.ok(
				ARTICLE_REVIEW_STATUSES.includes(record.reviewStatus),
				`unexpected review status ${record.reviewStatus}`,
			);
		}
	});

	it('reports the committed portfolio prose as scanned and covered', () => {
		const report = JSON.parse(runCli(['--format=json']).stdout);
		const seed = report.articleInventory.sources.find((record) => record.id === 'portfolio-seed');
		assert.equal(seed.status, 'scanned');
		assert.equal(seed.exists, 'yes');
		assert.equal(seed.files, 1);
		assert.equal(seed.scannedFiles, 1);
		assert.equal(seed.readableOffline, 'yes');
		assert.ok(seed.expressions >= 1, 'the seed holds a time-sensitive expression');
		assert.ok(seed.recorded >= 1, 'the shipped registry covers the seed expression');
		assert.equal(seed.reviewStatus, 'covered');
		assert.deepEqual(seed.routes, ['/portfolio', '/portfolio/<slug>']);
	});

	it('records a declared but absent source as absent, not as reviewed', () => {
		const report = JSON.parse(runCli(['--format=json']).stdout);
		for (const id of ['content-articles', 'content-blog']) {
			const record = report.articleInventory.sources.find((entry) => entry.id === id);
			assert.equal(record.status, 'declared-but-absent', `${id} must be absent`);
			assert.equal(record.exists, 'no');
			assert.equal(record.files, 0);
			assert.equal(record.scanned, 'no');
			assert.equal(record.readableOffline, 'unknown', 'there is nothing to read');
			assert.equal(record.recorded, 0);
			assert.equal(record.reviewStatus, 'not-applicable');
		}
	});

	it('records a source it cannot read offline as unobserved, never as pass', () => {
		const report = JSON.parse(runCli(['--format=json']).stdout);
		for (const id of ['portfolio-d1-rows', 'notion-import']) {
			const record = report.articleInventory.sources.find((entry) => entry.id === id);
			assert.equal(record.status, 'unobserved', `${id} must be unobserved`);
			assert.equal(record.readableOffline, 'no');
			assert.equal(record.scanned, 'no');
			assert.equal(record.exists, 'unknown');
		}
	});

	it('says in the report that a green gate is not an audit of the articles', () => {
		const result = runCli([]);
		assert.match(result.stdout, /it does NOT mean the article surfaces were audited/);
		assert.match(result.stdout, /declared-but-absent/);
		assert.match(result.stdout, /unobserved/);
	});

	it('keeps the live queue green through the article scan', () => {
		const surfaces = readJson(join(REPO_ROOT, 'quality/copy-editorial-surfaces.json'));
		const registry = readJson(join(REPO_ROOT, REGISTRY_PATH));
		const { result } = runReview({
			root: REPO_ROOT,
			surfaces,
			registry,
			today: TODAY,
			articleSources: DEFAULT_ARTICLE_SOURCES,
			japaneseSurfaces: readJson(join(REPO_ROOT, 'quality/japanese-copy-review-surfaces.json')),
		});
		assert.deepEqual(result.queue, [], 'the shipped registry must have no waiting expression');
		assert.deepEqual(result.articleOutstanding, []);
	});

	it('never writes the owner registry', () => {
		const before = readFileSync(join(REPO_ROOT, REGISTRY_PATH), 'utf8');
		runCli(['--format=json']);
		runCli([]);
		assert.equal(readFileSync(join(REPO_ROOT, REGISTRY_PATH), 'utf8'), before);
	});
});

describe('check-stale-content-review — the inventory is fail-closed on the difference', () => {
	it('shows a declared but absent source instead of omitting it', () => {
		const workdir = writeArticleFixture();
		try {
			const result = runArticleFixture(workdir, ['--format=json']);
			assert.equal(result.status, 0);
			const report = JSON.parse(result.stdout);
			const ids = report.articleInventory.sources.map((record) => record.id);
			assert.ok(ids.includes('fixture-absent'), 'the absent source must be in the inventory');
			const absent = report.articleInventory.sources.find(
				(record) => record.id === 'fixture-absent',
			);
			assert.equal(absent.status, 'declared-but-absent');
			assert.equal(absent.files, 0);
			assert.equal(absent.scanned, 'no');
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('shows a present but unscanned source as unscanned', () => {
		const workdir = writeArticleFixture();
		try {
			const result = runArticleFixture(workdir, ['--format=json']);
			const report = JSON.parse(result.stdout);
			const unreadable = report.articleInventory.sources.find(
				(record) => record.id === 'fixture-unreadable',
			);
			assert.equal(unreadable.status, 'unobserved');
			assert.equal(unreadable.files, 1, 'the file exists');
			assert.equal(unreadable.scannedFiles, 0, 'but the gate cannot read it');
			assert.equal(unreadable.scanned, 'no');
			assert.match(unreadable.reasons.join(' '), /cannot read/);
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('scans the committed article Markdown and reports it', () => {
		const workdir = writeArticleFixture();
		try {
			const result = runArticleFixture(workdir, ['--format=json']);
			const report = JSON.parse(result.stdout);
			const articles = report.articleInventory.sources.find(
				(record) => record.id === 'fixture-articles',
			);
			assert.equal(articles.status, 'scanned');
			assert.equal(articles.files, 1);
			assert.equal(articles.scannedFiles, 1);
			assert.equal(articles.expressions, 1);
			assert.equal(articles.recorded, 0);
			assert.equal(articles.reviewStatus, 'outstanding');
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('reports an expression without an owner record as outstanding, not as a failure', () => {
		const workdir = writeArticleFixture();
		try {
			const result = runArticleFixture(workdir, ['--format=json']);
			assert.equal(result.status, 0, 'an article expression without a record is not a failure');
			const report = JSON.parse(result.stdout);
			assert.equal(report.articleOutstanding.length, 1);
			assert.equal(report.articleOutstanding[0].status, 'unrecorded');
			assert.equal(report.articleOutstanding[0].path, 'content/articles/one.md');
			assert.deepEqual(report.queue, []);
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('keeps the failing queue for the public copy surfaces', () => {
		const workdir = writeArticleFixture({ surface: true });
		try {
			const result = runArticleFixture(workdir, ['--format=json']);
			assert.equal(result.status, 1, 'a public copy surface without a record still fails');
			const report = JSON.parse(result.stdout);
			assert.equal(report.queue.length, 1);
			assert.equal(report.queue[0].path, 'src/page.tsx');
			assert.equal(report.articleOutstanding.length, 1);
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('keeps the article report free of the article body', () => {
		const workdir = writeArticleFixture();
		try {
			const result = runArticleFixture(workdir);
			assert.match(result.stdout, /content\/articles\/one\.md/);
			assert.ok(
				!result.stdout.includes('coefficient'),
				'the report names the file, it does not quote the article body',
			);
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('exits 2 on a malformed article source declaration', () => {
		const workdir = writeArticleFixture();
		try {
			writeFileSync(
				join(workdir, 'articles.json'),
				JSON.stringify({ version: 1, sources: [{ id: 'broken', kind: 'repository' }] }),
				'utf8',
			);
			const result = runArticleFixture(workdir);
			assert.equal(result.status, 2);
			assert.match(result.stderr, /article source declaration cannot be read/);
		} finally {
			rmSync(workdir, { recursive: true, force: true });
		}
	});

	it('validates the shipped article source declaration', () => {
		const { problems } = validateArticleSources(DEFAULT_ARTICLE_SOURCES);
		assert.deepEqual(problems, []);
	});
});

describe('check-stale-content-review — the Markdown article unit', () => {
	it('reads a paragraph as one segment and strips the markup', () => {
		const segments = markdownSegments('# 見出し\n\n- 箇条書きの本文です。\n');
		assert.equal(segments.length, 0, 'a paragraph without a time token is not a segment');
	});

	it('skips a fenced code block', () => {
		const segments = markdownSegments('```\nコードの現在は無視されます\n```\n');
		assert.deepEqual(segments, []);
	});

	it('joins the lines of one paragraph', () => {
		const segments = markdownSegments('現在の状態は\n二行にわたります。\n');
		assert.equal(segments.length, 1);
		assert.equal(segments[0].text, '現在の状態は 二行にわたります。');
		assert.equal(segments[0].locale, 'ja');
	});
});
