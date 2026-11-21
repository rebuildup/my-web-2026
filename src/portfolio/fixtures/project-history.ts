import type {
	PortfolioProjectHistoryEvent,
	PortfolioProjectHistoryKind,
} from '../components/PortfolioProjectHistory';

/**
 * Project-history fixture for Issue #518 — one real, already-public
 * work: `my-web-2026` itself. The platform's own repository is
 * public, so every `record` event below points at a committed record
 * (docs/release.md, the seed, a verification artefact), and no
 * unpublished material is used.
 *
 * Provenance of each event:
 *
 *   - `record` events restate dated facts a committed record
 *     publishes. The date granularity is the record's own:
 *     `2025-09` stays month-precision because `seed.ts` records only
 *     the month; `2026-09-11` is day-precision because
 *     `docs/release.md` names the day.
 *   - `recollection` events keep the maker's account of what was
 *     believed AT THE TIME (the migration scope and target were
 *     estimates, not outcomes). They are labelled 記憶 and never
 *     rewritten as fact — the Issue's 「制作の記憶を事実でない言葉に
 *     置き換えない」 rule.
 *
 * What is deliberately absent
 * ---------------------------
 * Release version literals. `package.json#version` is the sole
 * current-version source (AGENTS.md §1) and this fixture names
 * releases by their published codenames instead; the dates and
 * codenames are what `docs/release.md` records. No image is
 * attached: the work has no published project media (`seed.ts`
 * `media: []`), so every event renders text-only — the Issue's
 * fallback requirement is the fixture's actual state, not a
 * degraded mode.
 *
 * This file is fixture data: it is excluded from the public-copy
 * editorial gate (the fixtures exclusion in
 * `quality/copy-editorial-surfaces.json`) because Storybook samples
 * are not visitor copy.
 */

export interface PortfolioProjectHistoryFixture {
	readonly title: string;
	readonly periodLabel: string;
	readonly summary: string;
	readonly events: readonly PortfolioProjectHistoryEvent[];
}

function event(
	id: string,
	kind: PortfolioProjectHistoryKind,
	dateLabel: string,
	precision: 'day' | 'month',
	basis: PortfolioProjectHistoryEvent['basis'],
	title: string,
	detail: string,
	sources: PortfolioProjectHistoryEvent['sources'],
): PortfolioProjectHistoryEvent {
	return { id, kind, dateLabel, precision, basis, title, detail, sources };
}

export const MY_WEB_2026_PROJECT_HISTORY: PortfolioProjectHistoryFixture = {
	title: 'my-web-2026 — Personal Web Platform on Cloudflare Workers',
	periodLabel: '2025-09 - present',
	summary:
		'旧 my-web-2025 の「何でも 1 site に乗せる実験」を、obligation ごとの境界を持つ personal Web Platform として再構築した制作史。個人の経歴やサイトの release 一覧ではなく、この作品自身の年表。',
	events: [
		event(
			'start-2025-09',
			'start',
			'2025-09',
			'month',
			'record',
			'Personal Web Platform の再構築を開始',
			'旧 my-web-2025 が portfolio・workshop・Tools・About を 1 site に統合する実験になっていたため、personal information / capability / integration を長期的に扱える platform へ再設計する方針で制作を始めた。開始月は公開済みの period 表記の粒度に合わせ、日は特定しない。',
			[{ label: 'src/portfolio/seed.ts' }, { label: 'docs/personal/domain.md' }],
		),
		event(
			'estimate-2025-09',
			'note',
			'2025-09',
			'month',
			'recollection',
			'開始時点の見積もり（記憶）',
			'制作当時、旧 site の機能とコンテンツの棚卸しは終わっておらず、移行対象の範囲と完了時期は仮の見積もりだった。フル migration の完了目標を 2026-10 と置いていたが、これは計画上の推定であり実績ではない。記憶としてそのまま残し、事実には書き換えない。',
			[{ label: 'src/portfolio/fixtures/case-study.ts' }],
		),
		event(
			'foundation-2026-09-11',
			'revision',
			'2026-09-11',
			'day',
			'record',
			'Foundation release',
			'platform の foundation として最初に ship された release。外部 HTTP boundary・design tokens・D1 / R2 の binding smoke・CI の quality gate を備える。続く release で marketing layout / editorial / reactions を段階的に追加した。',
			[{ label: 'docs/release.md' }, { label: 'src/portfolio/seed.ts' }],
		),
		event(
			'public-preview-2026-09-19',
			'revision',
			'2026-09-19',
			'day',
			'record',
			'Public Preview release',
			'public preview として実際に使えることを意図した最初の release。',
			[{ label: 'docs/release.md' }],
		),
		event(
			'editorial-reactions-2026-09-20',
			'revision',
			'2026-09-20',
			'day',
			'record',
			'Editorial Reactions release',
			'editorial 面の reactions を扱う release。',
			[{ label: 'docs/release.md' }],
		),
		event(
			'portfolio-publication-2026-11-05',
			'publication',
			'2026-11-05',
			'day',
			'record',
			'旧サイト作品 60 件を production に公開',
			'my-web-2025 から移行した 60 件の portfolio 作品が production の D1 / R2 で公開状態になった。公開にあたり権利レビューは未実施のまま（evidence_status=unreviewed）で、これは ADR-0019 の決定どおりの状態である。',
			[
				{ label: 'docs/verification/portfolio/production-publication-2026-11-05.md' },
				{ label: 'docs/migration/portfolio-2025-to-2026-publication.json' },
				{ label: 'docs/adr/ADR-0019-publication-authority-and-unreviewed-assets.md' },
			],
		),
		event(
			'migration-ongoing-2026-11',
			'note',
			'2026-11',
			'month',
			'record',
			'移行は継続中（完了の評価は公開時点のもの）',
			'旧 site からの移行は継続中で、公開面の未レビュー表示は未了。foundation は稼働しているが、完成度の評価は公開時点のものでしかない。',
			[
				{ label: 'src/portfolio/fixtures/case-study.ts' },
				{ label: 'docs/verification/portfolio/production-publication-2026-11-05.md' },
			],
		),
	],
};
