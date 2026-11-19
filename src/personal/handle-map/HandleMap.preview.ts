/**
 * Handle map — preview data (Issue #524).
 *
 * What this module is
 * -------------------
 * The *data* behind the standalone preview of the name / handle
 * legend: which published name points at which aspect of the same
 * person and the same activity. The component
 * (`HandleMap.tsx`) renders this data; the Storybook story
 * (`HandleMap.stories.tsx`) mounts it; the document
 * (`docs/personal/handle-map.md`) carries the same strings.
 *
 * `scripts/check-handle-map-preview-parity.test.mjs` keeps the three
 * in step on every `pnpm run test`, and it also re-reads the committed
 * records the facts were taken from (`docs/personal/domain.md`,
 * `docs/personal/owner.md`, `src/about/data.ts`,
 * `src/about/links.ts`) so a name or a URL cannot drift away from the
 * record it was read from.
 *
 * What this module is NOT
 * -----------------------
 * It is not approved site copy and it is not a route. The preview is a
 * demo surface under `src/personal/` (Issue #709): it composes
 * `editorial` display primitives only and imports no route, no binding
 * and no peer obligation — `personal -> editorial` is the only edge
 * AGENTS.md §3 declares for it, so `src/about/**` cannot be imported
 * here even though the facts are about the same person. The facts are
 * therefore RESTATED as literals and the parity test is what keeps the
 * restatement honest.
 *
 * The link rule
 * -------------
 * Issue #524 requires that an account with no published record is NOT
 * turned into a link. Every `url` below is a literal that also appears
 * in `src/about/data.ts` (`externalHandles`, the `/about` footer) or
 * `src/about/links.ts` (the `/links` inventory carried over from the
 * predecessor site). The parity test fails if a URL is added here that
 * no committed record publishes — that is the mechanical form of
 * 「非公開アカウントをリンクとして創作しない」.
 */

/** One published link attached to a name. */
export interface HandleMapLink {
	/** The service / account label, as the committed record names it. */
	readonly label: string;
	/** Absolute `https:` URL — must exist verbatim in a committed record. */
	readonly url: string;
}

/** One name in the legend: which aspect of the same person it names. */
export interface HandleMapEntry {
	/** Stable id — not printed. */
	readonly id: string;
	/** The name exactly as it is written publicly. */
	readonly name: string;
	/** Which aspect of the same person / activity the name points at. */
	readonly aspect: string;
	/** What the name is for — one or two sentences, from the canonical docs. */
	readonly description: string;
	/**
	 * Published links only. Empty when no committed record publishes a
	 * URL for this name; `noLinkReason` then says why the legend shows
	 * the name as text instead of a link.
	 */
	readonly links: readonly HandleMapLink[];
	/** Why this name carries no link. Present iff `links` is empty. */
	readonly noLinkReason?: string;
}

/** Document-level metadata the preview renders above the legend. */
export interface HandleMapDocument {
	readonly title: string;
	readonly status: string;
	readonly source: string;
	readonly verification: string;
	readonly preview: string;
}

/** One `##` section of the document that is not the legend itself. */
export interface HandleMapSection {
	/** The `##` heading — byte-identical to the document's heading. */
	readonly heading: string;
	/** The bullet lines, byte-identical to the document's `- ` items. */
	readonly bullets: readonly string[];
}

export const HANDLE_MAP_DOCUMENT: HandleMapDocument = {
	title: '名前と handle の対応 — identity legend',
	status: 'Preview / Issue #524',
	source:
		'典拠: docs/personal/domain.md §1・docs/personal/owner.md・src/about/data.ts・src/about/links.ts・Issue #524 本文',
	verification: '機械検証: scripts/check-handle-map-preview-parity.test.mjs',
	preview: 'プレビュー: src/personal/handle-map/HandleMap.stories.tsx',
} as const;

/** The legend section heading and its lead sentence. */
export const HANDLE_MAP_LEGEND = {
	heading: '名前と側面の対応',
	lead: 'samuido / 361do / rebuildup / yusuke-kim.com と用途別の handle は、すべて同じ一人の人物の異なる側面を指す。別人格・別 organization としては扱わない。',
} as const;

/**
 * The legend entries, in reading order: real name first, then the
 * personal domain, then the public handle and its derivatives.
 */
export const HANDLE_MAP_ENTRIES: readonly HandleMapEntry[] = [
	{
		id: 'real-name',
		name: '木村友亮 / Yusuke Kimura',
		aspect: 'real-name identity',
		description:
			'学校・採用・経歴・対外的な本人確認を含む real-name identity。samuido とは別人格ではない。',
		links: [
			{
				label: 'LinkedIn',
				url: 'https://www.linkedin.com/in/yusuke-kimura-835055398/',
			},
		],
	},
	{
		id: 'personal-domain',
		name: 'yusuke-kim.com',
		aspect: '個人ドメイン',
		description:
			'owner.md が挙げる personal domain。my-web-2026 以前の個人 site が使ってきたドメインで、後継 platform は rebuildup.dev を canonical とする。',
		links: [
			{
				label: 'yusuke-kim.com',
				url: 'https://yusuke-kim.com',
			},
		],
	},
	{
		id: 'samuido',
		name: 'samuido',
		aspect: 'primary public handle',
		description:
			'制作・開発・発信を横断する public creator identity で、最も広い活動名。Web 開発・ソフトウェア開発・After Effects 向けツール・映像制作・デザイン・creative coding・記事や実験を一つの名義の下に置く。',
		links: [
			{ label: 'X (samuido)', url: 'https://x.com/samuido' },
			{ label: 'Qiita', url: 'https://qiita.com/samuido' },
		],
	},
	{
		id: '361do',
		name: '361do',
		aspect: 'stylized / distribution identity',
		description:
			'samuido と同じ人物・同じ活動圏を指す stylized / numeric identity。BOOTH など配布・販売面や social handle に現れる。独立したブランド人格や別 organization として扱わない。',
		links: [
			{ label: 'BOOTH', url: 'https://samuido.booth.pm' },
			{ label: 'BlueSky', url: 'https://bsky.app/profile/361do.bsky.social' },
		],
	},
	{
		id: '361do-sleep',
		name: '361do_sleep',
		aspect: '用途別 social handle（技術・開発側）',
		description: '主に技術・開発側の social handle。',
		links: [
			{ label: 'X (Tech)', url: 'https://x.com/361do_sleep' },
			{ label: 'Zenn', url: 'https://zenn.dev/361do_sleep' },
			{ label: 'YouTube', url: 'https://www.youtube.com/@361do_sleep' },
		],
	},
	{
		id: '361do-design',
		name: '361do_design',
		aspect: '用途別 social handle（映像・デザイン側）',
		description: '主に映像・デザイン側の social handle。',
		links: [{ label: 'X (Design)', url: 'https://x.com/361do_design' }],
	},
	{
		id: 'rebuildup',
		name: 'rebuildup',
		aspect: 'development-facing identity',
		description:
			'主に GitHub 上で使う development-facing identity / repository namespace。open-source・個人開発・agent tooling・architecture・release engineering の文脈で強く現れる。visitor-facing な第一表示名として samuido を置き換えない。',
		links: [
			{ label: 'GitHub', url: 'https://github.com/rebuildup' },
			{ label: 'AtCoder', url: 'https://atcoder.jp/users/rebuildup' },
		],
	},
];

/**
 * The bullet lines one legend entry contributes to the document.
 *
 * The document writes an entry as `名前:` / `側面:` / `説明:` /
 * `公開リンク:` lines. The parity test compares the document's bullets
 * against the strings this function produces, so the legend on screen
 * and the legend in the document cannot drift.
 */
export function handleMapEntryBullets(entry: HandleMapEntry): readonly string[] {
	const bullets = [`名前: ${entry.name}`, `側面: ${entry.aspect}`, `説明: ${entry.description}`];
	if (entry.links.length === 0) {
		bullets.push(`公開リンク: なし — ${entry.noLinkReason ?? '公開 URL の記録が無い。'}`);
	} else {
		for (const link of entry.links) {
			bullets.push(`公開リンク: ${link.label} — ${link.url}`);
		}
	}
	return bullets;
}

/** The document sections after the legend, in document order. */
export const HANDLE_MAP_SECTIONS: readonly HandleMapSection[] = [
	{
		heading: 'リンクの規則',
		bullets: [
			'この凡例が扱うのは、公開承認済みの名前と handle の対応だけである。',
			'各名前は同じ一人の人物の異なる側面を指し、別人格・別 organization として扱わない。',
			'公開 URL の記録が無い名前はリンクにしない。名前そのものはテキストとして残す。',
			'リンク先は src/about/data.ts（/about の externalHandles）・src/about/links.ts（/links の承認済み一覧）・src/about/career.ts（前身 domain の legacy source URL）の記録にある URL だけを使う。',
			'表示位置は未確定であり、この preview は route を持たない。英日以外の locale は必要になってから対応する。',
		],
	},
	{
		heading: '典拠',
		bullets: [
			'docs/personal/domain.md §1 — 名前と handle の canonical な対応（samuido / 361do / rebuildup / channel-specific handles）。',
			'docs/personal/owner.md — primary public handle / stylized identity / development identity / personal domain の整理。',
			'src/about/data.ts — /about が公開する externalHandles と identity.secondary の記述。',
			'src/about/links.ts — /links が公開する承認済みアカウント一覧（前身 site からの引き継ぎを含む）。',
			'src/about/career.ts — 前身 domain（yusuke-kim.com）の legacy source URL。',
			'Issue #524 本文 — 完了条件と Miro 上の根拠（個人 > samuido / 361do_sleep / 361do_design / rebuildup）。',
		],
	},
	{
		heading: '実装と機械検証',
		bullets: [
			'参照文書（正本）: docs/personal/handle-map.md',
			'preview データ: src/personal/handle-map/HandleMap.preview.ts',
			'preview component: src/personal/handle-map/HandleMap.tsx',
			'preview story: src/personal/handle-map/HandleMap.stories.tsx（Storybook の Preview / Handle map）',
			'一致検証: scripts/check-handle-map-preview-parity.test.mjs（pnpm run test が scripts/*.test.mjs を discovery する）',
			'検証画像: docs/verification/identity/handle-map-story.png（node scripts/capture-handle-map.mjs で再生成）',
			'一致が壊れたら fail する。差分は「保留」として文書に明記してから直す。判定を緩めて green にする運用は行わない。',
		],
	},
	{
		heading: '未確認（owner 確認待ち）',
		bullets: [
			'Miro board の付箋本文にはアクセスできない。見出し語（個人 > samuido / 361do_sleep / 361do_design / rebuildup）以外の由来・背景は創作しない。',
			'yusuke-kim.com が現在も公開面として機能しているかは、この凡例では確認していない。/links は前身 site の記録を引き継いだ一覧であり、各 account の現在の公開状態（凍結・移行・閉鎖）は記録時点のもの。',
			'この凡例をどの公開 surface に置くかは未決。route への mount は owner の判断であり、本 Issue では行わない。',
		],
	},
];
