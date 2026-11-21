/**
 * Career timeline — the committed fact list behind the `/about`
 * history surface (Issue #389).
 *
 * What this module owns
 * ---------------------
 * The temporal semantics of the migrated legacy history
 * (`https://yusuke-kim.com/about/`): which kind of statement each
 * entry is, where it was observed, and how far that observation has
 * been verified. It is data, not a surface — the presentation lives
 * in `src/about/components/CareerTimeline.tsx` and a route adapter
 * can mount it later without touching this file.
 *
 * The three kinds are the ones `docs/personal/knowledge-model.md`
 * fixes for personal knowledge, and they are deliberately distinct
 * types of statement:
 *
 *   - `event`   — a Historical Event: something that happened at a
 *                 point in time. It does not change afterwards.
 *   - `state`   — a Temporal State: something true over a period
 *                 (「在学中」). It is closed and replaced, never
 *                 edited in place.
 *   - `planned` — an intention with a date (卒業見込み). It is a
 *                 plan, not a fact, and the copy must keep saying so.
 *
 * The verification contract
 * -------------------------
 * Every entry carries `sources` (where the claim was observed) and a
 * `verification` record (`status` + `checkedOn` + optional `note`).
 * `selectPublishableCareerEntries` is the fail-closed gate: ONLY
 * `status: 'verified'` entries may reach a visitor surface.
 *
 *   - `verified`      — corroborated by an owner-approved surface in
 *                       this repository (e.g. `ABOUT_DATA.identity`)
 *                       or an independent public record.
 *   - `legacy-only`   — observed on the legacy site and nowhere else.
 *                       Plausible, but the award name / year is NOT
 *                       independently confirmed, so it stays off the
 *                       public surface until the owner confirms it.
 *   - `unverified`    — the legacy source itself is unsure (the
 *                       original text says 「気がします」). Never
 *                       publishable as written.
 *
 * What is deliberately absent
 * ---------------------------
 * Birth date, family circumstances, purchase history and other
 * private-life detail from the legacy list are NOT migrated: the
 * timeline exists to show education / work-relevant chronology, and
 * `docs/personal/owner.md` keeps private relationships and
 * site-unrelated sensitive information out of the repository. The
 * legacy 「muted」 hobby entries (painting, VOCALOID production,
 * hardware purchases) are likewise excluded — they are private-life
 * texture, not career facts.
 */

/** The kind of temporal statement an entry makes. */
export type CareerEntryKind = 'event' | 'state' | 'planned';

/**
 * How far the claim has been verified. Only `'verified'` is
 * publishable — see the module docstring.
 */
export type CareerVerificationStatus = 'verified' | 'legacy-only' | 'unverified';

/** A place the claim was observed. `url` is absolute. */
export interface CareerSource {
	readonly url: string;
	readonly label?: string;
}

export interface CareerVerification {
	readonly status: CareerVerificationStatus;
	/** ISO date (`YYYY-MM-DD`) the verification was last checked. */
	readonly checkedOn: string;
	readonly note?: string;
}

export interface CareerEntry {
	readonly id: string;
	readonly kind: CareerEntryKind;
	/**
	 * Display date. Precision follows the knowledge model: year-only
	 * facts say `2023`, month-precision facts say `2023.04`, an open
	 * state says `現在`, a plan says its target `2028.03`. The label
	 * is authored, never derived, so an uncertain date cannot be
	 * silently promoted to a precise one.
	 */
	readonly dateLabel: string;
	readonly title: string;
	readonly summary?: string;
	readonly sources: readonly CareerSource[];
	readonly verification: CareerVerification;
}

/** The legacy site section every migrated claim was first observed on. */
export const CAREER_LEGACY_SOURCE_URL = 'https://yusuke-kim.com/about/';

/** The repository that backs the my-web-2026 entries. */
const MY_WEB_2026_REPO_URL = 'https://github.com/rebuildup/my-web-2026';

const LEGACY_SOURCE: CareerSource = {
	url: CAREER_LEGACY_SOURCE_URL,
	label: '旧サイト 経歴',
};

/**
 * The committed timeline. Order is chronological for `event` /
 * `state` entries with `planned` entries last; the component does
 * not re-sort, so the narrative order is decided here.
 *
 * Publishable entries are corroborated by `ABOUT_DATA` (the approved
 * identity snapshot) or by a first-party repository record.
 * `legacy-only` / `unverified` entries are kept IN the file — with
 * their status — so the owner can see exactly which legacy claims
 * are still awaiting confirmation, and so the fail-closed filter
 * has something real to drop.
 */
export const CAREER_TIMELINE: readonly CareerEntry[] = [
	{
		id: 'kosen-enroll-2023-04',
		kind: 'event',
		dateLabel: '2023.04',
		title: '宇部工業高等専門学校 制御情報工学科 入学',
		summary: '制御情報工学科に入学。',
		sources: [LEGACY_SOURCE],
		verification: {
			status: 'verified',
			checkedOn: '2026-11-19',
			note: '公開済みの about identity（宇部高専 制御情報工学科 本科4年）と整合。',
		},
	},
	{
		id: 'kosen-enrolled-current',
		kind: 'state',
		dateLabel: '現在',
		title: '宇部工業高等専門学校 在学中',
		sources: [LEGACY_SOURCE],
		verification: {
			status: 'verified',
			checkedOn: '2026-11-19',
			note: '公開済みの about identity と同一の現在状態。',
		},
	},
	{
		id: 'my-web-2026-release-2026-09',
		kind: 'event',
		dateLabel: '2026.09',
		title: 'my-web-2026 foundation release',
		summary:
			'personal Web Platform の foundation を Cloudflare Workers 上で release。以降 portfolio / about をこの release に統合。',
		sources: [{ url: MY_WEB_2026_REPO_URL, label: 'Repository' }],
		verification: {
			status: 'verified',
			checkedOn: '2026-11-19',
			note: '公開済みの about current 節と portfolio の my-web-2026 記録に整合。',
		},
	},
	{
		id: 'kosen-graduate-2028-03',
		kind: 'planned',
		dateLabel: '2028.03',
		title: '宇部工業高等専門学校 卒業見込み',
		summary: 'software engineer / frontend engineer を主軸として就職する予定。',
		sources: [LEGACY_SOURCE],
		verification: {
			status: 'verified',
			checkedOn: '2026-11-19',
			note: '公開済みの about future 節の記載と整合。予定であり確定事実ではない。',
		},
	},
	// --- Below: observed on the legacy site, NOT publishable yet. -------
	{
		id: 'u16-programming-contest-2023-idea',
		kind: 'event',
		dateLabel: '2023',
		title: 'U-16 プログラミングコンテスト2023 アイデア賞',
		summary: 'Scratch で作成した掛け算ゲームがアイデア賞を受賞（旧サイト記載）。',
		sources: [LEGACY_SOURCE],
		verification: {
			status: 'legacy-only',
			checkedOn: '2026-11-19',
			note: '旧サイトにのみ記載。受賞名・年次を独立した公開記録で確認できていないため公開保留。',
		},
	},
	{
		id: 'u16-programming-contest-2024-awards',
		kind: 'event',
		dateLabel: '2023.11',
		title: 'U-16 プログラミングコンテスト2024 技術賞・企業賞',
		summary: 'Unity で作成した音ゲーが技術賞・企業賞を受賞（旧サイト記載）。',
		sources: [LEGACY_SOURCE],
		verification: {
			status: 'legacy-only',
			checkedOn: '2026-11-19',
			note: '旧サイトにのみ記載。受賞名・年次を独立した公開記録で確認できていないため公開保留。',
		},
	},
	{
		id: 'chugoku-cf-2024-game-first',
		kind: 'event',
		dateLabel: '2024.03',
		title: '中国地区コンピュータフェスティバル ゲーム部門1位',
		summary: 'U-16 プロコンの作品を改善して出場。ユーザー投票による1位（旧サイト記載）。',
		sources: [LEGACY_SOURCE],
		verification: {
			status: 'unverified',
			checkedOn: '2026-11-19',
			note: '旧サイト本文自体が「なにか他に企業賞ももらった気がします」と不確かさを示しており、受賞内容を確定できない。',
		},
	},
];

/**
 * The fail-closed publication gate (Issue #389 acceptance: 「データが
 * 1件も公開承認されない場合の代替表示」 is handled by the component;
 * this function is what decides WHICH entries may be shown at all).
 *
 * Only `verified` entries pass. `legacy-only` and `unverified` stay
 * in the committed file for owner review but can never reach a
 * visitor surface through this selector.
 */
export function selectPublishableCareerEntries(
	entries: readonly CareerEntry[] = CAREER_TIMELINE,
): readonly CareerEntry[] {
	return entries.filter((entry) => entry.verification.status === 'verified');
}
