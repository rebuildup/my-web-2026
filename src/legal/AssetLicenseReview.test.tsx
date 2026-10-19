import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssetLicenseReview } from './AssetLicenseReview';
import {
	type AssetLicenseRecord,
	type AssetReviewObservations,
	evaluateAssetLicense,
} from './contract.ts';

/**
 * SSR markup tests for the review surface (Issue #497).
 *
 * `renderToStaticMarkup` is the shipped rendering path, and the
 * properties under test are about what a READER is told — the assertions
 * are therefore presence and absence:
 *
 *   - the decision badge is the DERIVED decision, never the declared
 *     publication state, so a held asset cannot present itself as
 *     reviewed because a record says it is published;
 *   - a rights holder nobody recorded renders as an explicit
 *     "not recorded" cell rather than as an empty one;
 *   - evidence rows say `not-checked` unless a caller observed them, so
 *     the screen never implies the filesystem check it cannot do;
 *   - a provider reference is shown as a hostname, so a path or a
 *     credential in someone else's URL cannot reach a reader.
 */

const NOTHING_EXISTS: AssetReviewObservations = {
	evidenceExists: () => false,
	sha256Of: () => null,
};

function record(overrides: Partial<AssetLicenseRecord> = {}): AssetLicenseRecord {
	return {
		id: 'fixture-asset',
		kind: 'image',
		title: 'fixture asset',
		summary: 'a synthetic record',
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
			conditions: ['MIT で配布'],
		},
		verification: { method: 'repository-evidence', checkedOn: '2026-10-19', note: 'reviewed' },
		evidence: [{ kind: 'repository-file', path: 'LICENSE' }],
		publication: 'published',
		externalHosts: [],
		...overrides,
	};
}

function render(
	source: AssetLicenseRecord,
	observations = NOTHING_EXISTS,
	states?: readonly ('verified' | 'missing' | 'not-checked')[],
) {
	return renderToStaticMarkup(
		<AssetLicenseReview
			record={source}
			review={evaluateAssetLicense(source, observations)}
			evidenceStates={states}
		/>,
	);
}

describe('AssetLicenseReview', () => {
	it('states the derived decision rather than the declared publication state', () => {
		const held = record({
			origin: 'unknown-provenance',
			rightsHolder: null,
			license: { ...record().license, spdx: 'NOASSERTION' },
			verification: { method: 'none', checkedOn: null, note: 'no evidence' },
		});
		const html = render(held);
		expect(html).toContain('保留 / hold');
		expect(html).toContain('公開状態: 公開中');
		expect(html).toContain('data-decision="hold"');
	});

	it('marks a publishable record as publishable', () => {
		const html = render(record(), { evidenceExists: () => true, sha256Of: () => null });
		expect(html).toContain('公開可 / publishable');
		expect(html).toContain('data-decision="publishable"');
	});

	it('says a referenced asset is governed by provider terms, not cleared', () => {
		const referenced = record({
			kind: 'font',
			origin: 'third-party-referenced',
			covers: [],
			publicPaths: [],
			externalHosts: ['fonts.example'],
		});
		const html = render(referenced, { evidenceExists: () => true, sha256Of: () => null });
		expect(html).toContain('提供者条件 / provider-terms');
		expect(html).toContain('fonts.example');
	});

	it('never renders an empty rights-holder cell', () => {
		const html = render(record({ rightsHolder: null }));
		expect(html).toContain('未記録 / not recorded');
	});

	it('never renders an empty review-date cell', () => {
		const html = render(record({ verification: { method: 'none', checkedOn: null, note: 'n/a' } }));
		expect(html).toContain('未記録 / no review recorded');
	});

	it('says evidence is unchecked on this surface by default', () => {
		const html = render(record(), { evidenceExists: () => true, sha256Of: () => null });
		expect(html).toContain('この画面では未確認');
		expect(html).not.toContain('確認済み');
	});

	it('reports a state the caller observed', () => {
		const html = render(record(), { evidenceExists: () => true, sha256Of: () => null }, [
			'verified',
		]);
		expect(html).toContain('確認済み');
	});

	it('shows a provider reference as a hostname only', () => {
		const html = render(
			record({
				origin: 'third-party-referenced',
				externalHosts: ['fonts.example'],
				evidence: [
					{ kind: 'external-reference', url: 'https://user:secret@fonts.example/specimen' },
				],
			}),
		);
		expect(html).toContain('fonts.example');
		expect(html).not.toContain('secret');
		expect(html).not.toContain('specimen');
	});

	it('shows required attribution text and where it is delivered', () => {
		const base = record().license;
		const html = render(
			record({
				license: {
					...base,
					attributionRequired: true,
					attributionText: 'Font: Example',
					attributionDeliveredAt: '/licenses',
				},
			}),
		);
		expect(html).toContain('Font: Example');
		expect(html).toContain('/licenses');
	});

	it('omits the attribution section when no licence demands one', () => {
		expect(render(record())).not.toContain('表示義務');
	});

	it('lists the conditions the licence places on redistribution', () => {
		expect(render(record())).toContain('MIT で配布');
	});

	it('says so when there is nothing to report', () => {
		const html = render(record(), { evidenceExists: () => true, sha256Of: () => null });
		expect(html).toContain('この資産に対する指摘はありません。');
	});

	it('lists every finding a held asset produced', () => {
		const held = record({
			origin: 'unknown-provenance',
			rightsHolder: null,
			license: { ...record().license, spdx: 'NOASSERTION' },
			verification: { method: 'none', checkedOn: null, note: 'no evidence' },
		});
		const html = render(held);
		expect(html).toContain('L017');
		expect(html).toContain('L018');
		expect(html).toContain('L010');
	});

	it('marks the audited scope the record claims', () => {
		expect(render(record())).toContain('public/fixture/**');
	});

	it('shows the files a record hands over to another record', () => {
		const html = render(record({ excludes: ['public/fixture/one.png'] }));
		expect(html).toContain('対象から除く');
		expect(html).toContain('public/fixture/one.png');
	});

	it('omits the carve-out row when the record hands nothing over', () => {
		expect(render(record())).not.toContain('対象から除く');
	});

	it('says so when the asset is not served at a public path', () => {
		const html = render(record({ publicPaths: [] }), {
			evidenceExists: () => true,
			sha256Of: () => null,
		});
		expect(html).toContain('該当なし');
	});

	it('renders no host row claim when nothing is fetched externally', () => {
		expect(render(record())).toContain('なし（同一オリジンのみ）');
	});
});
