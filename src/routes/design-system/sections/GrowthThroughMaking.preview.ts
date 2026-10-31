/**
 * Growth-through-making content specification — preview data (Issue #513).
 *
 * What this module is
 * -------------------
 * The *data* behind the Storybook preview of
 * `docs/personal/growth-through-making.md`: the same strings the
 * Markdown carries, so the preview shows the specification itself and
 * not a paraphrase of it.
 *
 * Why the strings live in two places
 * ---------------------------------
 * The Markdown is the specification (the canonical text). This module
 * is the preview's copy of it. A copy drifts, so
 * `scripts/check-growth-through-making-preview-parity.test.mjs`
 * compares the two on every `pnpm run test`: the `##` headings, the
 * `###` headings, every list item and every paragraph have to match,
 * in both directions. A heading or a case that exists on one side only
 * is a failure, not a difference to be settled by hand — the
 * difference is recorded in the Markdown as a held item, or the
 * preview is corrected.
 *
 * What this module is NOT
 * -----------------------
 * It is not HTML and not a second authoring surface: it holds strings,
 * not markup, and it imports nothing from the repository. The story
 * renders it with the shipped `editorial` primitives only, so the
 * preview cannot reach a foreign obligation (AGENTS.md section 3).
 */

/** What one section of the specification is about. */
export type GrowthSectionKind =
	| 'scope'
	| 'evidence'
	| 'criteria'
	| 'prohibition'
	| 'separation'
	| 'adopted-case'
	| 'held-case'
	| 'implementation'
	| 'open';

/** What one block inside a section is. */
export type GrowthBlockKind =
	/** A plain rule / note list. */
	| 'list'
	/** An adopted before / after case: `before` / `after` / `学び` / `証拠`. */
	| 'case'
	/** A held candidate: `理由` / `採らない根拠` / `解除条件`. */
	| 'held';

/**
 * One block of a section.
 *
 * `heading` is the `###` heading in the Markdown, or `null` when the
 * block sits directly under the `##` (the first section has no `###`).
 */
export interface GrowthBlock {
	readonly heading: string | null;
	readonly kind: GrowthBlockKind;
	/** The list items, byte-identical to the Markdown `- ` items. */
	readonly bullets: readonly string[];
}

/** One `##` section of the specification. */
export interface GrowthSection {
	/** The `##` heading, byte-identical to the Markdown. */
	readonly heading: string;
	readonly kind: GrowthSectionKind;
	/** The one paragraph under the heading, byte-identical to the Markdown. */
	readonly lead: string;
	readonly blocks: readonly GrowthBlock[];
}

/** The document-level metadata the preview renders above the sections. */
export interface GrowthDocument {
	readonly title: string;
	readonly status: string;
	readonly source: string;
	readonly verification: string;
	readonly preview: string;
}

export const GROWTH_THROUGH_MAKING = {
	document: {
		title: '作りながら成長する — 成長を作品と試行錯誤に紐づけるコンテンツ仕様',
		status: 'Canonical growth-content specification',
		source: '典拠: Issue #513 が引用する Miro の見出し語「哲学 > 作ることで成長する > 自信になる」',
		verification: '機械検証: scripts/check-growth-through-making-preview-parity.test.mjs',
		preview: 'プレビュー: src/routes/design-system/sections/GrowthThroughMaking.stories.tsx',
	} satisfies GrowthDocument,
	sections: [
		{
			heading: '1. 目的とこの仕様が解く問題',
			kind: 'scope',
			lead: '「成長」の記録は、その人の自己説明ではなく、証拠に紐づいた before / after として書ける。本仕様は、公開できる記録に採録する「成果 / 失敗 / 学び」の選別基準と、創作してはならない表現を固定する。',
			blocks: [
				{
					heading: null,
					kind: 'list',
					bullets: [
						'解くと決めた問題: 成長の記録に残す成果 / 失敗 / 学びをどう選別するか。',
						'解くと決めた問題: 年表・感情・自己評価を、記録者が創作せずにどう扱うか。',
						'解くと決めた問題: 非公開の編集メモと公開可能な短文をどう分けるか。',
						'解くと決めた結果: 公開可能な before/after 事例を 1 件採用する（§6）。',
						'解くと決めた結果: 学習成果を自己採点スコアで創作しない（§4）。',
						'解くと決めた結果: 非公開の記録を公開 repo と build に入れない（§5）。',
						'解かないこと: 公開页面の構成、公開 surface の追加、どの段をどの页面に出すかは owner 決定であり、本 Issue では決めない（§9）。',
						'解かないこと: Issue #380 / #381 は参照先であり、本仕様の前提条件ではない。',
					],
				},
			],
		},
		{
			heading: '2. 典拠と到達範囲',
			kind: 'evidence',
			lead: '典拠は Issue #513 本文が引用した Miro の見出し語「哲学 > 作ることで成長する > 自信になる」1 行だけである。Miro にはアクセスできないので、それ以外の Miro 情報は書かない。',
			blocks: [
				{
					heading: '書かないもの',
					kind: 'list',
					bullets: [
						'Miro の付箋にある年表・感情・数値・作品一覧。',
						'「哲学」「作ることで成長する」「自信になる」の各段に対する、owner 以外の者による解釈。',
						'owner が書いていない本人についての記述。',
					],
				},
				{
					heading: '代わりに使う典拠',
					kind: 'list',
					bullets: [
						'docs/personal/owner.md — authority の表。record / assert / publish は owner の final authority である。',
						'docs/personal/knowledge-model.md — truth authority と publication authority の分離、および「my-web-2026 の public repository には private data 自体を置かない」。',
						'docs/domain/content-review.md — 「断定しない」「採点しない」という review 契約。',
						'docs/personal/principles.md — 観測前の obligation を作らないという判断。',
						'docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md — §6 で採用する事例の典拠。',
					],
				},
				{
					heading: '未確認の扱い',
					kind: 'list',
					bullets: [
						'確認できない内容は「未確認（owner 確認待ち）」と書いて、断言を保留する（§9）。',
						'「わからない」を空欄にしない。空欄は、読者に「まだ何も決まっていない」と読まれる。',
					],
				},
			],
		},
		{
			heading: '3. 記録の選別基準（成果 / 失敗 / 学び）',
			kind: 'criteria',
			lead: '記録に採録するのは **証拠に紐づき、公開して差し支えない** ものだけであり、選別の根拠は次の 3 条件が **すべて** 揃うことである。',
			blocks: [
				{
					heading: '採録する条件（3 つとも満たす）',
					kind: 'list',
					bullets: [
						'証拠がある: file path / URL / gate 名 / ADR の節で指せる。指せないものは採録しない。',
						'before と after が同じ対象について撮れている: 対象以外の条件を変えていない。',
						'公開して差し支えない: 公開可否は owner の判断であり、記録者が判断しない（§5）。',
					],
				},
				{
					heading: '3 種別の扱い',
					kind: 'list',
					bullets: [
						'成果: 公開できる形で到達した状態。before / after の after 側として書く。',
						'失敗: 採用しなかった案、または壊れた状態。採用しなかった理由まで書く。理由が残らないと、同じ失敗が次の検討で再提出される。',
						'学び: 失敗または試行から得られた、次の判断に使える規則。規則として書く。',
					],
				},
				{
					heading: '学びの書き方',
					kind: 'list',
					bullets: [
						'数値で測れないものを、測ったように書かない。測れない場合は「測っていない」と書く。',
						'「成長した」と結論だけを書かない。どの判断がどう変わったかが書けない結論は記録ではない。',
						'測れる場合は、測った値と測定方法（docs/verification/ 配下の記録）をセットで書く。',
					],
				},
			],
		},
		{
			heading: '4. 禁止事項',
			kind: 'prohibition',
			lead: '次の 3 つは、記録の欠落ではなく **創作** である。したがって禁止する。',
			blocks: [
				{
					heading: '禁止 1: 年表・感情の印象の創作',
					kind: 'list',
					bullets: [
						'具体的な年・月・出来事を、owner の本人の記述なく書かない。',
						'感情（悔しい・楽しい・誇らしい 等）を、owner の本人の記述でない形で書かない。',
						'運用: 書けない場所は空欄ではなく「未確認（owner 確認待ち）」とする（§9）。',
						'根拠: docs/personal/owner.md の authority 表は、record（出来事の確定）と assert（主観的状態・感情の確定）を owner の final authority とし、agent には proposal しか認めていない。',
					],
				},
				{
					heading: '禁止 2: 自己評価スコアで学習成果を創作しない',
					kind: 'list',
					bullets: [
						'採点式（100 点満点、5 段階評価、合格 / 不合格の自己採点）を、成果の表現に使わない。',
						'「自信」は評点ではなく、再現可能性として書く。すなわち「その判断の根拠が記録に残っている」ことを示す。',
						'測れるものは before / after の差として書き、測れないものは「測っていない」と書く。',
						'根拠: docs/domain/content-review.md §5 は review 契約で「採点しない」と決め、同じ語彙を成長記録にも持ち込まない。',
					],
				},
				{
					heading: '禁止 3: 断定しない',
					kind: 'list',
					bullets: [
						'「〜である」は、証拠がある文にだけ使う。',
						'判定できない場合は「判定できなかった」と書く。',
						'根拠: docs/domain/content-review.md §5 は「誤り」と判定しないこと、gate の語彙は review pending であり断定する verdict 語を使わないことを契約している。',
					],
				},
			],
		},
		{
			heading: '5. 非公開の編集メモと公開可能な短文の分離',
			kind: 'separation',
			lead: '編集用のメモと、公開する短文は別の資産として扱う。公開 repo には公開側だけを置き、編集側は公開 repo と build の外側に置く。',
			blocks: [
				{
					heading: '分離の規則',
					kind: 'list',
					bullets: [
						'編集メモ（書きかけの断片、owner 未確認の事実候補、感情、採点メモ、時系列の仮説）は公開 repo に置かない。',
						'編集メモを公開可能な短文に変える操作は「証拠を添付する」ことであり、「書き足し」ではない。owner が書いていない内容を足さない。',
						'公開の可否（publish / unpublish）は owner の final authority であり、記録者は公開しない（docs/personal/knowledge-model.md の authority 表）。',
						'private data 自体を public repository に入れない（docs/personal/knowledge-model.md「Visibility is independent from truth」）。',
						'公開 build に含めるのは、owner の承認記録のある公開 copy surface だけである（quality/copy-editorial-surfaces.json と copy:approval:check）。',
					],
				},
				{
					heading: '非公開メモの置き場所',
					kind: 'list',
					bullets: [
						'置き場所は本リポジトリの外（owner の private notes / 作業ディレクトリ）である。repository 内に置き場を作らない。',
						'作業中の一時メモは .tmp/（gitignored）に置くが、これは保存場所ではなく、消失してよい領域である。',
						'将来「非公開メモの store」を導入する場合の制約は 1 つだけ: 公開 repo のファイルでも公開 build の bundle でもないこと。',
						'store の実装（tool / 場所 / 同期）は owner 決定であり、本 Issue では導入しない（§9）。観測前の obligation を作らない（docs/personal/principles.md）。',
					],
				},
			],
		},
		{
			heading: '6. 採用した before/after 事例',
			kind: 'adopted-case',
			lead: '公開可能な before/after 事例を 1 件採用する。採用の根拠は、事例が **公開記録として既に存在する** こと（ADR・検証画像・gate）と、**before と after が同じ対象について撮れている** ことだけである。',
			blocks: [
				{
					heading: '事例: URL slug の扱い — 「正規化でつなぐ」から「拒否して通さない」へ',
					kind: 'case',
					bullets: [
						'before: slug の妥当性は owner ごとの regex だけで判断されており、判断理由（reason code）も衝突監査もなかった。ADR-0017 §4 はこの状態を "the pre-#433 state" と記録し、emoji slug の regex が 3 箇所に複製されていたと書いている。',
						'after: src/i18n/ が leaf obligation として判断表と拒否理由を所有し、emoji / portfolio の 2 つの URL 空間が classifySlugCandidate を通して同じ規則に載った。pnpm run i18n:policy:check が、src/ 側で NFKC や暗黙の locale 呼び出しを書くと落とす。',
						'学び: 正規化は可逆ではない。一般の slugify は必ず lossy fold（NFKD / 結合記号の除去 / 音訳）で終わり、別語が 1 つの URL に統合されうる。ADR-0017 §3 の測定では 5 µm tolerance と 5 μm tolerance の naive slug はどちらも /5-m-tolerance になり、N ≠ 3 (非対応) は /n-3 になって否定が消える。よって「写像が一対一であること」を守れるのは、導出ではなく拒否である。',
						'証拠: docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md（§2.2 / §3 / §4）、docs/domain/i18n.md §3、docs/verification/i18n/unicode-slug-validation.md と .webp、src/i18n/slug-identity.ts、src/i18n/fixtures.ts、scripts/check-i18n-policy.mjs。',
					],
				},
			],
		},
		{
			heading: '7. 保留（採用を見送った事例）',
			kind: 'held-case',
			lead: '採用を見送った候補も、理由とともに記録する。保留の理由を書いておかないと、同じ候補が次の検討で無言で再提出される。',
			blocks: [
				{
					heading: '保留: 年表つきの成長記録',
					kind: 'held',
					bullets: [
						'理由: 「哲学 > 作ることで成長する > 自信になる」を時系列で語ると、読む人は年表を成長の証拠として読む。',
						'採らない根拠: 年・月・出来事の確定は owner の final authority であり（docs/personal/owner.md）、owner の本人記述がない年表は作成できない。docs/personal/knowledge-model.md も「日付の精度を捏造しない」と定める。',
						'解除条件: owner が時系列を自分で書いた記録が canonical knowledge として存在する状態。',
					],
				},
				{
					heading: '保留: 公開面の履歴版の appearance 記録',
					kind: 'held',
					bullets: [
						'理由: primitive の追加や layout の見直しのような視覚面の変更は「作ることで成長する」に最も近い例に見え、公開页面の履歴版と現状を並べたい。',
						'採らない根拠: 公開面の履歴版の画像は公開リポジトリに存在せず、本 Issue は履歴画像を生成しない。参照できない差を断定として書くと、証拠のない主張になる。',
						'解除条件: 公開面の履歴版の画像が repository に記録され、その差が何を指すかが明示された状態。',
					],
				},
				{
					heading: '保留: 閲覧数を成長の証拠にする',
					kind: 'held',
					bullets: [
						'理由: 閲覧数は公開可能な数値であり、公開されていることの外部証拠として使えそう。',
						'採らない根拠: 閲覧数は「公開されている」ことは示すが、製作過程の学習を示さない。docs/personal/knowledge-model.md は truth と publication を分けるので、公開されていることと成長は別の主張である。',
						'解除条件: 閲覧数を成長の証拠として読む根拠を owner が明示し、かつ数値の測定方法が公開記録として残る状態。',
					],
				},
			],
		},
		{
			heading: '8. 実装と機械検証',
			kind: 'implementation',
			lead: '本仕様は、Markdown の内容と preview の中身を機械的に一致させる。片方にだけ見出しや事例がある状態で、レビューが「同じもの」を見落とす状態を機械的に防ぐ。',
			blocks: [
				{
					heading: '成果物',
					kind: 'list',
					bullets: [
						'仕様書（正本）: docs/personal/growth-through-making.md',
						'preview データ: src/routes/design-system/sections/GrowthThroughMaking.preview.ts',
						'preview story: src/routes/design-system/sections/GrowthThroughMaking.stories.tsx（Storybook の Preview / Growth through making）',
						'一致検証: scripts/check-growth-through-making-preview-parity.test.mjs（pnpm run test が scripts/*.test.mjs を discovery する）',
						'検証画像: docs/verification/vision/growth-case-study-preview.webp（node scripts/capture-growth-through-making.mjs で再生成）',
					],
				},
				{
					heading: '一致が壊れたら',
					kind: 'list',
					bullets: [
						'一致検証は Markdown の ## 見出し、### 見出し、箇条書きの項目、段落を preview データと突き合わせる。',
						'片側にしか存在しない見出しや事例があれば fail する。差分は「保留」として Markdown に明記してから直す。',
						'判定を緩めて green にする運用は行わない。差分は Markdown と preview のどちらを直すかを記録に残す。',
					],
				},
			],
		},
		{
			heading: '9. 未確認（owner 確認待ち）',
			kind: 'open',
			lead: '次の項目は、Miro にも owner にも確認できないため、現時点では **未確認（owner 確認待ち）** とする。',
			blocks: [
				{
					heading: '未確認の項目',
					kind: 'list',
					bullets: [
						'Miro の付箋の全文。「哲学 > 作ることで成長する > 自信になる」以外の年表・感情・数値・作品。',
						'「哲学」「作ることで成長する」「自信になる」の各段を、どの公開 surface に出るか。',
						'非公開編集メモの実際の保存先（tool / 場所 / 同期）。§5 の規則は確定しているが、置き場そのものは未決。',
						'採用した事例を一般の読者にどう見せるか（ADR / gate / 検証画像は public だが、見せ方の判断は owner の領域）。',
						'成長を数値で示す代替指標を採用するか。§4 で自己採点スコアを禁じたが、代替の指標としては未決。',
					],
				},
				{
					heading: 'この Issue がやらないこと',
					kind: 'list',
					bullets: [
						'公開页面の追加・改稿。',
						'Miro 由来の情報の創作。',
						'owner の承認記録の作成（copy editorial approval の承認は owner が書く）。',
					],
				},
			],
		},
	],
} as const;
