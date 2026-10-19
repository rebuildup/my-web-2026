import type { Meta, StoryObj } from '@storybook/react';
import inventoryJson from '../../quality/asset-license-inventory.json';
import { css, cx } from '../../styled-system/css';
import { DataTable, type TableColumn, type TableRow } from '../editorial/table-code';
import { AssetLicenseReview } from './AssetLicenseReview';
import {
	type AssetLicenseRecord,
	type AssetReview,
	type AssetReviewObservations,
	DECISION_LABEL,
	KIND_LABEL,
	evaluateAssetLicense,
} from './contract.ts';
import { parseAssetInventoryValue } from './inventory.ts';

/**
 * AssetLicenseReview stories — the rights of the assets this repository
 * publishes (Issue #497).
 *
 * The fixtures are the COMMITTED RECORD (`quality/asset-license-inventory.json`),
 * not a hand-written sample: a story that invents an asset would document
 * a licence nobody ships, and the committed verification screenshot would
 * then be evidence of nothing.
 *
 * Why the stories evaluate the record themselves, and how they stay honest
 * -----------------------------------------------------------------------
 * A browser cannot `stat()` a repository file, so the evaluations here
 * take the record's own claims at face value and every evidence row
 * renders `not-checked` — the card says so on its face rather than
 * implying the gate ran. The AUTHORITATIVE evaluation is
 * `pnpm run assets:license:check`, which runs in CI with real filesystem
 * observations; its report is `docs/verification/legal/asset-license-review.md`.
 *
 * No clock, no fetch: `checkedOn` is the date the record carries, so the
 * screenshot documents a review rather than an instant.
 */

/** Shape the bundler hands us: a parsed JSON document of unknown safety. */
const read = parseAssetInventoryValue(inventoryJson);

/**
 * Face-value observations, scoped to THIS record's own claims.
 *
 * `sha256Of` answers with the digest the record declares, so the browser
 * evaluation asks the question the gate asks ("is the record internally
 * coherent?") without pretending to answer the gate's question ("do
 * those bytes still hash to that?").
 */
function observationsFor(records: readonly AssetLicenseRecord[]): AssetReviewObservations {
	const declared = new Map<string, string | undefined>();
	for (const record of records) {
		for (const item of record.evidence) {
			if (item.kind === 'repository-file') declared.set(item.path, item.sha256);
		}
	}
	return {
		evidenceExists: (path) => declared.has(path),
		sha256Of: (path) => declared.get(path) ?? null,
	};
}

/**
 * One review per record.
 *
 * Per-record evaluation only: coverage is a filesystem question, and a
 * browser has no filesystem, so the screen says nothing about how many
 * audited files a record claims. `pnpm run assets:license:check` is the
 * surface that counts them.
 */
const reviews = read.records.map(
	(record) => [record.id, evaluateAssetLicense(record, observationsFor(read.records))] as const,
);

function reviewFor(id: string): AssetReview {
	const review = reviews.find(([recordId]) => recordId === id)?.[1];
	if (review === undefined) throw new Error(`no record with id ${id} in the committed inventory`);
	return review;
}

function recordFor(id: string): AssetLicenseRecord {
	const record = read.records.find((item) => item.id === id);
	if (record === undefined) throw new Error(`no record with id ${id} in the committed inventory`);
	return record;
}

/** The artwork a visitor can already fetch, reviewed on its own. */
const FEATURED_RECORD_ID = 'share-procon2026-guide';
/** The bundled web fonts whose provenance this repository does not record. */
const HELD_RECORD_ID = 'share-procon2026-fonts';

const pageClassName = css({
	fontFamily: 'sans',
	background: 'bg.canvas',
	color: 'text.default',
	padding: '8',
	display: 'flex',
	flexDirection: 'column',
	gap: '6',
	maxWidth: '80rem',
	marginInline: 'auto',
});

const introClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
	paddingBottom: '5',
});

const introTitleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '2xl',
	fontWeight: '700',
	lineHeight: '1.2',
	color: 'text.default',
});

const introBodyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.8',
	color: 'text.muted',
	maxWidth: '60rem',
});

const sectionTitleClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	letterSpacing: '0.08em',
	color: 'text.muted',
});

const scopeClassName = css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
	gap: '4',
});

const scopeItemClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	padding: '4',
	borderRadius: '3',
	background: 'bg.subtle',
});

const scopeLabelClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const scopeBodyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.8',
	color: 'text.default',
});

/** File count as the record states it: the gate owns the audited count. */
function claimedFileCount(record: AssetLicenseRecord): string {
	return record.covers.length === 0 ? '—' : record.covers.join(' , ');
}

/**
 * The record roster.
 *
 * `DataTable` is the shipped table primitive, so the caption and the
 * scoped header cells are structural rather than remembered
 * (`pnpm run a11y:table:code:check` fails a hand-rolled table that is
 * missing either).
 */
const INVENTORY_COLUMNS: readonly TableColumn[] = [
	// The first column's key names the row header cell the primitive
	// renders (`columns.slice(1)` supplies the `<td>`s), so the record id
	// goes first and the derived decision is an ordinary cell after it.
	{ key: 'record', label: '記録 id' },
	{ key: 'decision', label: '判定' },
	{ key: 'kind', label: '種別' },
	{ key: 'spdx', label: 'ライセンス' },
	{ key: 'covers', label: '対象' },
	{ key: 'title', label: '名称' },
];

function InventoryTable() {
	const rows: readonly TableRow[] = read.records.map((record) => ({
		key: record.id,
		label: record.id,
		cells: {
			record: record.id,
			decision: DECISION_LABEL[reviewFor(record.id).decision],
			kind: KIND_LABEL[record.kind],
			spdx: record.license.spdx,
			covers: claimedFileCount(record),
			title: record.title,
		},
	}));
	return (
		<DataTable
			caption={`資産記録 ${read.records.length} 件（記録 id / 導出判定 / 種別 / ライセンス / 対象 / 名称）`}
			columns={INVENTORY_COLUMNS}
			rows={rows}
			note="対象は記録が主张する covers のパターン。監査対象ファイルの実数は gate が数える（pnpm run assets:license:check）。"
		/>
	);
}

const SCOPE_ITEMS: readonly { label: string; body: string }[] = [
	{
		label: '監査対象（in scope）',
		body: 'Static Assets がそのまま配信する public/** の全ファイルと、ブラウザが第三者に取得させる参照資産。Tool の build 成果物は Issue #466 の tools:artifact:check が所有し、ここではclaimedしない。',
	},
	{
		label: '公開する情報',
		body: '記録が持つのは資産名・権利者・ライセンス識別子・再配布条件・検証方法・確認日・根拠ファイル・公開パス・外部ホスト。氏名・連絡先・位置情報などの個人データは記録に持たせない。',
	},
	{
		label: '外部通信',
		body: 'この画面と gate はネットワークを一切使わない。参照資産のホスト名（fonts.googleapis.com / fonts.gstatic.com / use.typekit.net）は記録から読むだけで、取得も表示もしない。URL のパスや資格情報は出力しない。',
	},
];

/**
 * The verification screen the capture script photographs: the featured
 * asset's review, the held asset's review, every record's decision, and
 * the scope the audit covers.
 */
export function AssetLicenseReviewGallery() {
	return (
		<main className={pageClassName} data-testid="asset-license-gallery">
			<header className={introClassName}>
				<h1 className={introTitleClassName}>資産の権利 / 出典 / ライセンス検証（Issue #497）</h1>
				<p className={introBodyClassName}>
					この画面の判定は <code>quality/asset-license-inventory.json</code>{' '}
					から導出したものです。根拠ファイル的存在と sha256 の一致は gate (
					<code>pnpm run assets:license:check</code>) が CI
					で確認し、各根拠行はこの画面では「未確認」と表示されます。記録は「公開中である」とは書けますが「レビュー済みである」とは書けません。
				</p>
			</header>

			{read.ok ? null : (
				<section aria-labelledby="shape" className={scopeItemClassName}>
					<p className={scopeLabelClassName} id="shape">
						記録の shape が読めていません（{read.findings.length} 件）
					</p>
					<ul>
						{read.findings.map((item) => (
							<li className={scopeBodyClassName} key={`${item.subject}-${item.message}`}>
								<code>{item.code}</code> {item.subject}: {item.message}
							</li>
						))}
					</ul>
				</section>
			)}

			<section aria-labelledby="featured">
				<p className={sectionTitleClassName} id="featured">
					コンテンツ 1 件の権利 / 出典 / ライセンス（既に公開されている静的ページ）
				</p>
				<AssetLicenseReview
					record={recordFor(FEATURED_RECORD_ID)}
					review={reviewFor(FEATURED_RECORD_ID)}
				/>
			</section>

			<section aria-labelledby="held">
				<p className={sectionTitleClassName} id="held">
					判断の分かれ目 — 由来未記録で同梱されている資産
				</p>
				<AssetLicenseReview record={recordFor(HELD_RECORD_ID)} review={reviewFor(HELD_RECORD_ID)} />
			</section>

			<section aria-labelledby="inventory">
				<p className={sectionTitleClassName} id="inventory">
					記録一覧（{read.records.length} 件）
				</p>
				<InventoryTable />
			</section>

			<section aria-labelledby="scope" className={scopeClassName}>
				{SCOPE_ITEMS.map((item) => (
					<div className={scopeItemClassName} key={item.label}>
						<p className={scopeLabelClassName}>{item.label}</p>
						<p className={scopeBodyClassName}>{item.body}</p>
					</div>
				))}
			</section>
		</main>
	);
}

const meta = {
	title: 'Asset license review (#497)',
	component: AssetLicenseReview,
	parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AssetLicenseReview>;

export default meta;

type Story = StoryObj<typeof AssetLicenseReview>;

export const FeaturedAsset: Story = {
	args: { record: recordFor(FEATURED_RECORD_ID), review: reviewFor(FEATURED_RECORD_ID) },
};

/** The held case: the page ships bytes this repository cannot account for. */
export const HeldAsset: Story = {
	args: { record: recordFor(HELD_RECORD_ID), review: reviewFor(HELD_RECORD_ID) },
};

/** A referenced font: nothing is redistributed, so the decision is its own. */
export const ReferencedFont: Story = {
	args: { record: recordFor('web-fonts-google'), review: reviewFor('web-fonts-google') },
};

/** The whole audit on one screen — this is what the capture photographs. */
export const Gallery: StoryObj = {
	render: () => <AssetLicenseReviewGallery />,
};
