import { describe, expect, it } from 'vitest';
import { EXTERNAL_BOUNDARY_PREFIXES } from '../../scripts/_index-boundary.mjs';
import { externalBoundary } from './hono';
import {
	type BoundaryMountActual,
	type BoundaryMountEntry,
	type BoundaryProbeObservation,
	BOUNDARY_NOT_FOUND_CONTRACT,
	classifyProbe,
	EXTERNAL_BOUNDARY_MOUNTS,
	evaluateBoundaryMounts,
	isBoundaryNotFound,
} from './external-boundary-mounts';

/**
 * External boundary mount contract (Issue #841, decision O-13).
 *
 * `EXTERNAL_BOUNDARY_PREFIXES` declares which prefixes the Worker entry
 * hands to the Hono boundary; this record says which of them have a
 * real handler mounted and which exist only as a declaration. Every
 * claim is verified against the live boundary here — editing the
 * record without changing the mounts turns this file red.
 *
 * Runs in the `unit` project (Node environment) like `hono.test.ts`:
 * `externalBoundary.request` needs no workerd bindings for these
 * probes (health is static, the SEO documents tolerate a missing D1,
 * security.txt reads a repo manifest, and the declared-only prefixes
 * never reach a handler at all).
 */

const EMPTY_ENV = {} as Env;

async function probe(path: string): Promise<BoundaryProbeObservation> {
	const res = await externalBoundary.request(path, undefined, EMPTY_ENV);
	const contentType = res.headers.get('content-type') ?? '';
	let jsonBody: unknown = null;
	if (contentType.includes('application/json')) {
		jsonBody = await res.json().catch(() => null);
	}
	return { status: res.status, contentType, jsonBody };
}

describe('EXTERNAL_BOUNDARY_MOUNTS record', () => {
	it('covers exactly the declared external boundary prefixes', () => {
		const declared = [...EXTERNAL_BOUNDARY_PREFIXES].sort();
		const recorded = Object.keys(EXTERNAL_BOUNDARY_MOUNTS).sort();
		expect(recorded).toEqual(declared);
	});

	it('declares only mounted or declared-only entries', () => {
		for (const [prefix, entry] of Object.entries(EXTERNAL_BOUNDARY_MOUNTS)) {
			expect(['mounted', 'declared-only'], prefix).toContain(entry.status);
			expect(entry.probe.path.length, prefix).toBeGreaterThan(0);
		}
	});
});

describe('declared-only prefixes answer the boundary JSON 404 contract', () => {
	const declaredOnly = Object.entries(EXTERNAL_BOUNDARY_MOUNTS).filter(
		([, entry]) => entry.status === 'declared-only',
	);

	it('has at least one declared-only prefix under test', () => {
		// Guards the suite itself: if every prefix becomes mounted the
		// contract below would silently stop being exercised.
		expect(declaredOnly.length).toBeGreaterThan(0);
	});

	for (const [prefix, entry] of declaredOnly) {
		it(`${prefix} probe answers ${BOUNDARY_NOT_FOUND_CONTRACT.status} {error:not_found}`, async () => {
			const observation = await probe(entry.probe.path);
			expect(observation.status).toBe(BOUNDARY_NOT_FOUND_CONTRACT.status);
			expect(observation.contentType).toContain('application/json');
			expect(observation.jsonBody).toEqual({
				error: BOUNDARY_NOT_FOUND_CONTRACT.error,
				path: entry.probe.path,
			});
			expect(isBoundaryNotFound(observation)).toBe(true);
		});
	}
});

describe('mounted prefixes are answered by a real handler', () => {
	const mounted = Object.entries(EXTERNAL_BOUNDARY_MOUNTS).filter(
		([, entry]) => entry.status === 'mounted',
	);

	for (const [prefix, entry] of mounted) {
		it(`${prefix} probe ${entry.probe.path} does not fall through to the boundary 404`, async () => {
			const observation = await probe(entry.probe.path);
			expect(isBoundaryNotFound(observation)).toBe(false);
			if (entry.probe.status !== undefined) {
				expect(observation.status).toBe(entry.probe.status);
			}
			const verdict = classifyProbe(prefix, entry, observation);
			expect('violation' in verdict).toBe(false);
		});
	}
});

describe('evaluateBoundaryMounts — record vs runtime consistency', () => {
	const declared = [...EXTERNAL_BOUNDARY_PREFIXES];

	function actualFor(status: BoundaryMountEntry['status']): Record<string, BoundaryMountActual> {
		return Object.fromEntries(declared.map((p) => [p, status]));
	}

	it('passes when every recorded status matches the observation', () => {
		const actual = Object.fromEntries(
			Object.entries(EXTERNAL_BOUNDARY_MOUNTS).map(([p, e]) => [p, e.status]),
		) as Record<string, BoundaryMountActual>;
		expect(evaluateBoundaryMounts(declared, EXTERNAL_BOUNDARY_MOUNTS, actual)).toEqual([]);
	});

	it('negative control: a declared-only prefix observed as mounted is a violation', () => {
		const actual = actualFor('mounted');
		const violations = evaluateBoundaryMounts(declared, EXTERNAL_BOUNDARY_MOUNTS, actual);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.some((v) => v.includes('/webhooks'))).toBe(true);
	});

	it('negative control: a mounted prefix observed as declared-only is a violation', () => {
		const actual = actualFor('declared-only');
		const violations = evaluateBoundaryMounts(declared, EXTERNAL_BOUNDARY_MOUNTS, actual);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.some((v) => v.includes('/api/v1'))).toBe(true);
	});

	it('negative control: a declared prefix with no record is a violation', () => {
		const mounts = Object.fromEntries(
			Object.entries(EXTERNAL_BOUNDARY_MOUNTS).filter(([p]) => p !== '/oauth'),
		) as Record<string, BoundaryMountEntry>;
		const actual = Object.fromEntries(
			Object.entries(actualFor('declared-only')).filter(([p]) => p !== '/oauth'),
		);
		const violations = evaluateBoundaryMounts(declared, mounts, actual);
		expect(violations.some((v) => v.includes('/oauth') && v.includes('no mount record'))).toBe(
			true,
		);
	});

	it('negative control: a record for an undeclared prefix is a violation', () => {
		const mounts = {
			...EXTERNAL_BOUNDARY_MOUNTS,
			'/legacy': { status: 'declared-only', probe: { path: '/legacy/x' } },
		} as Record<string, BoundaryMountEntry>;
		const actual = { ...actualFor('declared-only'), '/legacy': 'declared-only' as const };
		const violations = evaluateBoundaryMounts(declared, mounts, actual);
		expect(violations.some((v) => v.includes('/legacy') && v.includes('not a declared'))).toBe(
			true,
		);
	});
});
