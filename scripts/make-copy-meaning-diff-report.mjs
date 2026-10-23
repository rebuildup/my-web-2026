#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #426.
 *
 * What this owns
 * --------------
 * The **presentation** of the meaning-diff corpus evaluation: a static
 * HTML page, a plain-text report, a machine-readable JSON record, and
 * the committed WebP screenshot of that page.
 *
 * What this does NOT own
 * -----------------------
 * The verdict. `scripts/check-copy-meaning-diff.mjs` decides whether a
 * proposal changed a claim, which axis it drifted on and what must
 * happen to it; this script only renders what that gate already
 * decided. A second implementation of the classification would be a
 * second answer to the same question, and the two answers would drift
 * apart — so the HTML and the text report are produced by the gate's
 * own `renderHtml` / `renderText`, and this script adds no second
 * renderer.
 *
 * Why the report exists
 * ---------------------
 * Issue #426 requires that a rewriting tool's proposal is never adopted
 * automatically, that a changed claim (a number, a negation, a
 * permission marker) is reported as a drift, and that the difference
 * between a prose difference and a typography difference is explicit.
 * Those are properties of a classification, and a classification is
 * only reviewable if a reader can see it. The committed screenshot is
 * that reader's view: the corpus, its per-case classification, the
 * evidence code behind every verdict, the locale opt-in state, and the
 * empty auto-apply vocabulary.
 *
 * WebP, not PNG
 * -------------
 * Issue #426 names `docs/verification/copy/meaning-diff-evaluation.png`,
 * but this repository commits verification screenshots as WebP only
 * (Issue #501 and the sibling copy artefacts: the PNG of the same page
 * is several times larger for no evidentiary gain). This script REFUSES
 * any output path that is not `.webp`, so a PNG cannot drift back into
 * `docs/`. Playwright cannot encode WebP, so the capture is taken into
 * an in-memory Buffer and re-encoded with the existing `sharp`
 * devDependency; no intermediate PNG is ever written to disk. A file
 * over 300 KB is an error rather than a silent commit.
 *
 * Safety
 * ------
 * The corpus is a fixture of synthetic sentences; the copy contract is
 * read, never written. No Worker is started, no remote binding is
 * touched, no secret is read, and no network is used: the report is
 * served over a loopback-only HTTP server on an ephemeral port, which
 * exists only so Chromium loads the page from an origin.
 *
 * Exit codes: 0 = the corpus classifies as it is pinned and the
 * artefact was written, 1 = a violation or a failure, 2 = the
 * evaluation could not be decided (unreadable corpus / contract).
 *
 *   node scripts/make-copy-meaning-diff-report.mjs
 *   pnpm run verify:copy-meaning-diff-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	CONTRACT_PATH,
	CORPUS_PATH,
	evaluateCorpus,
	loadContract,
	loadCorpus,
	renderHtml,
	renderText,
} from './check-copy-meaning-diff.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directory that holds the rendered report (gitignored). */
export const REPORT_DIR = '.tmp/copy-meaning-diff-report';

/** The rendered page, the one the screenshot photographs. */
export const HTML_REPORT_PATH = `${REPORT_DIR}/meaning-diff-evaluation.html`;

/** The plain-text twin of the same evaluation. */
export const TEXT_REPORT_PATH = `${REPORT_DIR}/meaning-diff-evaluation.txt`;

/** The machine-readable record of the same evaluation. */
export const JSON_REPORT_PATH = `${REPORT_DIR}/report.json`;

/** The committed artefact (WebP; the Issue names the `.png` sibling). */
export const ARTEFACT_PATH = 'docs/verification/copy/meaning-diff-evaluation.webp';

/**
 * Committed captures are WebP: width cap, quality and a size budget,
 * the same policy as the other verification artefacts in `docs/`.
 */
export const WEBP_MAX_WIDTH = 1600;
export const WEBP_QUALITY = 80;
export const WEBP_MAX_BYTES = 300 * 1024;

/** The viewport the page is rendered in. */
export const VIEWPORT = { width: 1280, height: 1400 };

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= WEBP_MAX_BYTES,
	};
}

/** Reject an output path that is not WebP, or that leaves the repo (pure). */
export function assertWebpOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return rel;
}

/**
 * The presentation model of one evaluation.
 *
 * Pure, and derived from the gate's result only: this groups the rows
 * the gate produced and names the cases whose meaning did not survive
 * the rewrite. It decides nothing — a case is a meaning violation
 * because the gate said `meaning: "drift"`, and the count of
 * auto-appliable cases is read from the gate's own `autoAdopt` flag.
 */
export function buildReportModel(result) {
	const countBy = (key) =>
		result.rows.reduce((counts, row) => {
			const value = row.actual[key];
			counts[value] = (counts[value] ?? 0) + 1;
			return counts;
		}, {});

	return {
		summary: result.summary,
		byMeaning: countBy('meaning'),
		bySurface: countBy('surface'),
		byDisposition: countBy('disposition'),
		// The meaning-preservation violations, as the gate classified
		// them. This is the list Issue #426 asks a reader to be able
		// to see: a proposal whose claim did not survive.
		meaningViolations: result.rows
			.filter((row) => row.actual.meaning === 'drift')
			.map((row) => ({
				id: row.id,
				locale: row.locale,
				before: row.before,
				after: row.after,
				evidence: row.actual.evidence,
				disposition: row.actual.disposition,
			})),
		// The rule Issue #426 states as a type: the list of
		// dispositions that may be applied without a person is empty.
		autoAdoptCount: result.rows.filter((row) => row.actual.autoAdopt).length,
		findings: result.findings,
	};
}

/**
 * The three renderings of one evaluation.
 *
 * The HTML and the text come from the gate's own renderers, so the
 * committed page and `pnpm run copy:meaning:check` cannot disagree.
 */
export function buildReportFiles(result) {
	return {
		html: renderHtml(result),
		text: renderText(result),
		model: buildReportModel(result),
	};
}

/**
 * Resolve one request path inside the served root (pure).
 *
 * A request may never leave the served directory, and a directory
 * request falls back to its `index.html`.
 */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	const candidate = resolve(base, `.${decodeURIComponent(requestPath)}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) {
		return { status: 403, file: null };
	}
	const isDirectory = existsSync(candidate) && statSync(candidate).isDirectory();
	const target = existsSync(candidate) && !isDirectory ? candidate : join(candidate, 'index.html');
	if (!existsSync(target)) return { status: 404, file: null };
	const contentType =
		extname(target) === '.html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
	return { status: 200, file: target, contentType };
}

/** Serve `root` over loopback on an ephemeral port, for the capture only. */
export function serveDirectory(root) {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const resolved = resolveStaticTarget(root, url.pathname);
		if (resolved.status !== 200) {
			res.writeHead(resolved.status).end(resolved.status === 403 ? 'forbidden' : 'not found');
			return;
		}
		res.writeHead(200, { 'content-type': resolved.contentType });
		createReadStream(resolved.file).pipe(res);
	});
	return new Promise((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolveServer({
				baseUrl: `http://127.0.0.1:${port}`,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections?.();
						server.close(() => done());
					}),
			});
		});
	});
}

function parseArgs(argv) {
	const options = {
		corpus: CORPUS_PATH,
		contract: CONTRACT_PATH,
		artefact: ARTEFACT_PATH,
		html: HTML_REPORT_PATH,
		text: TEXT_REPORT_PATH,
		json: JSON_REPORT_PATH,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = arg.startsWith('--')
			? arg.slice(2, separator === -1 ? undefined : separator)
			: arg;
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'corpus':
				options.corpus = value;
				break;
			case 'contract':
				options.contract = value;
				break;
			case 'artefact':
				options.artefact = value;
				break;
			case 'html':
				options.html = value;
				break;
			case 'text':
				options.text = value;
				break;
			case 'json':
				options.json = value;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	return options;
}

function writeRepoFile(path, contents) {
	const absolute = resolve(REPO_ROOT, path);
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, contents);
	return absolute;
}

function headSha() {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/**
 * Photograph the rendered report.
 *
 * The page is served over loopback, Chromium takes a full-page capture
 * into memory, and `sharp` re-encodes it as WebP. The PNG bytes never
 * touch the disk.
 */
export async function captureArtefact({ htmlPath, artefactPath }) {
	const { chromium } = await import('@playwright/test');
	const sharp = (await import('sharp')).default;
	const server = await serveDirectory(resolve(REPO_ROOT, dirname(htmlPath)));
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
		await page.goto(`${server.baseUrl}/${htmlPath.split('/').pop()}`, { waitUntil: 'load' });
		const capture = await page.screenshot({ fullPage: true });
		const absolute = resolve(REPO_ROOT, artefactPath);
		mkdirSync(dirname(absolute), { recursive: true });
		await sharp(capture)
			.resize({ width: WEBP_MAX_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(absolute);
		const meta = await sharp(absolute).metadata();
		return {
			artefact: artefactPath,
			width: meta.width ?? null,
			height: meta.height ?? null,
			quality: WEBP_QUALITY,
			viewport: VIEWPORT,
			...screenshotBudgetVerdict(statSync(absolute).size),
		};
	} finally {
		await browser.close();
		await server.close();
	}
}

async function main(argv) {
	const options = parseArgs(argv);
	assertWebpOutputPath(options.artefact);

	let corpus;
	let contract;
	try {
		corpus = loadCorpus(options.corpus);
		contract = loadContract(options.contract);
	} catch (error) {
		// The evaluation could not be decided: an unreadable corpus or
		// contract is not "no violation", it is "cannot say".
		process.stderr.write(`[meaning-diff-report] ${error.message}\n`);
		return 2;
	}

	const result = evaluateCorpus(corpus, { contract });
	const files = buildReportFiles(result);
	writeRepoFile(options.html, files.html);
	writeRepoFile(options.text, files.text);
	process.stdout.write(`wrote ${options.html}\n`);
	process.stdout.write(`wrote ${options.text}\n`);
	process.stdout.write(
		`corpus: ${files.model.summary.total} case(s), ${files.model.summary.failed} drifted from the corpus, ${files.model.meaningViolations.length} meaning violation(s), ${files.model.autoAdoptCount} auto-appliable\n`,
	);

	let capture = null;
	try {
		capture = await captureArtefact({ htmlPath: options.html, artefactPath: options.artefact });
	} catch (error) {
		process.stderr.write(`[meaning-diff-report] capture failed: ${error.message}\n`);
		return 1;
	}
	if (!capture.withinBudget) {
		process.stderr.write(
			`[meaning-diff-report] ${options.artefact} is ${capture.kb} kB — over the ${Math.round(WEBP_MAX_BYTES / 1024)} kB verification budget\n`,
		);
		return 1;
	}
	process.stdout.write(
		`wrote ${options.artefact} (${capture.width}x${capture.height}, ${capture.kb} kB)\n`,
	);

	writeRepoFile(
		options.json,
		`${JSON.stringify(
			{
				issue: '#426',
				generatedBy: 'scripts/make-copy-meaning-diff-report.mjs',
				sourceSha: headSha(),
				corpus: options.corpus,
				contract: options.contract,
				policy: {
					webpOnly: true,
					maxWidth: WEBP_MAX_WIDTH,
					quality: WEBP_QUALITY,
					budgetBytes: WEBP_MAX_BYTES,
					issuePathSubstituted: 'docs/verification/copy/meaning-diff-evaluation.png -> .webp',
					verdictOwner: 'scripts/check-copy-meaning-diff.mjs',
					autoApplyDispositions: [],
				},
				model: files.model,
				capture,
			},
			null,
			2,
		)}\n`,
	);
	process.stdout.write(`wrote ${options.json}\n`);

	// A corpus that no longer classifies as it is pinned is a
	// violation, not a report: the artefact is written either way, so
	// a reader can see what moved.
	return result.summary.errors > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			process.stderr.write(`[meaning-diff-report] failed: ${error.message}\n`);
			process.exitCode = 1;
		});
}
