import { css, cx } from '../../styled-system/css';
import { Badge } from '../editorial/primitives/Badge';
import {
	type AssetLicenseRecord,
	type AssetPublicationDecision,
	type AssetReview,
	type AssetReviewSeverity,
	DECISION_LABEL,
	DECISION_MEANING,
	KIND_LABEL,
	ORIGIN_LABEL,
	PUBLICATION_LABEL,
	REDISTRIBUTION_LABEL,
	VERIFICATION_LABEL,
} from './contract.ts';

/**
 * AssetLicenseReview — the display surface for ONE asset's rights.
 *
 * What a reader is owed, and what this component therefore refuses to do
 * --------------------------------------------------------------------
 * A card that prints a licence id without saying what was checked is how
 * an unreviewed asset gets read as a reviewed one. So every field on this
 * card is either a fact from the reviewed record or a fact the contract
 * DERIVED from that record:
 *
 *   - the decision badge is `review.decision`, never `record.publication`.
 *     A record may say "published"; it may not say "cleared".
 *   - evidence states say `verified` / `missing` / `not-checked`. There is
 *     no "assumed" state: a browser cannot stat a repository file, so the
 *     component renders `not-checked` rather than implying the gate ran.
 *   - a provider reference is shown as a HOSTNAME. The full URL is not
 *     printed, because a reference is someone else's string and may carry
 *     a path or a credential; the gate's status-only rule applies to the
 *     screen that quotes the same record.
 *   - a rights holder that is not recorded renders as an explicit
 *     "未記録" cell, never as an empty cell or a dash that reads as
 *     "nothing to declare".
 *
 * Determinism
 * -----------
 * No clock, no `Date.now()`, no fetch. The checked date is the one the
 * record carries. A card whose text changes between two opens is a card
 * whose committed verification screenshot documents an instant nobody can
 * reproduce.
 *
 * Related: `src/legal/contract.ts` (the rules) and
 * `docs/verification/legal/asset-license-review.md`.
 */

/** What the caller could observe about one evidence entry. */
export type AssetEvidenceState = 'verified' | 'missing' | 'not-checked';

export interface AssetLicenseReviewProps {
	readonly record: AssetLicenseRecord;
	readonly review: AssetReview;
	/**
	 * One state per `record.evidence` entry, in the same order. Omit it
	 * and every entry renders as `not-checked`.
	 */
	readonly evidenceStates?: readonly AssetEvidenceState[];
}

const RIGHTS_HOLDER_UNRECORDED = '未記録 / not recorded';
const NO_PUBLIC_PATH = '該当なし / not served at a public path';
const CHECKED_ON_UNRECORDED = '未記録 / no review recorded';

const SEVERITY_LABEL: Readonly<Record<AssetReviewSeverity, string>> = {
	error: 'エラー',
	warn: '警告',
	info: '情報',
};

const EVIDENCE_STATE_LABEL: Readonly<Record<AssetEvidenceState, string>> = {
	verified: '確認済み',
	missing: '見つからない',
	'not-checked': 'この画面では未確認',
};

/**
 * The badge tone for a decision.
 *
 * `provider-terms` is deliberately NEUTRAL: it is neither a clearance to
 * celebrate nor a violation to alarm about, and colouring it as either
 * would put a claim in the visual language that the contract does not
 * make.
 */
const DECISION_TONE: Readonly<Record<AssetPublicationDecision, 'accent' | 'neutral'>> = {
	publishable: 'accent',
	hold: 'neutral',
	'provider-terms': 'neutral',
};

const cardClassName = css({
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	borderRadius: '4',
	background: 'bg.canvas',
	padding: '5',
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
	maxWidth: '72rem',
});

const headerClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '3',
});

const titleClassName = css({
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.25',
	color: 'text.default',
	margin: '0',
});

const summaryClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.muted',
});

const meaningClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const factsClassName = css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
	gap: '3',
	margin: '0',
});

const factClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	margin: '0',
	padding: '3',
	borderRadius: '3',
	background: 'bg.subtle',
});

const factLabelClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const factValueClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
	overflowWrap: 'anywhere',
});

const listClassName = css({
	margin: '0',
	paddingInlineStart: '4',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const findingsListClassName = css({
	listStyle: 'none',
	margin: '0',
	padding: '0',
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
});

const findingClassName = css({
	borderInlineStartWidth: '2px',
	borderInlineStartStyle: 'solid',
	paddingInlineStart: '3',
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
});

const findingMessageClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const findingRemedyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.7',
	color: 'text.muted',
});

const sectionLabelClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	color: 'text.muted',
});

const FINDING_BORDER: Readonly<Record<AssetReviewSeverity, string>> = {
	error: 'accent.negative',
	warn: 'accent.warning',
	info: 'border.strong',
};

/** Hostname only, so a reference's path and credentials never reach a reader. */
function providerHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '参照 URL を表示できません';
	}
}

function evidenceLabel(kind: AssetLicenseRecord['evidence'][number]): string {
	return kind.kind === 'repository-file' ? kind.path : providerHostname(kind.url);
}

function fact(label: string, value: string) {
	return (
		<div className={factClassName} key={label}>
			<dt className={factLabelClassName}>{label}</dt>
			<dd className={factValueClassName}>{value}</dd>
		</div>
	);
}

export function AssetLicenseReview({ record, review, evidenceStates }: AssetLicenseReviewProps) {
	const states = record.evidence.map((_, index) => evidenceStates?.[index] ?? 'not-checked');
	const hosts = record.externalHosts ?? [];

	return (
		<article
			className={cardClassName}
			data-testid="asset-license-review"
			data-decision={review.decision}
		>
			<header className={headerClassName}>
				<h2 className={titleClassName}>{record.title}</h2>
				<Badge>{KIND_LABEL[record.kind]}</Badge>
				<Badge tone={DECISION_TONE[review.decision]}>{DECISION_LABEL[review.decision]}</Badge>
				<Badge>公開状態: {PUBLICATION_LABEL[record.publication]}</Badge>
			</header>
			<p className={summaryClassName}>{record.summary}</p>
			<p className={meaningClassName}>{DECISION_MEANING[review.decision]}</p>

			<dl className={factsClassName}>
				{fact('権利者 / rights holder', record.rightsHolder ?? RIGHTS_HOLDER_UNRECORDED)}
				{fact('ライセンス / licence', record.license.spdx)}
				{fact('由来 / origin', ORIGIN_LABEL[record.origin])}
				{fact('再配布 / redistribution', REDISTRIBUTION_LABEL[record.license.redistribution])}
				{fact('検証 / verification', VERIFICATION_LABEL[record.verification.method])}
				{fact('確認日 / reviewed on', record.verification.checkedOn ?? CHECKED_ON_UNRECORDED)}
				{fact('対象 / covers', record.covers.join(' , ') || '—')}
				{record.excludes && record.excludes.length > 0
					? fact('対象から除く / excludes', record.excludes.join(' , '))
					: null}
				{fact(
					'公開パス / public paths',
					record.publicPaths && record.publicPaths.length > 0
						? record.publicPaths.join(' , ')
						: NO_PUBLIC_PATH,
				)}
				{fact(
					'外部ホスト / external hosts',
					hosts.length === 0 ? 'なし（同一オリジンのみ）' : hosts.join(' , '),
				)}
			</dl>

			{record.license.conditions.length > 0 ? (
				<section aria-labelledby={`${record.id}-conditions`}>
					<p className={sectionLabelClassName} id={`${record.id}-conditions`}>
						再配布条件 / redistribution conditions
					</p>
					<ul className={listClassName}>
						{record.license.conditions.map((condition) => (
							<li key={condition}>{condition}</li>
						))}
					</ul>
				</section>
			) : null}

			<section aria-labelledby={`${record.id}-evidence`}>
				<p className={sectionLabelClassName} id={`${record.id}-evidence`}>
					根拠 / evidence
				</p>
				<ul className={listClassName} data-testid="asset-license-evidence">
					{record.evidence.map((item, index) => (
						<li key={evidenceLabel(item)}>
							<code>{evidenceLabel(item)}</code> —{' '}
							{item.kind === 'repository-file'
								? 'リポジトリ内ファイル'
								: '提供者側の参照（この画面では取得しません）'}{' '}
							{EVIDENCE_STATE_LABEL[states[index]]}
						</li>
					))}
				</ul>
			</section>

			{record.license.attributionRequired ? (
				<section aria-labelledby={`${record.id}-attribution`}>
					<p className={sectionLabelClassName} id={`${record.id}-attribution`}>
						表示義務 / attribution
					</p>
					<p className={findingMessageClassName}>{record.license.attributionText ?? '—'}</p>
					<p className={findingRemedyClassName}>
						表示先: {record.license.attributionDeliveredAt ?? '未記録'}
					</p>
				</section>
			) : null}

			<section aria-labelledby={`${record.id}-findings`}>
				<p className={sectionLabelClassName} id={`${record.id}-findings`}>
					判定根拠 / findings ({review.findings.length})
				</p>
				{review.findings.length === 0 ? (
					<p className={findingMessageClassName}>この資産に対する指摘はありません。</p>
				) : (
					<ul className={findingsListClassName} data-testid="asset-license-findings">
						{review.findings.map((finding) => (
							<li
								className={cx(
									findingClassName,
									css({ borderInlineStartColor: FINDING_BORDER[finding.severity] }),
								)}
								key={`${finding.code}-${finding.message}`}
							>
								<span className={findingRemedyClassName}>
									<code>{finding.code}</code> {SEVERITY_LABEL[finding.severity]} · {finding.subject}
								</span>
								<p className={findingMessageClassName}>{finding.message}</p>
								<p className={findingRemedyClassName}>{finding.remedy}</p>
							</li>
						))}
					</ul>
				)}
			</section>
		</article>
	);
}
