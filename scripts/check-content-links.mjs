#!/usr/bin/env node
/**
 * check-content-links — pre-publication link / image gate (Issue #434).
 *
 * What it scans
 * -------------
 * Only content this repository PUBLISHES, not its internal docs:
 *
 *   - `public/**` 配下の HTML — Static Assets documents served verbatim;
 *   - `src/portfolio/seed.ts` — the authored Markdown bodies, project
 *     links and media alt text of `/portfolio/<slug>`.
 *
 * `docs/**` and `skills/**` are intentionally out of scope: they are
 * repository documentation, not a published surface. Tool submodule
 * checkouts are out of scope too — their own repositories own their
 * content, and `publication-surface.mjs` already audits the boundary.
 *
 * The rules
 * ---------
 *   error   => the release must stop
 *     - internal link / image URL that no public file or route serves
 *       (the Issue's "内部リンク404はrelease fail")
 *     - forbidden scheme, credential-bearing URL, private host
 *     - image without alt text
 *   warning => review, but do not block
 *     - external timeout / unreachable / non-2xx/3xx
 *       (the Issue's "外部timeoutは適切に区別")
 *     - `href="#"`, empty alt, runtime-supplied image src
 *
 * External URLs are NOT dereferenced by default. `validate:fast` is
 * offline by contract, and a third-party outage must not be able to
 * block this repository's release. Pass `--external` to run the live
 * check explicitly; every outcome there is a warning.
 *
 * Usage
 * -----
 *   pnpm run content:links:check
 *   pnpm run content:links:check -- --external --external-timeout 5000
 *   pnpm run content:links:check -- --report .tmp/link-check.html --markdown-report .tmp/link-check.md
 *
 * Exit codes: 0 = no errors (warnings allowed), 1 = at least one error,
 * 2 = bad input / the environment could not be scanned.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportHtml, renderMarkdownSummary } from './_content-link-report.mjs';
import {
	SEVERITY,
	buildSurfaceSets,
	checkExternalTargets,
	classifyReference,
	groupFindings,
	parseHtmlDocument,
	parseMarkdownDocument,
	publicUrlPath,
	summarize,
	validateDocuments,
	validateMediaAlt,
} from './_content-links.mjs';
import { SURFACE_DECLARATIONS, extractIntegratedToolSlugs } from './publication-surface.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = join(REPO_ROOT, 'public');
const SEED_MODULE = join(REPO_ROOT, 'src/portfolio/seed.ts');
const TOOLS_MANIFEST = join(REPO_ROOT, 'src/tools/manifest.json');
const ORIGIN = 'https://rebuildup.dev';

function walk(dir) {
	if (!existsSync(dir)) return [];
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...walk(full));
		else files.push(full);
	}
	return files.sort();
}

const rel = (full) => relative(REPO_ROOT, full).split('\\').join('/');

/** Every public file, plus the HTML documents to parse. */
export function collectPublicContent() {
	const files = walk(PUBLIC_ROOT).map(rel);
	const htmlFiles = files.filter((file) => file.endsWith('.html'));
	const documents = htmlFiles.map((file) => {
		const parsed = parseHtmlDocument({
			path: file,
			html: readFileSync(join(REPO_ROOT, file), 'utf8'),
		});
		return { ...parsed, urlPath: publicUrlPath(file) };
	});
	return { files, documents };
}

/**
 * Route targets that a content link may legitimately point at. The
 * declaration table is the same one `publication-surface` uses, so a
 * route that is not declared cannot be linked to by accident — and a
 * dynamic route is expanded with the real slug roster rather than
 * accepting any `/portfolio/<anything>` string.
 */
export function buildRoutePaths({ portfolioSlugs, toolSlugs }) {
	const paths = [];
	for (const declaration of SURFACE_DECLARATIONS) {
		if (typeof declaration.path === 'string') paths.push(declaration.path);
		if (declaration.dynamic === 'portfolio-projects') {
			for (const slug of portfolioSlugs) paths.push(`/portfolio/${slug}`);
		}
		if (declaration.dynamic === 'integrated-tools') {
			for (const slug of toolSlugs) paths.push(`/tools/${slug}`);
		}
	}
	return [...new Set(paths)].sort();
}

/** Read the authored portfolio content and turn it into link documents. */
export function buildPortfolioDocuments(seed) {
	const documents = [];
	const mediaFindings = [];
	for (const entry of seed) {
		const references = [];
		const images = [];
		for (const [field, value] of Object.entries(entry)) {
			if (!field.endsWith('Md') || typeof value !== 'string') continue;
			const parsed = parseMarkdownDocument({
				path: `src/portfolio/seed.ts#${entry.slug}.${field.replace(/Md$/, '')}`,
				markdown: value,
			});
			references.push(...parsed.references);
			images.push(...parsed.images);
		}
		for (const link of entry.links ?? []) {
			references.push({
				kind: 'link',
				sourcePath: `src/portfolio/seed.ts#${entry.slug}.links`,
				line: 0,
				raw: link.url,
				label: link.label ?? link.kind ?? '',
			});
		}
		documents.push({
			kind: 'markdown',
			path: `src/portfolio/seed.ts#${entry.slug}`,
			urlPath: `/portfolio/${entry.slug}`,
			ids: new Set(),
			references,
			images,
		});
		mediaFindings.push(...validateMediaAlt({ slug: entry.slug, media: entry.media ?? [] }));
	}
	return { documents, mediaFindings };
}

/** Load the TypeScript seed module. The CLI is run with --experimental-strip-types. */
async function loadSeed() {
	try {
		const module = await import(SEED_MODULE);
		return module.PORTFOLIO_SEED;
	} catch (error) {
		if (error?.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
			process.stderr.write(
				'check-content-links: src/portfolio/seed.ts must be loaded with --experimental-strip-types.\n' +
					'Run it through `pnpm run content:links:check` rather than `node scripts/check-content-links.mjs`.\n',
			);
		}
		throw error;
	}
}

function parseArgs(argv) {
	const options = {
		external: false,
		externalTimeout: 5000,
		report: null,
		markdownReport: null,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--external') options.external = true;
		else if (arg === '--external-timeout') {
			const value = Number(argv[index + 1]);
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error('--external-timeout expects a positive number of milliseconds');
			}
			options.externalTimeout = value;
			index += 1;
		} else if (arg === '--report') {
			options.report = argv[index + 1];
			index += 1;
		} else if (arg === '--markdown-report') {
			options.markdownReport = argv[index + 1];
			index += 1;
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return options;
}

async function scan(options) {
	const { files, documents: htmlDocuments } = collectPublicContent();
	const seed = await loadSeed();
	const { documents: portfolioDocuments, mediaFindings } = buildPortfolioDocuments(seed);
	const toolSlugs = extractIntegratedToolSlugs(JSON.parse(readFileSync(TOOLS_MANIFEST, 'utf8')));
	const routePaths = buildRoutePaths({
		portfolioSlugs: seed.map((entry) => entry.slug),
		toolSlugs,
	});
	const surface = buildSurfaceSets({
		publicFiles: files,
		routePaths,
	});

	// Map every public spelling of a document to itself, so `#fragment`
	// is checked against the target document's real ids.
	const documentsById = new Map();
	for (const document of htmlDocuments) {
		documentsById.set(document.urlPath, document);
		documentsById.set(document.path.replace(/^public/, ''), document);
		if (document.urlPath.endsWith('/')) {
			documentsById.set(document.urlPath.slice(0, -1), document);
			documentsById.set(`${document.urlPath}index.html`, document);
		}
	}

	const documents = [...htmlDocuments, ...portfolioDocuments];
	let findings = [
		...validateDocuments({ documents, surface, origin: ORIGIN, documentsById }),
		...mediaFindings,
	];

	if (options.external) {
		const targets = documents.flatMap((document) => [
			...document.references.map((reference) => reference.raw),
			...document.images.filter((image) => image.hasSrc).map((image) => image.raw),
		]);
		const externalTargets = targets.filter(
			(target) =>
				classifyReference(target, { documentPath: '/', origin: ORIGIN }).kind === 'external',
		);
		findings = findings.concat(
			await checkExternalTargets(externalTargets, {
				fetchImpl: globalThis.fetch,
				timeoutMs: options.externalTimeout,
				origin: ORIGIN,
			}),
		);
	}

	const references = documents.reduce(
		(total, document) => total + document.references.length + document.images.length,
		0,
	);
	return {
		documents,
		findings,
		surface,
		scan: {
			sources: documents.length,
			references,
			findings: groupFindings(findings),
			summary: summarize(findings),
			externalMode: options.external,
		},
	};
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`check-content-links: ${error.message}\n`);
		return 2;
	}

	let result;
	try {
		result = await scan(options);
	} catch (error) {
		process.stderr.write(`check-content-links: ${error.message}\n`);
		return 2;
	}

	const { scan: report, documents } = result;
	const grouped = report.findings;

	process.stdout.write(
		`content links: ${documents.length} source(s), ${report.references} reference(s), ` +
			`${report.summary.error} error(s), ${report.summary.warning} warning(s), ${report.summary.info} info\n`,
	);
	for (const item of grouped) {
		const location = item.line > 0 ? `${item.sourcePath}:${item.line}` : item.sourcePath;
		const count = item.count > 1 ? ` (x${item.count})` : '';
		process.stdout.write(
			`${item.severity.toUpperCase().padEnd(7)} ${item.code} ${location} ${item.target || '-'}${count} — ${item.message}\n`,
		);
	}
	process.stdout.write(`verdict: ${report.summary.verdict.toUpperCase()}\n`);

	if (options.report) {
		writeFileSync(options.report, buildReportHtml({ scan: report, fixtures: [] }), 'utf8');
		process.stdout.write(`wrote ${options.report}\n`);
	}
	if (options.markdownReport) {
		writeFileSync(
			options.markdownReport,
			renderMarkdownSummary({ scan: report, fixtures: [] }),
			'utf8',
		);
		process.stdout.write(`wrote ${options.markdownReport}\n`);
	}

	return report.summary.verdict === 'fail' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = await main();
}

export { SEVERITY, main, scan };
