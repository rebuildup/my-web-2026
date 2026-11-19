#!/usr/bin/env node

/**
 * check-handle-map-preview-parity — Issue #524.
 *
 * What this proves
 * ----------------
 * The document `docs/personal/handle-map.md`, the preview data
 * (`src/personal/handle-map/HandleMap.preview.ts`) and the committed
 * records the facts were read from still agree:
 *
 *   1. the document's `##` heading set equals the preview's section
 *      headings, in the same order — a heading that exists on only one
 *      side is a failure, not a warning;
 *   2. every legend entry's bullet lines (`名前:` / `側面:` / `説明:` /
 *      `公開リンク:`) and every section bullet appear on both sides;
 *   3. every `url` the legend publishes appears VERBATIM in a committed
 *      record (`src/about/data.ts` or `src/about/links.ts`) — this is
 *      the mechanical form of the issue's 「非公開アカウントをリンクと
 *      して創作しない」: a link the records do not publish fails here;
 *   4. every entry `name` appears in the canonical personal-domain
 *      records (`docs/personal/domain.md`, `docs/personal/owner.md`,
 *      `src/about/data.ts`, `src/about/links.ts`) — a name the records
 *      do not carry fails here.
 *
 * Why the records are re-read as text
 * ------------------------------------
 * `src/personal/**` may import `editorial` only (AGENTS.md §3), so the
 * preview cannot import `src/about/**` — the facts are restated as
 * literals on purpose. This test is what keeps the restatement honest:
 * it reads the committed records AS COMMITTED (text, not evaluation)
 * and fails when the preview claims a name or a URL the records do not
 * publish.
 *
 * Exit codes: node:test's own (0 = every assertion passed).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	HANDLE_MAP_DOCUMENT,
	HANDLE_MAP_ENTRIES,
	HANDLE_MAP_LEGEND,
	HANDLE_MAP_SECTIONS,
	handleMapEntryBullets,
} from '../src/personal/handle-map/HandleMap.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The document this test keeps in step with the preview. */
const DOCUMENT_PATH = 'docs/personal/handle-map.md';

/**
 * The committed records the preview's facts were read from.
 *
 * `src/about/**` is read as TEXT on purpose: importing the modules
 * would pull the about obligation into a plain Node ESM import, and
 * the point of this check is to compare against the record AS
 * COMMITTED, not to re-evaluate it.
 */
const CANONICAL_RECORDS = [
	'docs/personal/domain.md',
	'docs/personal/owner.md',
	'src/about/data.ts',
	'src/about/links.ts',
];

/**
 * The records that may publish a link URL.
 *
 * `src/about/career.ts` is included because it publishes the
 * predecessor domain as `CAREER_LEGACY_SOURCE_URL`
 * (`https://yusuke-kim.com/about/`) — the committed record that makes
 * `yusuke-kim.com` a published URL rather than an invented one.
 */
const LINK_RECORDS = ['src/about/data.ts', 'src/about/links.ts', 'src/about/career.ts'];

const documentText = readFileSync(join(REPO_ROOT, DOCUMENT_PATH), 'utf8');
const canonicalText = CANONICAL_RECORDS.map((path) =>
	readFileSync(join(REPO_ROOT, path), 'utf8'),
).join('\n');
const linkRecordText = LINK_RECORDS.map((path) => readFileSync(join(REPO_ROOT, path), 'utf8')).join(
	'\n',
);

/**
 * Every absolute URL a committed record publishes.
 *
 * A record may publish a URL with a path (`…/about/`) where the
 * legend links the bare origin (`https://yusuke-kim.com`), so the
 * check is prefix-aware on path boundaries: `https://a/b` is
 * published by `https://a/b/c` and by `https://a/b`, but NOT by
 * `https://a/bc` or `https://a/b2`.
 */
function publishedUrls(source) {
	return new Set(source.match(/https:\/\/[^\s'"`）)]+/g) ?? []);
}

function isPublishedUrl(url, published) {
	for (const candidate of published) {
		if (candidate === url) return true;
		if (candidate.startsWith(`${url}/`) || url.startsWith(`${candidate}/`)) return true;
	}
	return false;
}

/**
 * The document's `##` headings, in order.
 *
 * `###` sub-headings are NOT included (the character after `##` must be
 * a space), and a heading inside a fenced code block is not a heading —
 * the fence state is tracked so a fence in the document cannot invent
 * one.
 */
function documentHeadings(markdown) {
	const headings = [];
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = /^## (.+)$/.exec(line);
		if (match) headings.push(match[1]);
	}
	return headings;
}

/**
 * The document split into sections, keyed by heading.
 *
 * The body of a section is everything up to the next `##` heading; the
 * `###` sub-headings stay inside the body, because a sub-heading is
 * part of the section it belongs to.
 */
function documentSections(markdown) {
	const sections = new Map();
	let current = null;
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			if (current) current.body.push(line);
			continue;
		}
		if (!inFence) {
			const heading = /^## (.+)$/.exec(line);
			if (heading) {
				current = { heading: heading[1], body: [] };
				sections.set(heading[1], current);
				continue;
			}
		}
		if (current) current.body.push(line);
	}
	return sections;
}

/** The bullet lines of one section body, `- ` prefix stripped. */
function sectionBullets(body) {
	return body.filter((line) => /^- /.test(line)).map((line) => line.slice(2));
}

const sections = documentSections(documentText);
const expectedHeadings = [
	HANDLE_MAP_LEGEND.heading,
	...HANDLE_MAP_SECTIONS.map((section) => section.heading),
];

describe('document / preview heading parity', () => {
	it('declares the same `##` headings, in the same order', () => {
		assert.deepEqual(documentHeadings(documentText), expectedHeadings);
	});

	it('has a body for every heading the preview declares', () => {
		for (const heading of expectedHeadings) {
			assert.ok(sections.has(heading), `missing section: ${heading}`);
		}
	});
});

describe('legend entry parity', () => {
	const legendBody = sections.get(HANDLE_MAP_LEGEND.heading)?.body ?? [];
	const legendBullets = sectionBullets(legendBody);
	const expectedEntryBullets = HANDLE_MAP_ENTRIES.flatMap((entry) => handleMapEntryBullets(entry));

	it('carries every entry bullet line, in entry order', () => {
		// The document interleaves nothing between entries: the bullet
		// list of the legend section IS the flattened entry bullets.
		assert.deepEqual(legendBullets, expectedEntryBullets);
	});

	it('carries the legend lead paragraph', () => {
		const body = legendBody.join('\n');
		assert.ok(body.includes(HANDLE_MAP_LEGEND.lead), 'missing legend lead');
	});
});

describe('section parity', () => {
	for (const section of HANDLE_MAP_SECTIONS) {
		it(`carries every bullet of "${section.heading}"`, () => {
			const body = sections.get(section.heading)?.body ?? [];
			const bullets = sectionBullets(body);
			assert.deepEqual(bullets, [...section.bullets]);
		});
	}
});

describe('the link rule (非公開アカウントをリンクとして創作しない)', () => {
	const published = publishedUrls(linkRecordText);

	it('every link URL appears verbatim in a committed record', () => {
		for (const entry of HANDLE_MAP_ENTRIES) {
			for (const link of entry.links) {
				assert.ok(
					isPublishedUrl(link.url, published),
					`${entry.name}: "${link.url}" is not published by ${LINK_RECORDS.join(' / ')}`,
				);
			}
		}
	});

	it('an entry without links states why', () => {
		for (const entry of HANDLE_MAP_ENTRIES) {
			if (entry.links.length === 0) {
				assert.ok(entry.noLinkReason, `${entry.name}: links is empty but noLinkReason is missing`);
			} else {
				assert.equal(
					entry.noLinkReason,
					undefined,
					`${entry.name}: noLinkReason is set but links is not empty`,
				);
			}
		}
	});
});

describe('the names come from the canonical records', () => {
	it('every entry name appears in a canonical personal-domain record', () => {
		for (const entry of HANDLE_MAP_ENTRIES) {
			assert.ok(
				canonicalText.includes(entry.name),
				`${entry.name}: not found in ${CANONICAL_RECORDS.join(' / ')}`,
			);
		}
	});
});

describe('document metadata', () => {
	it('carries the preview paths the data declares', () => {
		assert.ok(documentText.includes(HANDLE_MAP_DOCUMENT.preview));
		assert.ok(documentText.includes(HANDLE_MAP_DOCUMENT.verification));
	});
});
