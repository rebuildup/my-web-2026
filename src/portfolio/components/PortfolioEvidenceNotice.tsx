import { css } from '../../../styled-system/css';

/**
 * PortfolioEvidenceNotice — the public face of "we have no rights
 * record for this" (ADR-0019 §2.5).
 *
 * Why this component exists
 * -------------------------
 * The owner's decision (Issue #811, 2026-11-02) is that the rights
 * review is NOT a precondition for publication: the legacy corpus has no
 * rights record at all, and it is published anyway. That is only
 * honest if the reader can see it. A published image whose rights nobody
 * recorded, shown without a word about it, reads exactly like a cleared
 * one — which is the failure ADR-0019 §2.1 exists to prevent.
 *
 * So the obligation is narrow and mechanical:
 *
 *   1. an asset that is published with `evidenceStatus !== 'reviewed'`
 *      states that state where the asset is shown;
 *   2. nothing that is not `reviewed` is ever labelled as reviewed.
 *
 * The rights gate checks both mechanically: it reads the marker below
 * out of this file (`quality/asset-license-publication-decision.json` →
 * `publications[].disclosure`), so deleting the marker — or the notice —
 * turns `pnpm run assets:license:check` red. That is the fail-visible
 * half of the decision: the state cannot be hidden silently.
 *
 * The text says what is true and nothing more: it does not claim the
 * work is cleared, does not claim it is infringing, and does not
 * apologise for a decision the reader did not make. It also carries BOTH
 * axes of ADR-0019 §2.2 — what the repository does not know (no rights
 * record) AND what it does (the publication decision, recorded and
 * confirmed) — so "unreviewed" cannot be read as "not approved for
 * publication". Issue #913: a wording that stated only the absence was
 * read by the owner as「承認がない」, contradicting the repository's own
 * decision record.
 */

export interface PortfolioEvidenceNoticeProps {
	/** The project's evidence status; anything but `reviewed` is shown. */
	readonly evidenceStatus: 'reviewed' | 'unreviewed';
}

const noticeClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	// Issue #887: the panel separates itself by FILL, not by a
	// hairline enclosure. `border.subtle` is the system's decorative
	// separator (it carries no information of its own), and this box
	// was painted with the page colour behind it, so the border was
	// doing all of the work. `bg.subtle` is the documented "inset
	// block" role; the disclosure keeps its own boundary without an
	// outline the monochrome hierarchy does not need.
	backgroundColor: 'bg.subtle',
	borderRadius: '4',
	padding: '3',
	marginBlockStart: '4',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	maxWidth: '720px',
});

const labelClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
	margin: '0',
});

const bodyClassName = css({
	margin: '0',
	lineHeight: '1.6',
});

export function PortfolioEvidenceNotice({ evidenceStatus }: PortfolioEvidenceNoticeProps) {
	if (evidenceStatus === 'reviewed') return null;
	return (
		<aside
			className={noticeClassName}
			role="note"
			// The marker the rights gate reads out of this file. Changing
			// it means changing `quality/asset-license-publication-decision.json`
			// in the same commit — which is the point: the disclosure and
			// its check cannot drift apart silently.
			data-evidence-status="unreviewed"
		>
			<p className={labelClassName}>Rights review: unreviewed / 権利レビュー未実施</p>
			<p className={bodyClassName}>
				この作品の権利記録（著作者・出典・ライセンス）はこのリポジトリにありません。公開の可否は決定・記録済みであり、この作品はその決定で公開されています。記録が無いまま公開しているため、公開面にその状態を表示しています。
			</p>
		</aside>
	);
}
