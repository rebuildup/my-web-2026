import type {
	PortfolioCaseStudyClaimClass,
	PortfolioCaseStudySection,
} from '../components/PortfolioCaseStudy';

/**
 * Case-study fixture for Issue #519 — one real, already-public work.
 *
 * The work is `my-web-2026` itself: the platform's own repository is
 * public, so every `confirmed` statement below can be pointed at a
 * shipped artefact (the repo, the release, the CI gate), and no
 * unpublished material is used (acceptance: 未公開素材を使わない).
 *
 * Provenance of each statement:
 *
 *   - `confirmed` entries restate facts already published by the
 *     platform itself — `src/portfolio/seed.ts` (`motivationMd`,
 *     `architectureMd`, `evidenceMd`), `docs/personal/domain.md` §8/§9
 *     and the shipped 0.1.0 release record.
 *   - `period-estimate` entries record what was believed or planned
 *     AT THE TIME (the migration target window, the unread inventory
 *     of the old site). They are labelled estimates precisely because
 *     they are not outcomes.
 *   - `current-evaluation` entries are the assessment as of the
 *     fixture's writing — including the unfinished part. Issue #519
 *     requires 失敗 / 保留 to stay visible, so the evaluation says the
 *     migration is still in progress rather than implying completion.
 *
 * This file is fixture data: it is excluded from the public-copy
 * editorial gate (the fixtures exclusion in
 * `quality/copy-editorial-surfaces.json`) because Storybook samples
 * are not visitor copy. When a real project's case study is authored
 * for publication, its text goes through the same copy review as any
 * other public Japanese.
 */

export interface PortfolioCaseStudyFixture {
	readonly title: string;
	readonly periodLabel: string;
	readonly summary: string;
	readonly sections: readonly PortfolioCaseStudySection[];
}

function entry(claimClass: PortfolioCaseStudyClaimClass, text: string) {
	return { claimClass, text };
}

export const MY_WEB_2026_CASE_STUDY: PortfolioCaseStudyFixture = {
	title: 'my-web-2026 — Personal Web Platform on Cloudflare Workers',
	periodLabel: '2025-09 - present',
	summary:
		'旧 my-web-2025 の「何でも 1 site に乗せる実験」を、obligation ごとの境界を持つ personal Web Platform として再構築した記録。',
	sections: [
		{
			id: 'goal',
			heading: '目的 / Goal',
			entries: [
				entry(
					'confirmed',
					'旧 my-web-2025 が portfolio・workshop・Tools・About を 1 site に統合する実験になっていたため、personal information / capability / integration を長期的に扱える platform へ再設計する。',
				),
				entry(
					'period-estimate',
					'開始時点では旧 site の機能とコンテンツの棚卸しが終わっておらず、移行対象の範囲と完了時期は仮の見積もりだった。',
				),
			],
		},
		{
			id: 'options',
			heading: '選択肢 / Options',
			entries: [
				entry('confirmed', '既存 my-web-2025 の改修継続と、新しい基盤を別に立てる構築を比較した。'),
				entry(
					'period-estimate',
					'旧 site の構造をそのまま引き継ぐ案は、obligation の境界が曖昧なまま残ると判断し、採用しなかった。',
				),
			],
		},
		{
			id: 'decision',
			heading: '決定 / Decision',
			entries: [
				entry(
					'confirmed',
					'obligation-oriented architecture (ADR-0008) を採用し、TanStack Start / Hono / Panda CSS / Cloudflare Workers (D1 + R2) を 1 Worker / 1 repo で運用する構成にした。',
				),
				entry(
					'confirmed',
					'obligation と path の対応は scripts/check-architecture.mjs が機械的に検査し、依存方向の逆流を CI で止める。',
				),
			],
		},
		{
			id: 'verification',
			heading: '検証結果 / Verification',
			entries: [
				entry(
					'confirmed',
					'0.1.0 Foundation を 2026-09-11 に shipped し、CI の validate:integration が format / lint / typecheck / test / build / wrangler dry-run を一括で検証している。',
				),
				entry(
					'period-estimate',
					'フル migration の完了目標は 2026-10 と置いていたが、これは計画上の推定であり、達成の実績ではない。',
				),
				entry(
					'current-evaluation',
					'Foundation は稼働しているが旧 site からの移行は継続中で、完成度の評価は公開時点のものでしかない。未公開の機能や素材はこのケーススタディにも使っていない。',
				),
			],
		},
	],
};
