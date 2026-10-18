import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * render-lazy-media-report refuses an A/B built from legs of different
 * runs (Issue #487).
 *
 * Why this needs a test of its own
 * -------------------------------
 * `.tmp/lazy-media/` holds one JSON per leg, and re-running a single
 * Playwright test overwrites only that leg's file. Without the guard the
 * report silently pairs a fresh `after` with a stale `before` / `tool`
 * and prints the `after` leg's source SHA and conditions as if they
 * described all three — a wrong number wearing a right caption, in an
 * artefact whose whole job is to be checkable.
 *
 * Only the rejection path is exercised here. The accepting path opens a
 * Chromium page and rasterises the image, which belongs to
 * `pnpm run lazy-media:report` at PR time, not to `validate:fast`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'render-lazy-media-report.mjs');

/** A measurement leg with every identity field the guard compares. */
function leg(overrides = {}) {
	return {
		label: 'home first paint',
		path: '/',
		sourceSha: 'a'.repeat(40),
		environment: 'preview (pnpm run build, local)',
		profile: 'Fast 4G (9 Mbit/s down, 150 ms RTT) + CPU x4',
		cpuThrottlingRate: 4,
		browser: 'chromium 0.0.0',
		trackedTreeDirty: false,
		viewport: { width: 1280, height: 800 },
		...overrides,
	};
}

function writeLegs(dir, { before, after, tool }) {
	writeFileSync(resolve(dir, 'home-before.json'), JSON.stringify(before));
	writeFileSync(resolve(dir, 'home-after.json'), JSON.stringify(after));
	writeFileSync(resolve(dir, 'tool-route.json'), JSON.stringify(tool));
}

function runReport(dir) {
	const out = resolve(dir, 'out.webp');
	const result = spawnSync(
		process.execPath,
		[SCRIPT, `--in=${dir}`, `--out=${out}`, `--tmp=${resolve(dir, 'out.png')}`],
		{ encoding: 'utf8' },
	);
	return { ...result, out };
}

function withLegs(legs, run) {
	const dir = mkdtempSync(resolve(tmpdir(), 'lazy-media-report-'));
	try {
		writeLegs(dir, legs);
		return run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('render-lazy-media-report (Issue #487)', () => {
	it('refuses legs measured at different source SHAs', () => {
		const after = leg();
		const result = withLegs(
			{
				after,
				before: leg({ label: 'home first paint (pre-#487 markup)', sourceSha: 'b'.repeat(40) }),
				tool: leg({ label: 'tool route' }),
			},
			runReport,
		);

		assert.equal(result.status, 1);
		assert.match(result.stderr, /come from different runs/);
		assert.equal(exists(result.out), false, 'no image may be written from mixed legs');
	});

	it('refuses legs measured under a different profile', () => {
		const after = leg();
		const result = withLegs(
			{
				after,
				before: leg({ label: 'home first paint (pre-#487 markup)' }),
				tool: leg({ label: 'tool route', profile: 'off (no throttle)', cpuThrottlingRate: 1 }),
			},
			runReport,
		);

		assert.equal(result.status, 1);
		assert.match(result.stderr, /come from different runs/);
		assert.equal(exists(result.out), false);
	});

	it('names the field that differs, so the run can be reproduced', () => {
		const after = leg();
		const result = withLegs(
			{
				after,
				before: leg({ label: 'home first paint (pre-#487 markup)' }),
				tool: leg({
					label: 'tool route',
					environment: 'preview (pnpm run build, local) - counter disabled',
				}),
			},
			runReport,
		);

		assert.equal(result.status, 1);
		assert.match(result.stderr, /environment=/);
	});
});

function exists(path) {
	// The guard runs before Chromium is launched, so a written
	// `out.webp` would mean the report was produced from mixed legs.
	return existsSync(path);
}
