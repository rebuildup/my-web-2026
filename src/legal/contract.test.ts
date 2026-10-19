import { describe, expect, it } from 'vitest';
import {
	type AssetInventoryInput,
	type AssetLicenseRecord,
	type AssetReviewObservations,
	coverPatternToRegExp,
	evaluateAssetInventory,
	evaluateAssetLicense,
	filesClaimedBy,
	isBareHostname,
	isKnownAssetLicenseId,
	isRepositoryOrigin,
	isUsableProviderReference,
	summarizeAssetReview,
	verdictFor,
} from './contract';

/**
 * Rule tests for the rights-review contract (Issue #497).
 *
 * The properties asserted here are the ones a reviewer relies on when
 * the gate is red: a record cannot clear itself, an unreviewed file
 * cannot pass, and a changed licence file cannot inherit an old
 * clearance. Everything is exercised against synthetic records, because
 * the contract must be decidable for an asset nobody has seen yet — the
 * committed record is reviewed by the gate, not by these tests.
 */

const NO_FILES: AssetReviewObservations = {
	evidenceExists: () => false,
	sha256Of: () => null,
};

const everythingExists: AssetReviewObservations = {
	evidenceExists: () => true,
	sha256Of: (path) => `sha256-of-${path}`,
};

function record(overrides: Partial<AssetLicenseRecord> = {}): AssetLicenseRecord {
	return {
		id: 'fixture-asset',
		kind: 'image',
		title: 'fixture asset',
		summary: 'a synthetic record used by the rule tests',
		covers: ['public/fixture/**'],
		publicPaths: ['/fixture/one.png'],
		origin: 'repository-generated',
		rightsHolder: 'rebuildup',
		license: {
			spdx: 'MIT',
			redistribution: 'bundled',
			attributionRequired: false,
			attributionText: null,
			attributionDeliveredAt: null,
			conditions: [],
		},
		verification: {
			method: 'repository-evidence',
			checkedOn: '2026-10-19',
			note: 'reviewed against repository bytes',
		},
		evidence: [{ kind: 'repository-file', path: 'LICENSE' }],
		publication: 'published',
		externalHosts: [],
		...overrides,
	};
}

function codes(review: { findings: readonly { code: string }[] }): string[] {
	return review.findings.map((item) => item.code);
}

describe('cover patterns', () => {
	it('keeps `*` inside one path segment', () => {
		expect(coverPatternToRegExp('public/icons/*').test('public/icons/one.png')).toBe(true);
		expect(coverPatternToRegExp('public/icons/*').test('public/icons/nested/one.png')).toBe(false);
	});

	it('lets `**` cross segments and anchors both ends', () => {
		expect(coverPatternToRegExp('public/icons/**').test('public/icons/a/b/one.png')).toBe(true);
		expect(coverPatternToRegExp('public/icons/**').test('public/share/icons/one.png')).toBe(false);
	});

	it('reads `**/` as "zero or more directories"', () => {
		const pattern = 'public/share/**/images/*.png';
		expect(coverPatternToRegExp(pattern).test('public/share/a/images/one.png')).toBe(true);
		expect(coverPatternToRegExp(pattern).test('public/share/images/one.png')).toBe(true);
	});

	it('claims every audited file a record matches, and nothing else', () => {
		const claimed = filesClaimedBy(
			['public/icons/**', 'public/og/*.png'],
			['public/icons/a.png', 'public/og/one.png', 'public/og/two.png', 'docs/other.png'],
		);
		expect(claimed).toEqual(['public/icons/a.png', 'public/og/one.png', 'public/og/two.png']);
	});

	it('hands a file over when the record excludes it', () => {
		const claimed = filesClaimedBy(
			['public/fonts/**'],
			['public/fonts/a.woff2', 'public/fonts/b.woff2'],
			['public/fonts/b.woff2'],
		);
		expect(claimed).toEqual(['public/fonts/a.woff2']);
	});
});

describe('vocabulary guards', () => {
	it('accepts NOASSERTION as an answer and refuses a bare word', () => {
		expect(isKnownAssetLicenseId('MIT')).toBe(true);
		expect(isKnownAssetLicenseId('NOASSERTION')).toBe(true);
		expect(isKnownAssetLicenseId('free to use')).toBe(false);
		expect(isKnownAssetLicenseId(undefined)).toBe(false);
	});

	it('recognises only origins this repository can prove', () => {
		expect(isRepositoryOrigin('repository-authored')).toBe(true);
		expect(isRepositoryOrigin('repository-generated')).toBe(true);
		expect(isRepositoryOrigin('unknown-provenance')).toBe(false);
		expect(isRepositoryOrigin('third-party-referenced')).toBe(false);
	});

	it('refuses anything that is not a bare hostname', () => {
		expect(isBareHostname('fonts.gstatic.com')).toBe(true);
		expect(isBareHostname('fonts.gstatic.com/path')).toBe(false);
		expect(isBareHostname('https://fonts.gstatic.com')).toBe(false);
		expect(isBareHostname('user@host.example')).toBe(false);
	});

	it('accepts only credential-free https provider references', () => {
		expect(isUsableProviderReference('https://fonts.example/specimen')).toBe(true);
		expect(isUsableProviderReference('http://fonts.example/specimen')).toBe(false);
		expect(isUsableProviderReference('https://user:pass@fonts.example')).toBe(false);
		expect(isUsableProviderReference('not a url')).toBe(false);
	});
});

describe('evaluateAssetLicense', () => {
	it('clears a record whose evidence is in the repository', () => {
		const review = evaluateAssetLicense(record(), everythingExists);
		expect(review.decision).toBe('publishable');
		expect(review.findings).toEqual([]);
	});

	it('holds a record whose evidence file does not exist', () => {
		const review = evaluateAssetLicense(record(), NO_FILES);
		expect(review.decision).toBe('hold');
		expect(codes(review)).toContain('L004');
		expect(review.findings.find((item) => item.code === 'L004')?.severity).toBe('error');
	});

	it('holds a record whose pinned evidence changed after the review', () => {
		const pinned = record({
			evidence: [{ kind: 'repository-file', path: 'LICENSE', sha256: 'a'.repeat(64) }],
		});
		const review = evaluateAssetLicense(pinned, everythingExists);
		expect(review.decision).toBe('hold');
		expect(codes(review)).toContain('L005');
	});

	it('accepts a pinned digest that still matches', () => {
		const digest = 'b'.repeat(64);
		const pinned = record({
			evidence: [{ kind: 'repository-file', path: 'LICENSE', sha256: digest }],
		});
		const review = evaluateAssetLicense(pinned, {
			evidenceExists: () => true,
			sha256Of: () => digest,
		});
		expect(review.decision).toBe('publishable');
	});

	it('refuses a licence identifier this repository cannot mean', () => {
		const review = evaluateAssetLicense(
			record({ license: { ...record().license, spdx: 'free' as 'MIT' } }),
			everythingExists,
		);
		expect(review.decision).toBe('hold');
		expect(codes(review)).toContain('L003');
	});

	it('requires an unmanaged asset to point at something that was read', () => {
		const review = evaluateAssetLicense(
			record({ origin: 'third-party-bundled', evidence: [] }),
			everythingExists,
		);
		expect(review.decision).toBe('hold');
		expect(codes(review)).toContain('L006');
	});

	it('records "not verified" as a hold rather than as a failure to parse', () => {
		const review = evaluateAssetLicense(
			record({
				origin: 'unknown-provenance',
				license: { ...record().license, spdx: 'NOASSERTION' },
				verification: { method: 'none', checkedOn: null, note: 'no evidence in the tree' },
			}),
			everythingExists,
		);
		expect(review.decision).toBe('hold');
		expect(review.findings.filter((item) => item.severity === 'error')).toEqual([]);
		expect(codes(review)).toContain('L017');
		expect(codes(review)).toContain('L018');
	});

	it('reports a missing review date as a warning, not as a clearance', () => {
		const review = evaluateAssetLicense(
			record({ verification: { method: 'repository-evidence', checkedOn: null, note: 'when?' } }),
			everythingExists,
		);
		expect(review.decision).toBe('publishable');
		expect(codes(review)).toContain('L013');
	});

	it('holds an attribution duty with no attribution text', () => {
		const base = record().license;
		const review = evaluateAssetLicense(
			record({ license: { ...base, attributionRequired: true, attributionText: null } }),
			everythingExists,
		);
		expect(review.decision).toBe('hold');
		expect(codes(review)).toContain('L007');
	});

	it('warns when required attribution is not delivered anywhere', () => {
		const base = record().license;
		const review = evaluateAssetLicense(
			record({
				license: {
					...base,
					attributionRequired: true,
					attributionText: 'Font: Example',
					attributionDeliveredAt: null,
				},
			}),
			everythingExists,
		);
		expect(review.decision).toBe('publishable');
		expect(codes(review)).toContain('L008');
	});

	it('accepts attribution that is recorded and delivered', () => {
		const base = record().license;
		const review = evaluateAssetLicense(
			record({
				license: {
					...base,
					attributionRequired: true,
					attributionText: 'Font: Example',
					attributionDeliveredAt: '/licenses',
				},
			}),
			everythingExists,
		);
		expect(review.decision).toBe('publishable');
		expect(review.findings).toEqual([]);
	});

	it('reports a referenced asset with no recorded host', () => {
		const review = evaluateAssetLicense(
			record({ origin: 'third-party-referenced', externalHosts: [] }),
			everythingExists,
		);
		expect(review.decision).toBe('provider-terms');
		expect(codes(review)).toContain('L012');
	});

	it('never reports a provider reference as clearance', () => {
		const review = evaluateAssetLicense(
			record({ origin: 'third-party-referenced', externalHosts: ['fonts.example'] }),
			everythingExists,
		);
		expect(review.decision).toBe('provider-terms');
		expect(review.findings.some((item) => item.severity === 'error')).toBe(false);
	});

	it('reports a held asset that is declared published', () => {
		const review = evaluateAssetLicense(
			record({
				origin: 'unknown-provenance',
				license: { ...record().license, spdx: 'NOASSERTION' },
				verification: { method: 'none', checkedOn: null, note: 'unrecorded' },
				publication: 'published',
			}),
			everythingExists,
		);
		const held = review.findings.find((item) => item.code === 'L010');
		expect(held?.severity).toBe('warn');
	});

	it('does not warn about a held asset that is not published', () => {
		const review = evaluateAssetLicense(
			record({
				origin: 'unknown-provenance',
				license: { ...record().license, spdx: 'NOASSERTION' },
				verification: { method: 'none', checkedOn: null, note: 'unrecorded' },
				publication: 'hold',
			}),
			everythingExists,
		);
		expect(codes(review)).not.toContain('L010');
	});

	it('refuses a provider reference that is not a usable https URL', () => {
		const review = evaluateAssetLicense(
			record({
				origin: 'third-party-referenced',
				externalHosts: ['fonts.example'],
				evidence: [{ kind: 'external-reference', url: 'http://fonts.example' }],
			}),
			everythingExists,
		);
		expect(review.decision).toBe('hold');
		expect(codes(review)).toContain('L016');
	});
});

function inventory(overrides: Partial<AssetInventoryInput> = {}): AssetInventoryInput {
	return {
		records: [record()],
		auditedFiles: ['public/fixture/one.png'],
		observations: everythingExists,
		...overrides,
	};
}

describe('evaluateAssetInventory', () => {
	it('passes when every audited file is claimed once', () => {
		const result = evaluateAssetInventory(inventory());
		expect(result.verdict).toBe('PASS');
		expect(result.reviews[0].files).toEqual(['public/fixture/one.png']);
		expect(result.summary.claimedFiles).toBe(1);
	});

	it('fails on an audited file no record claims', () => {
		const result = evaluateAssetInventory(
			inventory({ auditedFiles: ['public/fixture/one.png', 'public/other/new.png'] }),
		);
		expect(result.verdict).toBe('FAIL');
		expect(result.findings.find((item) => item.code === 'L001')?.subject).toBe(
			'public/other/new.png',
		);
		expect(result.summary.uncoveredFiles).toBe(1);
	});

	it('fails when two records claim the same file', () => {
		const result = evaluateAssetInventory(
			inventory({ records: [record(), record({ id: 'fixture-asset-2' })] }),
		);
		expect(result.verdict).toBe('FAIL');
		expect(result.findings.filter((item) => item.code === 'L002')).toHaveLength(1);
	});

	it('lets one record hand a file to another without claiming it twice', () => {
		const result = evaluateAssetInventory(
			inventory({
				records: [
					record({ id: 'fonts-directory', excludes: ['public/fixture/one.png'] }),
					record({ id: 'one-font', covers: ['public/fixture/one.png'] }),
				],
				auditedFiles: ['public/fixture/one.png', 'public/fixture/two.png'],
			}),
		);
		expect(result.verdict).toBe('PASS');
		expect(result.findings.filter((item) => item.code === 'L002')).toEqual([]);
		expect(result.findings.filter((item) => item.code === 'L001')).toEqual([]);
		expect(result.reviews.find((item) => item.id === 'fonts-directory')?.files).toEqual([
			'public/fixture/two.png',
		]);
		expect(result.reviews.find((item) => item.id === 'one-font')?.files).toEqual([
			'public/fixture/one.png',
		]);
	});

	it('fails when every record excludes the same file', () => {
		const result = evaluateAssetInventory(
			inventory({
				records: [
					record({ id: 'fonts-directory', excludes: ['public/fixture/one.png'] }),
					record({ id: 'one-font', excludes: ['public/fixture/one.png'] }),
				],
			}),
		);
		expect(result.verdict).toBe('FAIL');
		expect(result.findings.find((item) => item.code === 'L001')?.subject).toBe(
			'public/fixture/one.png',
		);
	});

	it('fails on a duplicated record id', () => {
		const result = evaluateAssetInventory(inventory({ records: [record(), record()] }));
		expect(result.verdict).toBe('FAIL');
		expect(result.findings.some((item) => item.code === 'L014')).toBe(true);
	});

	it('warns when a record claims nothing that exists', () => {
		const result = evaluateAssetInventory(
			inventory({
				records: [record(), record({ id: 'other', covers: ['public/other/**'] })],
				auditedFiles: ['public/other/one.png'],
			}),
		);
		expect(result.verdict).toBe('WARN');
		expect(result.findings.find((item) => item.code === 'L009')?.severity).toBe('warn');
	});

	it('accepts a record that covers no file at all (a referenced asset)', () => {
		const result = evaluateAssetInventory(
			inventory({
				records: [
					record({
						id: 'referenced-font',
						kind: 'font',
						covers: [],
						publicPaths: [],
						origin: 'third-party-referenced',
						externalHosts: ['fonts.example'],
					}),
					record(),
				],
			}),
		);
		expect(result.verdict).toBe('INFO');
		expect(result.reviews.find((item) => item.id === 'referenced-font')?.files).toEqual([]);
	});
});

describe('summaries', () => {
	it('takes the verdict from the worst severity present', () => {
		expect(verdictFor([])).toBe('PASS');
		expect(
			verdictFor([{ code: 'L011', severity: 'info', subject: 'a', message: 'm', remedy: 'r' }]),
		).toBe('INFO');
		expect(
			verdictFor([
				{ code: 'L017', severity: 'info', subject: 'a', message: 'm', remedy: 'r' },
				{ code: 'L010', severity: 'warn', subject: 'b', message: 'm', remedy: 'r' },
			]),
		).toBe('WARN');
		expect(
			verdictFor([
				{ code: 'L010', severity: 'warn', subject: 'b', message: 'm', remedy: 'r' },
				{ code: 'L001', severity: 'error', subject: 'c', message: 'm', remedy: 'r' },
			]),
		).toBe('FAIL');
	});

	it('counts each decision and each severity', () => {
		const evaluated = evaluateAssetInventory(
			inventory({
				records: [
					record(),
					record({
						id: 'held',
						origin: 'unknown-provenance',
						license: { ...record().license, spdx: 'NOASSERTION' },
						verification: { method: 'none', checkedOn: null, note: 'unrecorded' },
					}),
					record({
						id: 'referenced',
						covers: [],
						publicPaths: [],
						origin: 'third-party-referenced',
						externalHosts: ['fonts.example'],
					}),
				],
			}),
		);
		const summary = summarizeAssetReview({
			reviews: evaluated.reviews,
			findings: [
				{ code: 'L017', severity: 'info', subject: 'held', message: 'm', remedy: 'r' },
				{ code: 'L010', severity: 'warn', subject: 'held', message: 'm', remedy: 'r' },
				{ code: 'L001', severity: 'error', subject: 'f', message: 'm', remedy: 'r' },
			],
			auditedFiles: 3,
			uncoveredFiles: 1,
		});
		expect(summary.records).toBe(3);
		expect(summary.publishable).toBe(1);
		expect(summary.hold).toBe(1);
		expect(summary.providerTerms).toBe(1);
		expect(summary.errors).toBe(1);
		expect(summary.warnings).toBe(1);
		expect(summary.infos).toBe(1);
		expect(summary.verdict).toBe('FAIL');
	});
});
