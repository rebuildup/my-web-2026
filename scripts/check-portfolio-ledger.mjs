#!/usr/bin/env node
/**
 * check-portfolio-ledger — declared portfolio URLs must be producible
 * (Issue #834, decision O-4).
 *
 * The publication ledger declares `/portfolio/<slug>` for every slug
 * the canonical published set contains. This gate re-derives that set
 * from the committed Notion snapshot projection
 * (`src/portfolio/notion/generated/snapshot.json` — the repo-visible
 * projection of the CMS source of truth, Issue #811) and fails when
 * the recorded publication snapshot declares a `/portfolio/<slug>`
 * URL the canonical set cannot produce, or when a producible slug is
 * missing from the declaration.
 *
 * Exit codes: 0 pass, 1 violation, 2 unreadable input (fail closed).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPortfolioPublishedSlugs } from './publication-surface.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = 'src/portfolio/notion/generated/snapshot.json';
const SURFACE_PATH = 'docs/verification/content/publication-surface.snapshot.json';

export function declaredPortfolioSlugs(surfaceSnapshot) {
	const urls = surfaceSnapshot?.surface?.publicUrls;
	if (!Array.isArray(urls)) return null;
	return [
		...new Set(
			urls
				.filter((u) => typeof u === 'string' && u.startsWith('/portfolio/'))
				.map((u) => u.slice('/portfolio/'.length))
				.filter((s) => s.length > 0 && !s.includes('/')),
		),
	].sort();
}

export function evaluatePortfolioLedger({ declared, producible }) {
	const violations = [];
	const declaredSet = new Set(declared);
	const producibleSet = new Set(producible);
	for (const slug of declared) {
		if (!producibleSet.has(slug)) {
			violations.push(
				`declared /portfolio/${slug} is not producible — no published+public record in the canonical snapshot`,
			);
		}
	}
	for (const slug of producible) {
		if (!declaredSet.has(slug)) {
			violations.push(`producible /portfolio/${slug} is missing from the publication ledger`);
		}
	}
	return violations;
}

function main() {
	let portfolioSnapshot;
	let surfaceSnapshot;
	try {
		portfolioSnapshot = JSON.parse(readFileSync(join(repoRoot, SNAPSHOT_PATH), 'utf8'));
		surfaceSnapshot = JSON.parse(readFileSync(join(repoRoot, SURFACE_PATH), 'utf8'));
	} catch (error) {
		console.error(`[check-portfolio-ledger] FAIL: unreadable input (${error.message})`);
		process.exit(2);
	}
	let producible;
	try {
		producible = extractPortfolioPublishedSlugs(portfolioSnapshot);
	} catch (error) {
		console.error(`[check-portfolio-ledger] FAIL: ${error.message}`);
		process.exit(2);
	}
	const declared = declaredPortfolioSlugs(surfaceSnapshot);
	if (declared === null) {
		console.error('[check-portfolio-ledger] FAIL: surface snapshot has no publicUrls array');
		process.exit(2);
	}
	const violations = evaluatePortfolioLedger({ declared, producible });
	if (violations.length > 0) {
		console.error(`[check-portfolio-ledger] FAIL: ${violations.length} violation(s)`);
		for (const v of violations) console.error(`  - ${v}`);
		process.exit(1);
	}
	console.log(
		`[check-portfolio-ledger] PASS: ${producible.length} producible portfolio slug(s) all declared`,
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
