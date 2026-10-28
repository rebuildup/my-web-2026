/**
 * Usable-product publication checklist — Issue #515.
 *
 * The DATA the standalone preview renders. It is deliberately a plain
 * data module: no React, no `css()`, no imports. Two properties follow
 * from that and both are load-bearing:
 *
 *   1. The Storybook story (`UsableProductPublication.stories.tsx`) and
 *      the document (`docs/personal/usable-product-publication.md`) render
 *      the SAME strings, so the preview cannot drift away from the prose.
 *   2. `scripts/check-usable-product-preview-parity.test.mjs` can import
 *      this module directly (`node --experimental-strip-types`) and prove
 *      that the document and the preview still agree.
 *
 * Every concrete value below — a Tool slug, an artifact path, an API
 * path, an error form — was read from a COMMITTED RECORD (the Tool
 * Registry manifest or the public API directory), and the parity test
 * re-reads those records, so a fact cannot quietly drift away from the
 * record it was read from. Nothing here is a measurement this
 * repository has not performed, and nothing here is a forecast.
 *
 * The Miro board is NOT reachable from this module. The only source is
 * the heading the Issue quotes (哲学 > 使えるものをつくる > DL配布/APIサービス).
 * The five-stage translation below is this Issue's reading of that
 * heading, and everything only the owner can decide is marked
 * 「未確認（owner 確認待ち）」 rather than invented.
 */

/** The five stages, in the order the checklist asks them in. */
export type StageId = 'acquire' | 'operate' | 'explain' | 'recover' | 'retire';

/** What kind of content a section of the preview carries. */
export type SectionKind = 'sources' | 'stages' | 'checklist' | 'example' | 'decisions' | 'open';

/** One check inside one stage. */
export interface StageItem {
	/** Stable id. The document does not print it; the parity test does not need it. */
	id: string;
	/** The check itself — the same string the document carries. */
	label: string;
}

/** One stage of the publication contract. */
export interface Stage {
	id: StageId;
	/** The stage name: 入手 / 操作 / 説明 / 失敗 / 廃止. */
	name: string;
	/** What the user can finish at this stage — the exit. */
	exit: string;
	/** How the stage is judged. */
	judgement: string;
	/** The checks that decide the stage. */
	items: readonly StageItem[];
}

/** What a committed record says about one stage, and what it does not say. */
export interface ExampleNote {
	stageId: StageId;
	/** What the record states. */
	evidence: string;
	/** What the record does NOT state. `null` when the record answers the stage. */
	gap: string | null;
}

/** One worked example, read from one committed record. */
export interface AppliedExample {
	/** Stable id — also the slug or the resource the example is about. */
	id: string;
	kind: 'tool' | 'api';
	/** The subject as the committed record names it. */
	subject: string;
	/** The committed record the example was read from (repository-relative). */
	record: string;
	/** Where inside that record the example sits. */
	pointer: string;
	/** The concrete values the record carries. */
	facts: readonly { label: string; value: string }[];
	/** One note per stage, in stage order. */
	notes: readonly ExampleNote[];
}

/** One section of the preview. */
export interface PreviewSection {
	id: string;
	/** The `##` heading — byte-identical to the document's heading. */
	heading: string;
	kind: SectionKind;
	/** For `kind: 'example'`, the example this section renders. */
	exampleId?: string;
	/** Prose paragraphs. */
	paragraphs: readonly string[];
	/** Bullet items. */
	bullets: readonly string[];
}

/**
 * The labels the document and the screen both use.
 *
 * They live here so the preview and the document cannot drift on the
 * wording of a label either: the parity test checks that the document
 * carries these exact strings.
 */
export const usableProductLabels = {
	subject: '対象',
	record: '典拠',
	facts: '事実',
	evidence: '記録が述べていること',
	gap: '記録に無いこと',
	adopted: '採用',
	held: '保留',
} as const;

/** The five stages, in order. */
export const usableProductStages: readonly Stage[] = [
	{
		id: 'acquire',
		name: '入手',
		exit: '利用者は「どこから取り出すか」を迷わない。配布物（Tool の成果物）か API の path・method・認証の形が、1 か所で表明されている。',
		judgement: '入手の path・認証・前提条件が、同じ 1 つの記録に載っている。',
		items: [
			{
				id: 'acquire-path',
				label:
					'Tool の配布 path と entry HTML が manifest に載っている（`delivery.artifact_path` / `delivery.entry_html`）。',
			},
			{
				id: 'acquire-auth',
				label:
					'API の認証形式と必要な scope が API directory に載っている（`authentication` / `authForm` / `purpose`）。',
			},
			{
				id: 'acquire-prerequisite',
				label: '利用者に前提となる条件があるなら、その記録に書いている。',
			},
		],
	},
	{
		id: 'operate',
		name: '操作',
		exit: '利用者は「何を送ればよいか」を迷わない。操作の入口と入力の形が文書に載っている。',
		judgement: '操作の入力が example 付きで表明されている。',
		items: [
			{
				id: 'operate-entry',
				label:
					'操作の入口（Tool なら配信 page、API なら method と path）が 1 か所で表明されている。',
			},
			{
				id: 'operate-input',
				label: '操作の入力が example 付きで表明されている。',
			},
			{
				id: 'operate-idempotency',
				label: '同じ操作を繰り返したときの挙動（冪等性）が表明されている。',
			},
		],
	},
	{
		id: 'explain',
		name: '説明',
		exit: '利用者は「いま何が起きているか」を説明できる。応答の意味と field が定義されている。',
		judgement: '応答の example とその意味の説明が同じ場所にあり、用語が一意に決まる。',
		items: [
			{
				id: 'explain-response',
				label: '応答の形が example 付きで表明されている。',
			},
			{
				id: 'explain-purpose',
				label: 'その応答が何を意味するか（purpose）が 1 文で表明されている。',
			},
			{
				id: 'explain-terms',
				label: '用語が一意である（同じ words が 2 つの意味を持たない）。',
			},
		],
	},
	{
		id: 'recover',
		name: '失敗',
		exit: '利用者は「失敗したらどうするか」を迷わない。失敗の形と復帰手順が表明されている。',
		judgement: '失敗の形と、復帰または再試行の手順が表明されている。',
		items: [
			{
				id: 'recover-forms',
				label:
					'失敗の形が列挙されている（401 / 403 / 400 / 422 / 429 など、それぞれがいつ起きるかが分かる）。',
			},
			{
				id: 'recover-rate-limit',
				label: 'rate limit が起きるなら、どの binding が上限を持つかが表明されている。',
			},
			{
				id: 'recover-next',
				label: '失敗した利用者が次にどうするかが表明されている（再試行 / 別経路 / 連絡先）。',
			},
		],
	},
	{
		id: 'retire',
		name: '廃止',
		exit: '利用者は「使えなくなったこと」を偶発的に知らされない。終了の条件と移行先が記録に載っている。',
		judgement: '提供を終了する場合、その告知と移行先が記録に載っている。',
		items: [
			{
				id: 'retire-end',
				label:
					'提供終了の条件が表明されている（pin した version、manifest の `delivery.kind` など）。',
			},
			{
				id: 'retire-notice',
				label: '利用者が終了に気付く手段（告知期間・記録の更新）が表明されている。',
			},
			{
				id: 'retire-migration',
				label: '移行先があるなら、その path が表明されている。',
			},
		],
	},
];

/** The worked examples, in the order the preview renders them. */
export const usableProductExamples: readonly AppliedExample[] = [
	{
		id: 'readmark',
		kind: 'tool',
		subject: 'readmark',
		record: 'src/tools/manifest.json',
		pointer: 'tools[slug=readmark]',
		facts: [
			{ label: 'delivery.kind', value: 'same_origin_static' },
			{ label: 'delivery.artifact_path', value: '/tools/readmark/app' },
			{ label: 'delivery.entry_html', value: '/tools/readmark/app/index.html' },
			{ label: 'license', value: 'MIT' },
		],
		notes: [
			{
				stageId: 'acquire',
				evidence:
					'manifest が `same_origin_static` として配布 path（`/tools/readmark/app`）と entry HTML（`/tools/readmark/app/index.html`）を宣言し、iframe は `sandbox: allow-scripts` / `referrer_policy: no-referrer`。',
				gap: '配布の前提（Tool の build が host の release に載る条件）は manifest に宣言されていない。',
			},
			{
				stageId: 'operate',
				evidence:
					'manifest の description が「A local-first reading app for the browser. PDFs in MVP; EPUB/Markdown/text next.」と対象範囲を書き、対象形式が PDF に限ると記している。',
				gap: '入力の型（受け付ける file 形式・上限）と、操作に失敗したときの表示は manifest に宣言されていない。',
			},
			{
				stageId: 'explain',
				evidence:
					'manifest の description と `license: MIT` が対象とライセンスを説明し、`delivery.privacy.basis` は「measured at pinned readmark 906c90e: no external origin in index.html or src/**; re-measure after a bump」と測定根拠として記録する。',
				gap: null,
			},
			{
				stageId: 'recover',
				evidence:
					'同じ manifest が、配布できない Tool には `delivery.disabled_reason` で「なぜ出せないか」を宣言する書式を持っている。',
				gap: 'readmark には `disabled_reason` が無く、配布に失敗したときの表示（build 不能・成果物が無い）は manifest に宣言されていない。',
			},
			{
				stageId: 'retire',
				evidence:
					'manifest は `source.pinned_sha` を固定し、`delivery.privacy.basis` に「re-measure after a bump」と書いている。',
				gap: '提供終了の告知期間と移行先は manifest に宣言されていない。',
			},
		],
	},
	{
		id: 'reactions',
		kind: 'api',
		subject: '/api/v1/reactions',
		record: 'src/http/api-directory/catalog.ts',
		pointer: 'publicApiCatalog の path = /api/v1/reactions の 3 件（GET / PUT / DELETE）',
		facts: [
			{ label: 'path', value: '/api/v1/reactions' },
			{ label: 'methods', value: 'GET / PUT / DELETE' },
			{ label: 'authentication', value: 'credentialed' },
			{ label: 'authForm', value: 'api-key' },
			{ label: 'scopes', value: 'reactions:read / reactions:write' },
		],
		notes: [
			{
				stageId: 'acquire',
				evidence:
					'API directory が `path` / `method` / `authentication: credentialed` / `authForm: api-key` を宣言し、必要な scope（`reactions:read` / `reactions:write`）を `purpose` に明記している。',
				gap: 'API key をどこで発行するかについての記載は catalog に無く、catalog の責務外である。',
			},
			{
				stageId: 'operate',
				evidence:
					'`purpose` が「idempotent by target + actor + image reference」と操作の入力を名指しし、`responseExample` が成功時の応答の形を示している。',
				gap: 'リクエスト body の field 名・型・必須か任意かの区別は表明されておらず、入力の example も無い。',
			},
			{
				stageId: 'explain',
				evidence:
					'3 verb すべての `purpose` が何を返すかを示し、`responseExample` が field 単位の形を示している。',
				gap: null,
			},
			{
				stageId: 'recover',
				evidence:
					'`errorForm` が 401 / 403 / 400 / 422 / 429 を列挙し、`rateLimitBinding` が read と write の上限 binding を示す。',
				gap: '429 を受けた利用者がいつ再試行してよいか（Retry-After のような指標）は catalog に宣言されていない。',
			},
			{
				stageId: 'retire',
				evidence: 'なし（catalog に、廃止や廃止予定を表す field が無い）。',
				gap: '提供を終了するときの告知と移行先の記述が catalog に無い。schema への追加は別の Issue の領域である。',
			},
		],
	},
	{
		id: 'text-counter',
		kind: 'tool',
		subject: 'text-counter',
		record: 'src/tools/manifest.json',
		pointer: 'tools[slug=text-counter]',
		facts: [
			{ label: 'delivery.kind', value: 'host_disabled' },
			{ label: 'classification', value: 'needs_tool_side_fix' },
			{ label: 'license', value: 'MIT' },
		],
		notes: [
			{
				stageId: 'acquire',
				evidence:
					'manifest が `delivery.kind: host_disabled` と `disabled_reason` に「Tool is currently a Next.js component library (no vite.config, no index.html). Embedding blocked until the Tool repo adds a standalone Vite build path (Issue #81 follow-up after pilot).」を宣言している。',
				gap: null,
			},
			{
				stageId: 'operate',
				evidence: 'なし（配布 path が無いので、操作の入口も無い）。',
				gap: '利用者が入るべき入口が存在しない。',
			},
			{
				stageId: 'explain',
				evidence: '`disabled_reason` が「なぜ公開できないか」を説明している。',
				gap: null,
			},
			{
				stageId: 'recover',
				evidence: 'なし。',
				gap: '失敗した利用者に「待つ」以外の復帰手段が無い。',
			},
			{
				stageId: 'retire',
				evidence:
					'`disabled_reason` が解禁の条件（Tool リポジトリ側に standalone Vite build path を追加する）を書いている。',
				gap: '終了の告知は該当しない（そもそも未公開）。',
			},
		],
	},
];

/** The sections of the preview, in document order. */
export const usableProductSections: readonly PreviewSection[] = [
	{
		id: 'sources',
		heading: '典拠と読み方',
		kind: 'sources',
		paragraphs: [
			'本稿の典拠は、Issue #515 が引用した Miro board の見出し語「哲学 > 使えるものをつくる > DL配布/APIサービス」だけである（board の URL は本文の冒頭に記載する）。付箋の本文にはアクセスできないため、Miro にしか無い情報（年表・人数・評価・他人の私生活・未公開の作品）は本稿に一切持ち込まない。',
			'5段階の順序と「利用者の出口」という語彙は、見出し語を受入指標へ翻訳した本 Issue 側の解釈であり、Miro の原文の逐語訳ではない。owner の意図と一致するかは未確認（owner 確認待ち）。',
			'固有名詞・path・スキーマ・件数は、いずれも本リポジトリの記録（src/tools/manifest.json、src/http/api-directory/catalog.ts）から読み取ったものだけを記載している。記憶や推測、測定していない数値は書いていない。',
		],
		bullets: [
			'典拠: Issue #515 の Miro 引用（見出し語のみ）。付箋本文は読めていない。',
			'未確認（owner 確認待ち）: 見出し語以外の Miro 由来の記述、および 5 段階の順序と語彙が owner の意図と一致するか。',
			'実測: 記録ファイルからの読み取り。preview の事実値も parity test が同じ記録を読み直して照合する。',
		],
	},
	{
		id: 'stages',
		heading: '公開条件の5段階',
		kind: 'stages',
		paragraphs: [
			'公開の判定は「動くか」ではない。利用者が利用開始から失敗時の復帰まで、それぞれの段階で終えられるかで決める。',
			'5段階は順に置く。並び替えると「操作できないものを先に配ってよい」という誤読が生まれる。出口が閉じている段階があれば、その段階に到達するものは公開しない。',
		],
		bullets: [
			'入手: 利用開始できる。',
			'操作: 意図した操作を実行できる。',
			'説明: 結果を理解できる。',
			'失敗: 失敗から復帰できる。',
			'廃止: 終了を知らされ、必要なら移れる。',
		],
	},
	{
		id: 'checklist',
		heading: '段階ごとのチェックリスト',
		kind: 'checklist',
		paragraphs: [
			'各段階のチェックは「確認できたか」を問う。確認できない項目は保留（未確認）として記録し、勝手に埋めない。',
		],
		bullets: [],
	},
	{
		id: 'example-readmark',
		heading: '適用例 — 既存Tool（readmark）',
		kind: 'example',
		exampleId: 'readmark',
		paragraphs: [
			'配布されている Tool の実例。記録は Tool Registry manifest（src/tools/manifest.json）。',
		],
		bullets: [],
	},
	{
		id: 'example-reactions',
		heading: '適用例 — 既存API（/api/v1/reactions）',
		kind: 'example',
		exampleId: 'reactions',
		paragraphs: [
			'公開されている API サービスの実例。記録は公開 API directory（src/http/api-directory/catalog.ts）。',
		],
		bullets: [],
	},
	{
		id: 'example-text-counter',
		heading: '反例 — 公開できないTool（text-counter）',
		kind: 'example',
		exampleId: 'text-counter',
		paragraphs: [
			'同じ manifest が「公開できない」ことも記録できる。manifest が host_disabled として持つ記録は、5 段階のどの段階で出口が閉じているかを語れる。',
		],
		bullets: [],
	},
	{
		id: 'decisions',
		heading: '採用と保留',
		kind: 'decisions',
		paragraphs: [
			'採用とは、本 Issue の成果物として採用した判断である。保留とは、owner の判断か別の Issue の領域であるため採用しなかったもの——保留の項目は「決定した」とは書かない。',
		],
		bullets: [],
	},
	{
		id: 'open',
		heading: '残存 · 要 owner 判断',
		kind: 'open',
		paragraphs: ['次の項目は owner しか決められないため、本 Issue では実装せず記録に留めた。'],
		bullets: [],
	},
];

/** The decisions this Issue adopts. */
export const usableProductAdopted: readonly string[] = [
	'5段階の順序（入手 → 操作 → 説明 → 失敗 → 廃止）と、それぞれの「利用者の出口」を公開条件の語彙として採用する。',
	'5段階の並び替えを認めない。出口が閉じている段階があれば、その段階に到達するものは公開しない。',
	'判定の物差しは「動くか」ではなく「利用者が終えられるか」にする。',
	'Tool は Tool Registry manifest、API は公開 API directory という 2 つの既存記録に照らして適用例を書く。',
	'確認できない項目は保留（未確認）として記録し、埋めない。',
];

/** The decisions this Issue deliberately does not make. */
export const usableProductHeld: readonly string[] = [
	'廃止段階の告知期間（何日前にお知らせするか）は owner の判断であり、本 Issue では決めない。',
	'API directory の schema に deprecation を表す field を追加するかは、既存 schema の変更として別の Issue の領域にする。',
	'Tool manifest に操作の入力形（受け付ける file 形式・上限）を宣言するかは、manifest schema の変更として別の Issue の領域にする。',
	'5 段階を機械検査する gate にするかは、本 Issue の範囲（文書 + 単独 preview）を超える。',
];

/** The questions only the owner can answer. */
export const usableProductOpenDecisions: readonly string[] = [
	'Miro の付箋本文（見出し語以外）を確認できないため、5 段階の順序と「出口」の語彙が owner の意図と一致するかは未確認（owner 確認待ち）。',
	'「配布する Tool」と「公開する API サービス」のどちらに比重を置くかは、owner の判断である（未確認・owner 確認待ち）。',
	'廃止の告知をどの記録に書くか（Tool manifest / API catalog / 別の記録）は未確認（owner 確認待ち）。',
];

/** The preview header. */
export const usableProductTitle = '「使えるもの」を配布・API・操作の公開条件に落とす';

/** The preview lead paragraph. */
export const usableProductLead =
	'Miro の見出し語「哲学 > 使えるものをつくる > DL配布/APIサービス」を、機能完成ではなく利用開始から失敗時の復帰までの受入指標に翻訳した公開条件。5 段階それぞれの利用者の出口と、既存 Tool 1 件・API 1 件・反例 1 件への適用例。';
