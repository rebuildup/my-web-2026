/**
 * Audience-purpose matrix — the preview data for Issue #516.
 *
 * What this module owns
 * ---------------------
 * The EDITORIAL POLICY of the personal platform, in a form a preview can
 * render on its own: which claim register is admissible for which
 * visitor purpose, and how a claim is connected to a work, a history or
 * a contact channel.
 *
 * It is data, not a component, and it imports nothing: a module that
 * carries only literals can be read by the parity gate
 * (`scripts/check-audience-purpose-preview-parity.test.mjs`) with Node's
 * type stripping, so the document and the preview are proved to say the
 * same thing instead of merely looking like it.
 *
 * Why the words are the ones they are
 * ----------------------------------
 * The five purpose axes (就活 / 差別化 / 需要 / ネット集客 / 自慢) are the
 * only Miro wording this repository quotes, and they are quoted from
 * Issue #516, whose Miro citation is the single source available here:
 *
 *   哲学 > 見せたいものを作る > 就活 / 差別化 / 需要 / ネット集客 / 自慢
 *
 * The Miro board itself is not reachable from this repository, so
 * nothing about the axes' priority, weight, wording history or
 * evidence is asserted here. What is asserted is the EDITORIAL RULE:
 * the axes are a vocabulary for separating what a visitor came for, not
 * a sentence to publish. Anything that would need the board to be read
 * is written as 未確認（owner 確認待ち）.
 *
 * The four claim registers (誇示 / 事実 / 集客 / 採用) are the second
 * axis, and they are orthogonal to the five purposes: a purpose says
 * why somebody arrived, a register says how the claim is made. Keeping
 * them apart is what makes "do not inflate numbers or achievements"
 * checkable — a boast that is mixed into a fact is the defect, not a
 * fact that happens to be modest.
 *
 * Why nothing here is a new fact
 * -------------------------------
 * The cells name EXISTING surfaces (`/portfolio`, `/about`, `/contact`,
 * `/projects/dotfiles`, `/tools`) and EXISTING canonical documents
 * (`docs/personal/domain.md`). They record how a claim is connected; they
 * do not restate a person's history, a project's scope or a channel's
 * state, because those are owned elsewhere and would go stale here.
 */

/**
 * A table rendered under one section.
 *
 * The first column is the row header: the shipped `DataTable` primitive
 * renders it as `<th scope="row">`, so a screen reader announces
 * "row header, cell" while moving across a row.
 */
export interface AudiencePurposeMatrix {
	/**
	 * The table's name. It is the table's `<caption>` in the preview and
	 * the line above the table in the document — the same sentence in
	 * both, so a reader who sees only one of them still knows what the
	 * table is.
	 */
	caption: string;
	/** Column headers, the first one being the row-header column. */
	columns: readonly string[];
	/** One entry per row; the first cell of a row is its row header. */
	rows: readonly (readonly string[])[];
}

/**
 * One section of the policy document.
 *
 * `heading` is the `##` heading of the Markdown document and the title
 * the preview renders; `intent` is the sentence that follows it;
 * `points` are the bullet lines; `matrix` is the optional table. The
 * parity gate requires the document and this module to carry the same
 * strings, so a section cannot grow on one side only.
 */
export interface AudiencePurposeSection {
	/** The `##` heading, identical in the document and in the preview. */
	heading: string;
	/** One sentence: what this section decides. */
	intent: string;
	/** Bullet lines, in document order. */
	points?: readonly string[];
	/** The table under this section, when the section has one. */
	matrix?: AudiencePurposeMatrix;
}

/**
 * The document title.
 *
 * The same string is the `#` heading of the Markdown document and the
 * `<h1>` of the preview, so the two surfaces introduce themselves
 * identically.
 */
export const AUDIENCE_PURPOSE_TITLE = '訪問者目的別の編集方針（Issue #516）';

/**
 * The policy, section by section.
 *
 * The order is the reading order of the document: what the Miro
 * vocabulary is (and is not), the matrix itself, the claim registers,
 * the three connection points, the public / internal distinction, the
 * approval rule, and the record of what was adopted or held.
 */
export const AUDIENCE_PURPOSE_SECTIONS: readonly AudiencePurposeSection[] = [
	{
		heading: '1. Miro の階層は公開の語彙ではない',
		intent:
			'Miro の 5 つの語は「公開する主張」ではなく、編集者が訪問者の目的を振り分けるための語彙として扱う。',
		points: [
			'実例: /portfolio は作品だけを掲載し、目的軸を列挙しない。',
			'反例: 「就職活動にも差別化にもネット集客にも対応します」という一文。',
			'判断根拠: Miro の階層は訪問者の目的を振り分ける編集用語彙であり、公開 copy にする主張ではない。',
			'採用: 5 つの語は編集側の軸としてだけ使い、公開 surface には持ち出さない。',
			'保留: 5 軸の優先順位と重み付けは未確認（owner 確認待ち）。',
		],
	},
	{
		heading: '2. 目的別の情報要求',
		intent:
			'目的軸ごとに、どの主張の種別を許し、どの主張を許さないかを表で固定する。訪問者が来の目的で、根拠と導線が変わる。',
		matrix: {
			caption: '目的軸ごとの主張の種別（可 / 条件付き / 不可）',
			columns: ['主張の種別', '就活', '差別化', '需要', 'ネット集客', '自慢'],
			rows: [
				[
					'誇示',
					'不可（履歴で示す）',
					'条件付き（数字を増やさず作品で）',
					'条件付き（対象の明示に留める）',
					'条件付き（入口の絞り込みに留める）',
					'不可（語を置かない）',
				],
				[
					'事実',
					'可（期間と現状）',
					'可（再現できる差分）',
					'可（観測した範囲）',
					'可（公開状態）',
					'可（公開済みの事実）',
				],
				[
					'集客',
					'不可（募集は別軸）',
					'可（作品の入口へ）',
					'可（相談の入口へ）',
					'可（対象別の入口へ）',
					'不可（告知しない）',
				],
				[
					'採用',
					'可（背景と期間）',
					'不可（採用の話はしない）',
					'不可（別軸）',
					'不可（流入を募らない）',
					'不可（経歴は履歴で）',
				],
			],
		},
		points: [
			'実例: 就活目的の訪問者には「期間と現状」を書き、称賛や評価は書かない。',
			'反例: 一つの段落で 5 つの目的を同時に充足させる文。',
			'判断根拠: 目的が違えば訪問者が必要とする根拠も導線も違う。1 つの自己 PR にまとめると、どれの目的にも必要な根拠が残らない。',
			'採用: 表の verdict を編集の判断表として使う。',
			'保留: 「需要 × 採用」の組み合わせは未確認（owner 確認待ち）。',
		],
	},
	{
		heading: '3. 誇示・事実・集客・採用を別軸で扱う',
		intent: '4 つの主張の種別は目的軸とは別の軸であり、1 つの接続の中で混ぜない。',
		points: [
			'実例: 作品ページは「何を作ったか」を事実として書き、「誰のためのものか」は別の導線として書く。',
			'反例: 技術の誇示を語りながら、同じ段落で採用の募集も促す文。',
			'判断根拠: 誇示は事実の代わりにできない。数字や実績を盛らないという規則は、主張の種別を分けることで初めて意味を持つ。',
			'主張種別: 誇示 = 訪問者の判断材料にならない修飾。事実 = 検証できる状態。集客 = 次の接続先。採用 = 採用側の判断に必要な情報。',
			'採用: 4 つを別軸として扱い、1 つの接続では 1 軸を主軸にする。',
			'保留: 1 つの接続で複数の軸を主軸にする場合の書き分けは未確認（owner 確認待ち）。',
		],
	},
	{
		heading: '4. 実作品・履歴・問い合わせとの接続',
		intent: '根拠は 3 つの接続点にしか置かない。接続の書き方だけを決め、内容をこの文書に作らない。',
		matrix: {
			caption: '3 つの導線が接続できる先と、そこに書いてよいこと',
			columns: ['導線', '接続先', '根拠の正本', '書いてよいこと'],
			rows: [
				[
					'実作品',
					'/portfolio の公開 project、/projects/dotfiles の導入記事、/tools の tool',
					'公開されている成果物そのもの',
					'公開済みの内容と、その能把えた範囲',
				],
				[
					'履歴',
					'/about の person facts',
					'docs/personal/domain.md',
					'経歴・期間・位置づけ。評価や称賛は書かない',
				],
				[
					'問い合わせ',
					'/contact の re-verified 済み channel',
					'src/contact/ の判定結果',
					'用途と channel。未検証の channel は書かない',
				],
			],
		},
		points: [
			'実例: 「何を作ったか」を書くときは実作品へ、「いつから何をする人か」を書くときは履歴へ接続する。',
			'反例: 実作品・履歴・問い合わせのどれにも接続しない、意見だけの段落。',
			'判断根拠: 3 つの接続点は既存の公開 surface であり、新しい材料を作らずに済む。接続の書き方だけを決めると、主張の裏付けが尽きない。',
			'採用: 3 つの導線だけを接続点として使う。',
			'保留: 導線を追加する場合の基準は未確認（owner 確認待ち）。',
		],
	},
	{
		heading: '5. 公開の理念文と内部方針を混ぜない',
		intent: '公開される理念文と、この編集用の内部方針は別の文書・別の更新経路で保つ。',
		points: [
			'実例: 公開の理念文は docs/personal/principles.md と docs/domain/overview.md にあり、この文書はその作業規則である。',
			'反例: この文書の「不可」を公開ページの断定として出すこと。',
			'判断根拠: 公開の理念文は owner の主張として長く有効で、内部方針は編集の作業規則にすぎない。混ざると編集の判断が owner の主張として公開される。',
			'採用: 公開 surface への反映は別 ticket とし、この Issue では公開 copy を変更しない。',
			'保留: どの public surface に理念文を置くかは未確認（owner 確認待ち）。',
		],
	},
	{
		heading: '6. 公開承認と未確認の扱い',
		intent:
			'公開承認は owner の判断であり、agent は承認記録を作らない。確認できない典拠は未確認として残す。',
		points: [
			'実例: 公開日本語 copy の承認記録は owner が quality/copy-editorial-approvals.json に書く（docs/runbook/copy-editorial-approval.md）。',
			'反例: agent が承認記録を書いて copy gate を green にすること。',
			'判断根拠: 公開承認は owner の decision authority に属し、agent は事実の公開可否を判断する位置ではない。',
			'採用: 承認記録は owner に委ね、この Issue では公開 copy を変更しない。',
			'保留: Miro 付箋の本文・時系列・数値・評価はすべて未確認（owner 確認待ち）。',
		],
	},
	{
		heading: '7. 採用 / 保留の判断記録',
		intent: 'この Issue で採用した規則と、意図的に保留したものを分けて記録する。',
		points: [
			'実例: 採用したのは §2 の表と §4 の導線表で、公開 surface の変更はしていない。',
			'反例: 保留の項目を「将来対応」とだけ書いて、保留の理由を消してしまうこと。',
			'判断根拠: 保留は判断の保留であり、否定ではない。理由を消すと、次に読む人が同じ判断をやり直すことになる。',
			'決定: 採用 = 目的別の情報要求の表、実作品・履歴・問い合わせの導線表、公開の理念文と内部方針の区別。保留 = 目的軸の優先順位、導線の追加基準、どの public surface に理念文を置くか。',
		],
	},
];
