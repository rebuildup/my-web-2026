/**
 * Manifesto — the data behind the Issue #535 presentation preview.
 *
 * What this module is
 * -------------------
 * The CONTENT of the "why I make things" (制作哲学 / manifesto)
 * experiment: one real work-or-decision material, two Miro values kept
 * as INDEPENDENT questions (never collapsed into one slogan), and the
 * two one-screen presentations the Issue asks to compare — an
 * article-style (記事) rendering and a landing-page-style (LP)
 * rendering. It is a plain data module — no React, no CSS, no
 * imports — for the same reasons `FlatVsDepth.preview.ts` and
 * `HandleMap.preview.ts` are:
 *
 *   1. `scripts/check-manifesto-preview-parity.test.mjs` imports it
 *      directly and asserts the verification document carries the
 *      same questions, sources and links. One source, two surfaces.
 *   2. The Storybook stories render exactly what the document
 *      argues, so a reviewer reads the experiment without leaving
 *      the preview.
 *   3. A data module has no rendering opinion, so it cannot drift
 *      into "the preview shows something the document does not say".
 *
 * What counts as a source
 * -----------------------
 * Every `statement` and every `path` below was read from a committed
 * record in THIS repository: the ADR, the portfolio seed, the
 * canonical personal docs, or the verification record of a shipped
 * decision. Nothing here is a memory, an estimate, or an unreleased
 * claim. The Miro board itself is NOT reachable: only the heading
 * words the Issue quotes are cited (`miroAxis`), and everything the
 * owner alone can decide is marked 未確認 rather than asserted.
 *
 * Scope
 * -----
 * This is a PREVIEW experiment. It is not wired to any route, it
 * does not decide the site's information architecture, and it does
 * not implement the per-question documents of Issues #512–#516 —
 * those stay open. The screen exists so the owner can compare "a
 * document" against "a landing page" as the container for the same
 * material BEFORE choosing where a manifesto would live.
 */

/** One committed record the preview's claims were read from. */
export interface ManifestoSource {
	/** Stable id, referenced by evidence items. */
	id: string;
	/** Short label for the record. */
	label: string;
	/** Repo-relative path of the committed record. */
	path: string;
	/** What the record is the authority for, in one line. */
	note: string;
}

/** One real work or decision the manifesto is built from. */
export interface ManifestoMaterial {
	/** Stable id. */
	id: string;
	/** The work or decision, named. */
	label: string;
	/** One line: what it is. */
	summary: string;
	/** The source records it was read from. */
	sourceIds: readonly string[];
}

/** One Miro value kept as an INDEPENDENT question — never merged. */
export interface ManifestoQuestion {
	/** Stable id. */
	id: string;
	/** The Miro axis this question comes from, quoted verbatim from the Issue. */
	miroAxis: string;
	/** The question as the article heading states it. */
	heading: string;
	/** The question itself, one sentence. */
	question: string;
	/** What the material shows about it — evidence, each tied to a source. */
	evidence: readonly {
		statement: string;
		sourceId: string;
	}[];
	/** What is NOT decided yet — printed as 未確認, never asserted. */
	open: readonly string[];
}

/** One published URL the variants may link to — nothing else. */
export interface ManifestoLink {
	label: string;
	url: string;
}

/** The document-level facts both variants print. */
export interface ManifestoDocument {
	/** The h1 of both variants. */
	title: string;
	/** The kicker / eyebrow line. */
	kicker: string;
	/** Publication state — this is a preview, not a published page. */
	status: string;
	/** Where the material was read from (Issue + Miro citation). */
	source: string;
	/** How the preview is machine-checked. */
	verification: string;
	/** The preview's own location. */
	preview: string;
	/** The verification document path. */
	document: string;
}

export const MANIFESTO_DOCUMENT: ManifestoDocument = {
	title: 'なぜ作るのか',
	kicker: 'manifesto preview — Issue #535',
	status: 'preview / 未公開 — route 未接続の単独検証',
	source: 'Issue #535 が引用する Miro 見出し語 + 本リポジトリの確定記録',
	verification: 'scripts/check-manifesto-preview-parity.test.mjs + scripts/capture-manifesto.mjs',
	preview: 'src/personal/manifesto/Manifesto.stories.tsx',
	document: 'docs/verification/vision/manifesto-preview.md',
};

/**
 * The committed records every claim was read from.
 *
 * The parity test re-reads each `path` and fails when a cited record
 * does not exist or no longer carries the quoted material — the same
 * mechanism `check-handle-map-preview-parity.test.mjs` uses for names
 * and URLs.
 */
export const MANIFESTO_SOURCES: readonly ManifestoSource[] = [
	{
		id: 'adr-0017',
		label: 'ADR-0017 — Unicode 正規化と URL slug の分離',
		path: 'docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md',
		note: 'slug を「正規化して通す」から「拒否して通さない」へ変えた判断の記録。§3 に NFKC の非可逆性の実測、§4 に以前の状態の記述。',
	},
	{
		id: 'i18n-slug-identity',
		label: 'src/i18n/slug-identity.ts',
		path: 'src/i18n/slug-identity.ts',
		note: '拒否側の規則を所有する leaf obligation の実装。classifySlugCandidate が判断表の本体。',
	},
	{
		id: 'growth-case-study',
		label: 'docs/personal/growth-through-making.md §6',
		path: 'docs/personal/growth-through-making.md',
		note: '同じ slug 判断を before/after 事例として採録した成長記録仕様。公開可能な記録として既に存在する。',
	},
	{
		id: 'portfolio-seed',
		label: 'src/portfolio/seed.ts',
		path: 'src/portfolio/seed.ts',
		note: '公開 portfolio の seed。my-web-2026 と Aulymo の motivationMd が、公開記録としての制作動機。',
	},
	{
		id: 'personal-principles',
		label: 'docs/personal/principles.md',
		path: 'docs/personal/principles.md',
		note: 'canonical な個人原則。「architecture は債務の引き受け先を決めること」という上位判断。',
	},
	{
		id: 'architecture-check',
		label: 'scripts/check-architecture.mjs',
		path: 'scripts/check-architecture.mjs',
		note: 'obligation 境界を機械検証する gate。原則が「観測可能な形」で存在する証拠。',
	},
];

/**
 * The real works / decisions the manifesto is built from.
 *
 * Two materials, both already public records — no unreleased work,
 * no private information.
 */
export const MANIFESTO_MATERIALS: readonly ManifestoMaterial[] = [
	{
		id: 'slug-rejection',
		label: 'URL slug の判断 — 正規化ではなく拒否',
		summary:
			'「5 µm tolerance」と「5 μm tolerance」が同じ slug に潰れる測定を受け、導出ではなく拒否で意味を守る設計に変えた。',
		sourceIds: ['adr-0017', 'i18n-slug-identity', 'growth-case-study'],
	},
	{
		id: 'platform-rebuild',
		label: 'my-web-2026 の再構築 — 境界を引き直した基盤',
		summary:
			'旧サイトが「何でも 1 site に乗せる実験」になっていたため、obligation ごとに境界を引き直して基盤を再構築した。',
		sourceIds: ['portfolio-seed', 'personal-principles', 'architecture-check'],
	},
];

/**
 * The two Miro values, kept as INDEPENDENT questions.
 *
 * Issue #535 requires at least two values to remain separate
 * questions — collapsing them into one slogan is exactly what the
 * Issue forbids. `miroAxis` quotes the Issue's own citation of the
 * board; the board's sticky-note bodies are NOT reachable, so each
 * question states only what the cited heading supports.
 */
export const MANIFESTO_QUESTIONS: readonly ManifestoQuestion[] = [
	{
		id: 'question-meaningful',
		miroAxis: '哲学 > 根本的にいいものを作る > 意味のあるもの / 最適な技術スタック',
		heading: '「根本的にいいもの」とは何か',
		question:
			'技術的に新しいことと、意味のあることは同じではない。では「根本的にいいもの」を、判断の記録からどう見分けるか。',
		evidence: [
			{
				statement:
					'URL slug の設計で「正規化して通す」案を捨て「拒否して通さない」案を採った。NFKC は可逆ではなく、別の綴りが 1 つの URL に統合されうるため、意味を守れるのは導出ではなく拒否だけだった。',
				sourceId: 'adr-0017',
			},
			{
				statement:
					'この判断は「技術的新しさ」ではなく「意味の保存」を選んだ例であり、ADR-0017 §3 が測定値つきで記録している。',
				sourceId: 'i18n-slug-identity',
			},
			{
				statement:
					'同じ判断は docs/personal/growth-through-making.md §6 が before/after 事例として採録済みで、公開可能な記録として存在する。',
				sourceId: 'growth-case-study',
			},
		],
		open: [
			'「根本的にいいもの」の定義文そのものは未決。Issue #512 が個別に扱う領域であり、本 preview では問いとして残すだけ。',
			'Miro の付箋本文は未確認（owner 確認待ち）。引用できるのは Issue が引用した見出し語だけ。',
		],
	},
	{
		id: 'question-make-vs-want',
		miroAxis: '哲学 > 自分の作りたいもの / 自分の欲しいもの',
		heading: '「作りたいもの」と「欲しいもの」は同じか',
		question:
			'作りたいものと、欲しいもの（必要としているもの）は別に存在する。作品ごとの制作動機を、記録の上でどう区別するか。',
		evidence: [
			{
				statement:
					'my-web-2026 の seed は動機を「旧サイトが何でも 1 site に乗せる実験になっていたため、基盤を再構築する」と記録する — 欲しいのはまっとうな基盤で、作ったのは境界を引き直した platform である。',
				sourceId: 'portfolio-seed',
			},
			{
				statement:
					'Aulymo の seed は動機を「lyric motion の組み立てを手作業で繰り返すのがもったいなかった」と記録する — 作りたいもの（lyric motion を作る）と欲しいもの（手作業を減らす）が一致した例。',
				sourceId: 'portfolio-seed',
			},
			{
				statement:
					'この区別を作品ごとの選択式フィールドにするかは Issue #514 の領域であり、本 preview では 2 作品の記録が「一致例」と「区別例」を既に持つことだけを示す。',
				sourceId: 'personal-principles',
			},
		],
		open: [
			'動機フィールドの定義（選択肢・非例・fallback）は Issue #514 が決める。本 preview は分類を先取りしない。',
			'「作りたい / 欲しい」の本人の内面は公開記録の外にある。seed の motivationMd が公開している範囲だけを材料にする。',
		],
	},
];

/**
 * The published URLs either variant may link to.
 *
 * Deliberately short: the experiment compares CONTAINERS for the
 * same material, not navigation. Only URLs that are already public
 * records appear here — the repository itself and the public
 * portfolio index. In-repo paths are printed as code, not links,
 * because a `blob/<branch>` URL would pin a branch that moves.
 */
export const MANIFESTO_LINKS: readonly ManifestoLink[] = [
	{
		label: 'この判断の記録（repository）',
		url: 'https://github.com/rebuildup/my-web-2026',
	},
	{
		label: '公開作品の一覧（portfolio）',
		url: 'https://rebuildup.dev/portfolio',
	},
];

/** Colophon facts printed at the foot of both variants. */
export const MANIFESTO_NOTES: readonly string[] = [
	'2 つの問いは独立した問いとして残す。1 つの標語に潰さない（Issue #535 の完了条件）。',
	'材料はすべて公開済みの記録（ADR / seed / canonical doc）に限定し、未公開の作品・実績・個人情報は含めない。',
	'各問いの答えは確定していない。ここで比較するのは「答え」ではなく「容れ物」（記事か LP か）である。',
	'公開 route への接続・サイト上の位置・正式公開は owner 決定であり、本 preview の範囲外。',
];
