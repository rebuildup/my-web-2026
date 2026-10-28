/**
 * FlatVsDepth — the data behind the Issue #520 visual review.
 *
 * What this module is
 * -------------------
 * The **content** of `docs/visual/flat-vs-depth-review.md`: the two
 * published screens the review compares, the measurements read off
 * them, and the decisions the review records. It is a plain data
 * module — no React, no CSS, no imports — for three reasons:
 *
 *   1. `scripts/check-flat-vs-depth-preview-parity.test.mjs` imports it
 *      directly and asserts that the Markdown and this module carry the
 *      same headings, the same cases and the same numbers. One source,
 *      two surfaces.
 *   2. The Storybook story (`FlatVsDepth.stories.tsx`) renders exactly
 *      what the document argues, so a reviewer can read the review
 *      without leaving the preview.
 *   3. A data module has no rendering opinion, so it cannot drift into
 *      "the preview shows something the document does not say".
 *
 * The measurements
 * ----------------
 * Every number in `measurements` was read with a real browser from the
 * canonical production origin by `scripts/measure-flat-vs-depth.mjs`
 * (Chromium, 1440x900, deviceScaleFactor 1, 2026-10-28). The `how`
 * field of each measurement is the command that reproduces it. Nothing
 * here is estimated, and nothing here describes a screen that was not
 * opened.
 *
 * Scope
 * -----
 * This is a review of what the shipped screens already do. It changes
 * no style, and it proposes no site redesign: the improvement
 * candidates are recorded as deferred (保留), because applying them
 * would change published surfaces, which this Issue explicitly does not
 * do.
 */

/** A decision recorded by the review: adopted, or deliberately deferred. */
export type FlatVsDepthVerdict = '採用' | '保留';

/** One measured fact, with the way it was read. */
export interface FlatVsDepthMeasurement {
	/** Stable id, also written in the Markdown. */
	id: string;
	/** What was measured. */
	label: string;
	/** The measured value, verbatim. */
	value: string;
	/** How it was measured (command / viewport / browser). */
	how: string;
}

/**
 * One block of the schematic reproduction of a screen.
 *
 * The block is a **composition trait**, not a screenshot: it says which
 * column the block sits in and how tall it reads, so the difference
 * between the two screens can be seen without embedding the screens.
 */
export interface FlatVsDepthCompositionBlock {
	/** `heading` = the 4/12 column, `body` = the 8/12 column, `full` = spans both. */
	column: 'heading' | 'body' | 'full';
	/** The block's name, as the screen names it. */
	label: string;
	/** The measured fact the block stands for. */
	note: string;
	/** Relative height in the schematic. */
	weight: number;
	/** Drawn as an outline: the screen does NOT have this block. */
	absent?: boolean;
}

/** One published screen the review compares. */
export interface FlatVsDepthScreen {
	/** Stable id, also written in the Markdown. */
	id: string;
	/** The public URL that was measured. */
	url: string;
	/** The screen's own name. */
	label: string;
	/** One line: what the screen is. */
	summary: string;
	/** The composition traits the schematic reproduces. */
	traits: readonly string[];
	/** The measured facts. */
	measurements: readonly FlatVsDepthMeasurement[];
	/** The schematic reproduction of the screen's composition. */
	composition: {
		columns: readonly { id: string; fraction: string; measured: string }[];
		blocks: readonly FlatVsDepthCompositionBlock[];
	};
}

/** An improvement candidate: derived from a measurement, not yet applied. */
export interface FlatVsDepthCandidate {
	/** Stable id, also written in the Markdown. */
	id: string;
	/** The screen the candidate belongs to. */
	screenId: string;
	/** The candidate's title. */
	title: string;
	/** The measurement the candidate is derived from. */
	basis: string;
	/** What the candidate would change. */
	proposal: string;
	/** Always deferred in this Issue. */
	verdict: FlatVsDepthVerdict;
}

/** A decision the review records. */
export interface FlatVsDepthDecision {
	/** Stable id, also written in the Markdown. */
	id: string;
	/** Adopted or deferred. */
	verdict: FlatVsDepthVerdict;
	/** What is decided. */
	statement: string;
	/** Why. */
	reason: string;
}

/** One `##` section of the review. */
export interface FlatVsDepthSection {
	/** The `##` heading in the Markdown. Same string, same order. */
	heading: string;
	/** What the section argues. */
	intent: string;
	/** The screens the section talks about. */
	screenIds: readonly string[];
	/** The improvement candidates the section lists. */
	candidateIds: readonly string[];
	/** Premises the section states; each one is written verbatim in the Markdown. */
	notes: readonly string[];
	/** The decisions the section records. */
	decisions: readonly FlatVsDepthDecision[];
}

/** How the observation was made. Written into the Markdown and the preview. */
export const FLAT_VS_DEPTH_METHOD = {
	origin: 'https://rebuildup.dev',
	viewport: '1440x900 / deviceScaleFactor 1',
	browser: 'Chromium (Playwright)',
	measuredOn: '2026-10-28',
	command: 'node scripts/measure-flat-vs-depth.mjs',
	report: '.tmp/flat-vs-depth/measurements.json',
	document: 'docs/visual/flat-vs-depth-review.md',
	preview: 'src/personal/flat-vs-depth/FlatVsDepth.stories.tsx',
} as const;

/** The two published screens the review compares. */
export const FLAT_VS_DEPTH_SCREENS: readonly FlatVsDepthScreen[] = [
	{
		id: 'case-home',
		url: 'https://rebuildup.dev/',
		label: 'ホーム / Home',
		summary:
			'サイトの入口。identity motif と 5 つの本文セクションと状態表示を 1 画面にまとめた画面。',
		traits: [
			'最初の层面上 motif が 1 個だけある（h1 = SiteMark の SVG 141x96px）',
			'6 つのセクションが同じ 96px padding で積まれる（hero だけ 128px）',
			'セクションを区切るのは shadow でも罫線でもなく、192px の余白だけ',
			'見出しは全部同じ左カラム（240px-547px）に立ち、本文は右カラム（587px-1200px）',
		],
		measurements: [
			{
				id: 'home-height',
				label: '文書全体の高さ',
				value: '3243px',
				how: 'documentElement.scrollHeight / Chromium 1440x900',
			},
			{
				id: 'home-elements',
				label: '描画される要素数',
				value: '323',
				how: 'document.querySelectorAll("body *") のうち幅か高さが 0 でないもの',
			},
			{
				id: 'home-density',
				label: '密度（描画要素数 / 文書高）',
				value: '0.0996 要素/px',
				how: '323 / 3243',
			},
			{
				id: 'home-elevation',
				label: '立体の手がかり',
				value: 'box-shadow 1 / gradient 0 / background-image 0 / border 10',
				how: 'getComputedStyle で可視要素を走査',
			},
			{
				id: 'home-surfaces',
				label: '背景色',
				value: '#ffffff / #f8fafc / #f1f5f9 / #0369a1 / #047857',
				how: 'getComputedStyle(el).backgroundColor を集計',
			},
			{
				id: 'home-text-colors',
				label: '文字色',
				value: '#0f172a / #64748b / #0369a1 / #ffffff / #000000',
				how: 'getComputedStyle(el).color を集計',
			},
			{
				id: 'home-type-scale',
				label: '実際の文字サイズ段',
				value: '12 / 14 / 16 / 18 / 24 / 32 / 64 px',
				how: 'テキストを持つ要素の computed font-size を集計',
			},
			{
				id: 'home-h1',
				label: 'h1',
				value:
					'SiteMark の SVG 141x96px（#ffd627 / #ffffff / #000000 の 3 色）。h1 のテキスト自体は 16px / 400 の視覚的隠蔽',
				how: 'h1 の computed style と内側 svg の getBoundingClientRect',
			},
			{
				id: 'home-h2',
				label: 'h2',
				value: '32px / 700 / line-height 1.15 / letter-spacing -0.8px / コントラスト 17.85:1',
				how: 'main h2 の computed style と背景色から計算したコントラスト比',
			},
			{
				id: 'home-columns',
				label: 'カラム分割',
				value: '306.656px + 613.344px（gap 40px / コンテンツ幅 960px）',
				how: 'grid container の解決済み grid-template-columns',
			},
			{
				id: 'home-section-gap',
				label: 'セクション間の余白',
				value: '224px（hero → capabilities）/ 192px（本文セクション間）',
				how: '前セクションの末尾要素の底辺と次セクションの先頭要素の上辺の差',
			},
			{
				id: 'home-sections',
				label: 'セクション構成',
				value: '6（hero / capabilities / status / reactions / access / contact）',
				how: 'position が fixed / sticky でない section 要素を数える',
			},
			{
				id: 'home-contrast',
				label: '最多文字色のコントラスト',
				value: '#64748b が 116 要素 / 4.76:1（白地）',
				how: '最多の文字色を白地 #ffffff と对比',
			},
		],
		composition: {
			columns: [
				{ id: 'heading', fraction: '4/12', measured: '306.656px' },
				{ id: 'body', fraction: '8/12', measured: '613.344px' },
			],
			blocks: [
				{
					column: 'heading',
					label: 'SiteMark（h1）',
					note: 'SVG 141x96px。画面唯一の motif',
					weight: 2,
				},
				{
					column: 'body',
					label: '説明 + CTA',
					note: '18px のリード文と 2 つのリンク',
					weight: 2,
				},
				{
					column: 'heading',
					label: 'h2 できごと',
					note: '32px / 700',
					weight: 1,
				},
				{
					column: 'body',
					label: '4 capability カード',
					note: 'h3 24px が 4 つ',
					weight: 2,
				},
				{
					column: 'heading',
					label: 'h2 プラットフォームの状態',
					note: '32px / 700',
					weight: 1,
				},
				{
					column: 'body',
					label: '状態タイル + 既知の障害',
					note: 'h3 16px / 700',
					weight: 2,
				},
				{
					column: 'heading',
					label: 'h2 みんなの反応',
					note: '32px / 700',
					weight: 1,
				},
				{
					column: 'body',
					label: 'リアクションウィジェット',
					note: '絵文字 7 枚（64x96px）',
					weight: 2,
				},
				{
					column: 'heading',
					label: 'h2 ページビュー',
					note: '32px / 700',
					weight: 1,
				},
				{
					column: 'body',
					label: 'アクセスカウンタ',
					note: '桁画像',
					weight: 1,
				},
				{
					column: 'heading',
					label: 'h2 Contact',
					note: '32px / 700',
					weight: 1,
				},
				{
					column: 'body',
					label: '連絡先 CTA',
					note: 'accent ボタン 1 個',
					weight: 1,
				},
			],
		},
	},
	{
		id: 'case-portfolio',
		url: 'https://rebuildup.dev/portfolio',
		label: 'ポートフォリオ / Portfolio',
		summary: '制作物の一覧。1 枚の見出しと 3 件の作品カードからなる画面。',
		traits: [
			'motif が 0 個（svg 要素は 1 つも無い）。画面上の語りは type だけ',
			'文字サイズ段に 32px が無い（12 / 14 / 16 / 18 / 24 / 64 px のみ）',
			'h1 64px から h3 24px へ 40px 跳ぶ、中間の段が無い',
			'作品の並びは 3 件、各カードの見出しは 8/12 カラム（581px-1200px）に揃う',
		],
		measurements: [
			{
				id: 'portfolio-height',
				label: '文書全体の高さ',
				value: '1799px',
				how: 'documentElement.scrollHeight / Chromium 1440x900',
			},
			{
				id: 'portfolio-elements',
				label: '描画される要素数',
				value: '125',
				how: 'document.querySelectorAll("body *") のうち幅か高さが 0 でないもの',
			},
			{
				id: 'portfolio-density',
				label: '密度（描画要素数 / 文書高）',
				value: '0.0695 要素/px',
				how: '125 / 1799',
			},
			{
				id: 'portfolio-elevation',
				label: '立体の手がかり',
				value: 'box-shadow 1 / gradient 0 / background-image 0 / border 12',
				how: 'getComputedStyle で可視要素を走査',
			},
			{
				id: 'portfolio-surfaces',
				label: '背景色',
				value: '#ffffff / #f8fafc / #f1f5f9 / #0369a1 / #64748b',
				how: 'getComputedStyle(el).backgroundColor を集計',
			},
			{
				id: 'portfolio-text-colors',
				label: '文字色',
				value: '#0f172a / #64748b / #ffffff',
				how: 'getComputedStyle(el).color を集計',
			},
			{
				id: 'portfolio-type-scale',
				label: '実際の文字サイズ段',
				value: '12 / 14 / 16 / 18 / 24 / 64 px（32px の段は無い）',
				how: 'テキストを持つ要素の computed font-size を集計',
			},
			{
				id: 'portfolio-h1',
				label: 'h1',
				value:
					'64px / 700 / line-height 1.05 / letter-spacing -1.92px / 幅 720px / コントラスト 17.85:1',
				how: 'h1 の computed style と bounding box',
			},
			{
				id: 'portfolio-h3',
				label: '作品カードの見出し',
				value: '24px / 700 / 左 581px・幅 619px（8/12 カラム）',
				how: 'main h3 の computed style と bounding box',
			},
			{
				id: 'portfolio-images',
				label: '画像',
				value: '3 枚（1280x720 → 309x174、1280x720 → 309x174、1920x1920 → 309x309）',
				how: 'img の naturalWidth / naturalHeight と bounding box',
			},
			{
				id: 'portfolio-title-gap',
				label: 'h1 から最初の作品タイトルまで',
				value: '469px',
				how: 'h1 の底辺と最初の main h3 の上辺の差',
			},
			{
				id: 'portfolio-item-gap',
				label: '作品タイトル間の距離',
				value: '223px / 248px',
				how: '連続する main h3 の下辺と上辺の差',
			},
			{
				id: 'portfolio-columns',
				label: 'カラム分割',
				value: '309.328px + 618.672px（gap 32px / コンテンツ幅 960px）',
				how: 'grid container の解決済み grid-template-columns',
			},
			{
				id: 'portfolio-motif',
				label: 'motif',
				value: '0 個（svg 要素は 1 つも無い）',
				how: 'document.querySelectorAll("svg") を数える',
			},
		],
		composition: {
			columns: [
				{ id: 'heading', fraction: '4/12', measured: '309.328px' },
				{ id: 'body', fraction: '8/12', measured: '618.672px' },
			],
			blocks: [
				{
					column: 'heading',
					label: 'h1 主要な制作物',
					note: '64px / 700。画面唯一の motif ではなく type',
					weight: 2,
				},
				{
					column: 'body',
					label: 'リード本文',
					note: '16px / 1.6',
					weight: 1,
				},
				{
					column: 'heading',
					label: '（32px の中間段が無い）',
					note: 'h1 64px と h3 24px の間に段が無い',
					weight: 1,
					absent: true,
				},
				{
					column: 'body',
					label: '作品 1 Aulymo',
					note: '309x174px の画像と h3 24px',
					weight: 2,
				},
				{
					column: 'body',
					label: '作品 2 Aeスクリプト Aulymo',
					note: '309x174px の画像と h3 24px',
					weight: 2,
				},
				{
					column: 'body',
					label: '作品 3 MultiSlicer',
					note: '309x309px の画像と h3 24px',
					weight: 2,
				},
			],
		},
	},
];

/**
 * The improvement candidates the review derives from the measurements.
 *
 * Every one of them is deferred (保留): applying a candidate changes a
 * published surface, and this Issue is a review, not a redesign.
 */
export const FLAT_VS_DEPTH_CANDIDATES: readonly FlatVsDepthCandidate[] = [
	{
		id: 'candidate-portfolio-type-step',
		screenId: 'case-portfolio',
		title: '文字サイズ段の中間段（32px）を 1 つ戻す',
		basis: '実際の文字サイズ段 12 / 14 / 16 / 18 / 24 / 64 px（32px の段は無い）',
		proposal:
			'作品一覧のように中核となるセクションに 32px の見出し段を 1 つ置き、h1 64px と作品タイトル 24px の間に中間段を戻す。',
		verdict: '保留',
	},
	{
		id: 'candidate-portfolio-title-gap',
		screenId: 'case-portfolio',
		title: 'h1 と最初の作品タイトルまでの 469px を詰める',
		basis: 'h1 から最初の作品タイトルまで 469px',
		proposal:
			'作品一覧の lead を 1 段、先に 1 つの beat を置いて、h1 と 1 件目のあいだの空白を減らす。',
		verdict: '保留',
	},
	{
		id: 'candidate-home-section-beat',
		screenId: 'case-home',
		title: '同一の 96px beat を全セクションに適用し続ける',
		basis: 'セクション間の余白 192px（本文セクション間）',
		proposal:
			'静かなセクション（アクセスカウンタ等）と主要なセクション（状態・反応）で beat を分ける。beat の管理条例は owner 決定が要る。',
		verdict: '保留',
	},
	{
		id: 'candidate-home-motif-weight',
		screenId: 'case-home',
		title: 'motif（SiteMark）を画面唯一の視線の止まり場 にする',
		basis: 'h1 は SiteMark の SVG 141x96px。画面最大の type は h2 の 32px',
		proposal:
			'hero の motif と type の関係を組み直す。type と motif が同じ段落で同列に立つので、hero の beat を調整して motif が単独で読めるようにする。',
		verdict: '保留',
	},
];

/** The sections of the review, in the order the document reads. */
export const FLAT_VS_DEPTH_SECTIONS: readonly FlatVsDepthSection[] = [
	{
		heading: '観測対象と方法',
		intent:
			'比較の対象は、このリポジトリが公開している 2 画面。記述はすべて実測値であり、推測は書かない。',
		screenIds: ['case-home', 'case-portfolio'],
		candidateIds: [],
		notes: [
			'観測対象は `https://rebuildup.dev/` と `https://rebuildup.dev/portfolio` の 2 画面。',
			'観測は Chromium（Playwright）、viewport 1440x900、deviceScaleFactor 1、2026-10-28 実施。',
			'再現コマンドは `node scripts/measure-flat-vs-depth.mjs`。結果は `.tmp/flat-vs-depth/measurements.json`。',
			'この Issue は画面のスタイルを変えない。成果物は記述（文書）と preview だけである。',
		],
		decisions: [
			{
				id: 'decision-observe-production',
				verdict: '採用',
				statement: '本番 origin の実測を典拠にする',
				reason:
					'ADR-0014 が定める canonical production origin が、読者が実際に見る面だからである。ローカルの build は D1 が空で 2 画面を再現しない。',
			},
		],
	},
	{
		heading: '2作品に観測された視覚的特徴',
		intent: '5 つの観点（階層・余白・密度・コントラスト・motif）で 2 画面を並べた観測結果。',
		screenIds: ['case-home', 'case-portfolio'],
		candidateIds: [],
		notes: [
			'階層は「h1 / h2 / h3 の文字サイズ段」と「見出しの立ち位置」で決まっている。',
			'余白は section padding と section 間の beat で決まっている。',
			'密度は描画要素数と文書高の比で比べる。',
			'コントラストは白地に対する計算比で比べる。',
			'motif は画面内で 1 個だけ意味を持てる。',
		],
		decisions: [],
	},
	{
		heading: 'flatness が有効だった場面',
		intent: '平坦な面が読み手的にも構造的にも成立した画面。flatness を維持する根拠。',
		screenIds: ['case-portfolio'],
		candidateIds: [],
		notes: [
			'`https://rebuildup.dev/portfolio` は反復する 3 件の一覧で、階層は整列と反復だけで成立する。',
			'立体の手がかりは box-shadow 1 / gradient 0 / background-image 0 で、実質的に無い。',
			'それでも 3 件のカードは同じ型（画像 + 24px の見出し + 説明）なので、面が平でも並びが階層を作る。',
		],
		decisions: [
			{
				id: 'decision-keep-portfolio-flat',
				verdict: '採用',
				statement: '一覧画面は平坦なまま維持する',
				reason:
					'反復する同型の並びは shadow や面を手入れなくても読みやすい。ここで立体化しても階層は増えず、面の数だけが増える。',
			},
		],
	},
	{
		heading: 'flatness が不十分だった場面',
		intent: '平坦な面だけでは成立しなかった画面。改善候補の根拠を観測事実から置く。',
		screenIds: ['case-home'],
		candidateIds: [],
		notes: [
			'`https://rebuildup.dev/` は 6 セクションが同じ 96px padding で積まれ、区切りは 192px の余白だけである。',
			'画面最大の type は h2 の 32px で、視線の止まり場 となるのは 141x96px の SVG motif だけである。',
			'セクションの幾何が 5 回そのまま繰り返されるので、静的なセクションと重要なセクションの区別が数値で出ない。',
		],
		decisions: [
			{
				id: 'decision-home-candidates-deferred',
				verdict: '保留',
				statement: 'ホームの beat 改善は候補として記録し、今回は適用しない',
				reason:
					'適用すると公開画面のスタイルが変わる。Issue #520 はレビューであり、再設計を含まない。候補は measurement に紐づけて記録する。',
			},
		],
	},
	{
		heading: '流行り UI への平均化を避ける',
		intent: '「よく見る UI の形」に寄せて観測を壊さないための判断記録。何を記述しないか。',
		screenIds: [],
		candidateIds: [],
		notes: [
			'影・グラデーション・glass・角丸カード・影付きボタンの追加は採用しない。',
			'観測の記述（平坦であることを印象ではなく数値として書く）は採用する。',
		],
		decisions: [
			{
				id: 'decision-no-trend-decorations',
				verdict: '保留',
				statement: 'shadow / gradient / glass などの装飾を足さない',
				reason:
					'2 画面の観測では立体の手がかりは既に box-shadow 1 / gradient 0 / background-image 0 である。装飾は階層を直さず、面の数だけを増やす。',
			},
			{
				id: 'decision-describe-dont-copy',
				verdict: '採用',
				statement: '他の作品の追随ではなく観測した数値で書く',
				reason:
					'レビューは Miro の自己評価を公開面への要求に変換しない。数値で書けば、同じ画面が誰に読まれても検証できる。',
			},
		],
	},
	{
		heading: '本人の自己否定を恒久的なブランド要件にしない',
		intent:
			'Miro 側の自己評価（作品 > 世界観 > シンプル / 平面的 / 独自性への自己評価）を、個人の断定プロフィールとして公開しない。',
		screenIds: [],
		candidateIds: [],
		notes: [
			'Miro の付箋にはアクセスできない。Issue 本文が引用する見出し語だけを典拠として扱う。',
			'「独自の何かは無い」という自己評価は、対話的な所感であり恒久的な要件ではない。',
			'ブランド要件は「editorial token が出す視覚言語」であり、「平坦であること」ではない。',
		],
		decisions: [
			{
				id: 'decision-no-self-negation-as-requirement',
				verdict: '採用',
				statement: '自己否定を視覚言語の要件に書き換えない',
				reason:
					'自己評価を要件に固定すると、確認できない所感が恒久的な契約になる。token と実測値で要件を書けば、観測と実装のどちらかが間違っているときに指摘できる。',
			},
			{
				id: 'decision-miro-detail-unverified',
				verdict: '保留',
				statement: 'Miro の付箋の詳細は未確認（owner 確認待ち）とする',
				reason:
					'agent は Miro にアクセスできない。Issue 本文に引用された見出し語以外の情報は、作成しない。',
			},
		],
	},
	{
		heading: '採用と保留',
		intent: 'この Issue で採用するもの、保留するもの、そして保留の理由のまとめ。',
		screenIds: ['case-home', 'case-portfolio'],
		candidateIds: [
			'candidate-portfolio-type-step',
			'candidate-portfolio-title-gap',
			'candidate-home-section-beat',
			'candidate-home-motif-weight',
		],
		notes: [
			'採用は「観測の記述」「preview」「parity 検証」「再現手順」の 4 点。',
			'保留は「改善候補 4 件」「装飾の追加」「Miro の詳細」で、いずれも公開画面のスタイルを変えない。',
			'本 Issue は大幅な全サイト再設計を含めない。',
		],
		decisions: [
			{
				id: 'decision-adopt-review-only',
				verdict: '採用',
				statement: 'この Issue は文書 + preview + 検証に限定する',
				reason:
					'Issue #520 の完了条件は「単独 fixture / Storybook / 文書 preview で完結する」ことである。',
			},
		],
	},
	{
		heading: '未確認（owner 確認待ち）',
		intent: 'この Issue で確認できなかった事項。推測で埋めない。',
		screenIds: [],
		candidateIds: [],
		notes: [
			'Miro の付箋の内容そのもの（Issue 本文の引用以外の情報）は未確認（owner 確認待ち）。',
			'本番がバージョン 0.7.0 を表示している点は観測済み。repository の release-0-8-0 との差分は未確認（owner 確認待ち）。',
			'改善候補を適用すべきかどうかは owner の判断（保留）。',
		],
		decisions: [],
	},
];
