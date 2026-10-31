/**
 * Music-connections reference document — preview data (Issue #525).
 *
 * What this module is
 * -------------------
 * The *data* behind the Storybook preview of
 * `docs/influences/music-connections.md`: the same strings the
 * Markdown carries, so the preview shows the reference document
 * itself and not a paraphrase of it.
 *
 * Why the strings live in two places
 * ---------------------------------
 * The Markdown is the reference document (the canonical text). This
 * module is the preview's copy of it. A copy drifts, so
 * `scripts/check-music-connections-preview-parity.test.mjs` compares
 * the two on every `pnpm run test` (the runner discovers every
 * `scripts/*.test.mjs` by convention): the `##` headings, the `###`
 * headings, every list item and every paragraph have to match, in
 * both directions. A heading or an example that exists on one side
 * only is a failure, not a difference to be settled by hand — the
 * difference is recorded in the Markdown as a held item, or the
 * preview is corrected.
 *
 * What this module is NOT
 * -----------------------
 * It is not HTML and not a second authoring surface: it holds
 * strings, not markup, and it imports nothing from the repository.
 * The story renders it with the shipped `editorial` primitives only,
 * so the preview cannot reach a foreign obligation (AGENTS.md
 * section 3).
 *
 * What it deliberately does NOT carry
 * -----------------------------------
 * No absolute URL. The Miro board URL is the one external address
 * this document cites, and it belongs to the Markdown header: an
 * absolute URL in shipped source would add an external host to the
 * publication surface (`scripts/check-publication-diff.mjs`), and a
 * reference document does not need to make the shipped bundle reach
 * out to a board nobody can read from a Worker.
 */

/** What one section of the reference document is about. */
export type InfluenceSectionKind =
	/** What the document decides, and what it does not. */
	| 'scope'
	/** What the document may cite, and what it may not. */
	| 'evidence'
	/** The four kinds that are kept apart. */
	| 'kinds'
	/** The four touchpoint axes the issue names. */
	| 'axes'
	/** The prohibitions. */
	| 'prohibition'
	/** The separation of private notes from publishable examples. */
	| 'separation'
	/** The adopted and the not-adopted examples. */
	| 'adopted-case'
	/** The artefacts and the machine check. */
	| 'implementation'
	/** What nobody could confirm. */
	| 'open';

/** What one block inside a section is. */
export type InfluenceBlockKind =
	/** A plain rule / note list. */
	| 'list'
	/** One of the four kinds: 音楽 / 制作文化 / アーティスト / 映像作品. */
	| 'kind'
	/** One of the four touchpoint axes. */
	| 'axis'
	/** An example: 種 / 例 / 典拠 / 断定しないこと. */
	| 'case'
	/** A prohibition, named by its heading. */
	| 'prohibition';

/**
 * One block of a section.
 *
 * `heading` is the `###` heading in the Markdown, or `null` when the
 * block sits directly under the `##`.
 */
export interface InfluenceBlock {
	readonly heading: string | null;
	readonly kind: InfluenceBlockKind;
	/** The list items, byte-identical to the Markdown `- ` items. */
	readonly bullets: readonly string[];
}

/** One `##` section of the reference document. */
export interface InfluenceSection {
	/** The `##` heading, byte-identical to the Markdown. */
	readonly heading: string;
	readonly kind: InfluenceSectionKind;
	/** The one paragraph under the heading, byte-identical to the Markdown. */
	readonly lead: string;
	readonly blocks: readonly InfluenceBlock[];
}

/** The document-level metadata the preview renders above the sections. */
export interface InfluenceDocument {
	readonly title: string;
	readonly status: string;
	readonly source: string;
	readonly verification: string;
	readonly preview: string;
}

export const MUSIC_CONNECTIONS = {
	document: {
		title: '音楽からの接続点 — 楽曲・制作文化・映像表現・ソフトウェア制作の参照文書',
		status: 'Canonical influences reference document',
		source:
			'典拠: Issue #525 が引用する Miro の見出し語「好きなもの > 音楽 > DTM/好きなアーティスト/ボカロ/ネット音楽」',
		verification: '機械検証: scripts/check-music-connections-preview-parity.test.mjs',
		preview: 'プレビュー: src/personal/music-connections/MusicConnections.stories.tsx',
	} satisfies InfluenceDocument,
	sections: [
		{
			heading: '1. 目的とこの文書が解く問題',
			kind: 'scope',
			lead: '「好きなもの」の board は、好みの **分類** であり、因果叙述ではない。この文書は、その音楽クラスタを「好きな人物の一覧（Issue #363）」から切り離し、公開可能な記録として残すときの **採録規則** を固定する。',
			blocks: [
				{
					heading: null,
					kind: 'list',
					bullets: [
						'解くと決めた問題: 音楽 / 制作文化 / アーティスト / 映像作品 の 4 種をどう判別し、どう記録するか。',
						'解くと決めた問題: board に項目が並んでいること（見出し語として）を、因果や影響の証拠として使わないという規則。',
						'解くと決めた結果: 記事にする前段階の非公開編集メモと公開可能な例を、混ざらない 2 つの資産として分ける規則（§6）。',
						'解くと決めた結果: 公開可能な例として採用する例と、採用しない理由の書き方（§7）。',
						'解かないこと: 誰が何を好むかの一覧そのもの。owner の preference であり本文書の対象外。',
						'解かないこと: 既存機能の本番 route 接続や公開ページの追加（Issue #525 の責務分離）。',
						'解かないこと: Issue #380 / #381 は参照先であり、本文書の前提条件ではない。',
					],
				},
			],
		},
		{
			heading: '2. 典拠と到達範囲',
			kind: 'evidence',
			lead: '典拠は Issue #525 本文が引用した Miro の見出し語「好きなもの > 音楽 > DTM/好きなアーティスト/ボカロ/ネット音楽」と、本文書のヘッダーが挙げる board URL だけである。Miro の付箋にはアクセスできないので、付箋にしか無い情報は書かない。',
			blocks: [
				{
					heading: '書かないもの',
					kind: 'list',
					bullets: [
						'Miro の付箋にある曲名・アーティスト名・作品名・年表・人数・評価。',
						'「好きなもの」board の並び順が持つ意味（順序を意味として読まない）。',
						'owner が書いていない本人についての記述。',
					],
				},
				{
					heading: '代わりに使う典拠',
					kind: 'list',
					bullets: [
						'docs/personal/domain.md §6 / §8 — 映像制作・表現様式・After Effects 向け tool 開発についての owner 自身の公開記録。',
						'docs/personal/knowledge-model.md — Preference / Interest の時制と、assert は owner の final authority であるという authority 表。',
						'docs/personal/owner.md — grounding precedence（owner の明示 → canonical 文書 → current public source → dated public record → historical → inference）。',
						'docs/personal/domain.md §15 — public content について推定で補ってはいけないものの一覧。',
						'docs/domain/content-review.md §5 — 「断定しない」「採点しない」という review 契約。',
						'src/portfolio/schema.ts — portfolio が公開する facet の閉じた語彙（develop / video / design / other）。本文書はこの語彙を増やさない。',
					],
				},
				{
					heading: '未確認の扱い',
					kind: 'list',
					bullets: [
						'確認できない内容は「未確認（owner 確認待ち）」と書いて、断言を保留する（§9）。',
						'「わからない」を空欄にしない。空欄は「まだ何も決まっていない」と読まれる。',
					],
				},
			],
		},
		{
			heading: '3. 4 種の区別（音楽 / 制作文化 / アーティスト / 映像作品）',
			kind: 'kinds',
			lead: '音楽クラスタから記録できるものは 4 種に区別される。**混ざって記録しない** ことが、この文書の最初の規則である。',
			blocks: [
				{
					heading: '音楽',
					kind: 'kind',
					bullets: [
						'判別：個別の楽曲・録音・作品そのもの。曲名または録音名で特定できるもの。',
						'記録する：名称、発表元、公開 link、owner がそれを気に入っているという事実。',
						'記録しない：owner の明示がないまま、その楽曲と owner の制作の因果関係を書くこと。再生数・評価・順位などの数値。',
						'他の種との境界：アーティストの項目ではない。制作文化の項目でもない。',
					],
				},
				{
					heading: '制作文化',
					kind: 'kind',
					bullets: [
						'判別：作り方の共有された scene。特定の作品ではなく、制作の型。',
						'記録する：scene の名称（Issue #525 が引用した Miro 見出し語の "DTM" / "ボカロ" / "ネット音楽"）と、その scene が何を指すかの説明。',
						'記録しない：scene の規模・歴史・参加者名・統計。',
						'他の種との境界：楽曲でもアーティストでもない。scene 名があることは、その scene の software を作ったことの証拠でもない（§4）。',
					],
				},
				{
					heading: 'アーティスト',
					kind: 'kind',
					bullets: [
						'判別：人物（個人・ユニット）そのもの。作品ではなく主体。',
						'記録する：名称、公式 link、owner が好きだとしているという事実。',
						'記録しない：第三者の私生活・家族・交際・収入・健康・所在地などの私的情報（§5 禁止 2）。',
						'他の種との境界：楽曲の項目ではない。同じ cluster にあることは同じ種であることを意味しない。',
					],
				},
				{
					heading: '映像作品',
					kind: 'kind',
					bullets: [
						'判別：個別の映像作品（MV、short video、animation、lyric motion の作品）。',
						'記録する：作品名・用途・公開 link・どの制作手段で成立したか。',
						'記録しない：再生数・視聴者数などの数値、制作の非公開メモ。',
						'他の種との境界：§4 の「映像表現」（表現の様式）ではない。様式と、様式でできた作品とは別の記録。',
					],
				},
			],
		},
		{
			heading: '4. 4 つの接点軸（楽曲 / 制作文化 / 映像表現 / ソフトウェア制作）',
			kind: 'axes',
			lead: 'Issue #525 はこの音楽クラスタを、楽曲・制作文化・映像表現・ソフトウェア制作の 4 つの接点として整理すると定めている。接点とは **どちらに紐づくか** の話であり、影響の主張ではない。',
			blocks: [
				{
					heading: '楽曲',
					kind: 'axis',
					bullets: [
						'意味：音楽の個々の作品そのもの（§3「音楽」と同じ対象）。',
						'記録できる接点：作品と owner の preference の関係。ただし owner が明示した記録があるときだけ。',
						'記録できない接点：楽曲 → 映像表現 → ソフトウェア制作 の連鎖。board に並んでいても、間の因果を生成しない。',
					],
				},
				{
					heading: '制作文化',
					kind: 'axis',
					bullets: [
						'意味：DTM / ボカロ / ネット音楽 のような、作り方の共有された scene。',
						'記録できる接点：scene が何を指すかの説明。owner が明示した参加・制作の事実。',
						'記録できない接点：scene の規模・歴史・参加者名・統計。',
					],
				},
				{
					heading: '映像表現',
					kind: 'axis',
					bullets: [
						'意味：表現の様式（motion / lyric motion / animation / typography など）。',
						'記録できる接点：docs/personal/domain.md §6 の owner の公開記録（After Effects を中心に motion・lyric motion・MV・short video・animation を継続的に作り、表現を作る側と道具を作る側を行き来する）。',
						'記録できない接点：Miro の音楽 cluster とこの様式の間に、owner の明示のない因果を書くこと。',
					],
				},
				{
					heading: 'ソフトウェア制作',
					kind: 'axis',
					bullets: [
						'意味：creator が使う道具を作ること（script / plugin / extension）。',
						'記録できる接点：docs/personal/domain.md §8 の owner の公開記録（Aulymo / MultiSlicer ほか）。',
						'記録できない接点：音楽の好みと道具開発の因果（§5 禁止 1）。',
					],
				},
			],
		},
		{
			heading: '5. 断定しない規則（禁止事項）',
			kind: 'prohibition',
			lead: '次の 4 つは、記録の欠落ではなく **創作** である。したがって禁止する。',
			blocks: [
				{
					heading: '禁止 1: 「影響された」を追加しない',
					kind: 'prohibition',
					bullets: [
						'board は「好きなもの」の **分類** であり、因果叙述ではない。項目が並んでいても、間の因果を生成してはならない。',
						'「〜に影響された」「〜から始まった」は、owner が current interaction で明示した記録がある場合にだけ書ける。',
						'根拠：docs/personal/knowledge-model.md の authority 表は、preference / intention の確定を owner の final authority とする。',
						'運用：書けない場所は空欄ではなく「未確認（owner 確認待ち）」とする（§9）。',
					],
				},
				{
					heading: '禁止 2: 第三者の私生活を記録しない',
					kind: 'prohibition',
					bullets: [
						'アーティストの項目に、私生活・家族・交際・収入・健康・所在地などを書かない。',
						'人物の記録は、名称・公式 link・owner が好きだとしているという事実までとする。',
						'根拠：Issue #525 が明示的に禁じている範囲。docs/personal/domain.md §15 も public content での私的情報の創作を禁じている。',
					],
				},
				{
					heading: '禁止 3: 数値と年表を創作しない',
					kind: 'prohibition',
					bullets: [
						'再生数・評価・順位・売上・人数・年表を作らない。測定していない数値は「測っていない」と書く。',
						'docs/personal/domain.md §8 の実績数値は公開プロフィール上の値であり、本文書はそれを複製も延長もしない。',
						'根拠：docs/personal/knowledge-model.md「日付の精度を捏造しない」と、docs/domain/content-review.md §5 の「採点しない」。',
					],
				},
				{
					heading: '禁止 4: 未確認を空欄で残さない',
					kind: 'prohibition',
					bullets: [
						'判別できない項目は空欄にしない。「未確認（owner 確認待ち）」と書く。',
						'「わからない」を結論の代わりに置かない。',
					],
				},
			],
		},
		{
			heading: '6. 非公開編集メモと公開可能な例の分離',
			kind: 'separation',
			lead: '記事にする前段階の編集メモと、公開できる例は別の資産として扱う。公開 repository には公開側だけを置き、編集側は repository の外側に置く。',
			blocks: [
				{
					heading: '分離の規則',
					kind: 'list',
					bullets: [
						'編集メモ（書きかけの断片、owner 未確認の事実候補、推測の年表、感情のメモ、判定前の候補リスト）は public repository に置かない。',
						'編集メモを公開可能な例に変える操作は「証拠を添付する」ことであり、「書き足し」ではない。',
						'公開の可否は owner の final authority であり、記録者は公開しない（docs/personal/knowledge-model.md の authority 表）。',
						'private data 自体を public repository に入れない（同文書の「Visibility is independent from truth」）。',
					],
				},
				{
					heading: '公開可能な例に必要な条件',
					kind: 'list',
					bullets: [
						'種が判別できる（§3 の 4 種のいずれか）。',
						'典拠が指せる（repository 内の file path / Issue 本文 / board の見出し語）。',
						'第三者の私性が含まれない（§5 禁止 2）。',
						'因果叙述を含まない（§5 禁止 1）。',
						'数値と年表が創作されていない（§5 禁止 3）。',
					],
				},
				{
					heading: 'repository に置かないもの',
					kind: 'list',
					bullets: [
						'Miro の付箋の全文の写し、board の画像、付箋の未確認の値。',
						'owner の私的なメモと、判定前の候補リスト（保留の理由だけを書く）。',
						'公開済みの例と未確認の候補を混ぜた一覧。',
					],
				},
			],
		},
		{
			heading: '7. 採用した公開可能な例',
			kind: 'adopted-case',
			lead: '公開可能な例として採用するのは **2 件** である（映像作品・制作文化）。音楽とアーティストは実名が Miro の付箋にのみ存在するため採用せず、未確認（owner 確認待ち）として残す。',
			blocks: [
				{
					heading: '採用例: 映像作品 — After Effects での映像制作',
					kind: 'case',
					bullets: [
						'種：映像作品',
						'例：After Effects を使った映像制作（MV、short video、学校・部活動向け映像など実際の用途を持つ制作）。',
						'典拠：docs/personal/domain.md §8「Video / motion experience」（owner 自身が書いた公開記録）。',
						'断定しないこと：Miro の音楽 cluster とこの制作の因果を説明すること（§5 禁止 1）。制作の非公開メモを持ち込むこと（§6）。',
					],
				},
				{
					heading: '採用例: 制作文化 — DTM / ボカロ / ネット音楽',
					kind: 'case',
					bullets: [
						'種：制作文化',
						'例：DTM、ボカロ、ネット音楽（Miro 見出し語として Issue #525 が引用した 3 つの scene 名）。',
						'典拠：Issue #525 本文の「Miro原典」行。付箋の本文は未取得。',
						'断定しないこと：各 scene への owner の参加・制作経験（owner の明示がないため）。scene の規模・歴史・参加者名・統計。',
					],
				},
				{
					heading: '未採用例: 音楽 — 未確認（owner 確認待ち）',
					kind: 'case',
					bullets: [
						'種：音楽',
						'例：未確認（owner 確認待ち）。Miro の board の「音楽」クラスタには見出し語しか Issue #525 に載っておらず、楽曲の実名は付箋にのみ存在する。',
						'典拠：Issue #525 本文の「Miro原典」行（見出し語のみ）。',
						'断定しないこと：曲名・発表元・link の創作（§5 禁止 3）。',
					],
				},
				{
					heading: '未採用例: アーティスト — 未確認（owner 確認待ち）',
					kind: 'case',
					bullets: [
						'種：アーティスト',
						'例：未確認（owner 確認待ち）。Miro 見出し語「好きなアーティスト」は種を示すだけで、氏名は付箋にのみ存在する。',
						'典拠：Issue #525 本文の「Miro原典」行（見出し語のみ）。',
						'断定しないこと：氏名の創作。人物の私的情報の記述（§5 禁止 2）。',
					],
				},
			],
		},
		{
			heading: '8. 実装と機械検証',
			kind: 'implementation',
			lead: '本文書は Markdown の内容と preview の中身を機械的に一致させる。片方にだけ見出しや例がある状態で、レビューが「同じもの」を見落とす状態を機械的に防ぐ。',
			blocks: [
				{
					heading: '成果物',
					kind: 'list',
					bullets: [
						'参照文書（正本）：docs/influences/music-connections.md',
						'preview データ：src/personal/music-connections/MusicConnections.preview.ts',
						'preview story：src/personal/music-connections/MusicConnections.stories.tsx（Storybook の Preview / Music connections）',
						'一致検証：scripts/check-music-connections-preview-parity.test.mjs（pnpm run test が scripts/*.test.mjs を discovery する）',
						'検証画像：docs/verification/influences/music-connections-preview.webp（node scripts/capture-music-connections.mjs で再生成）',
					],
				},
				{
					heading: '一致が壊れたら',
					kind: 'list',
					bullets: [
						'一致検証は Markdown の ## 見出し、### 見出し、箇条書きの項目、段落を preview データと突き合わせる。',
						'片側にしか存在しない見出しや例があれば fail する。差分は「保留」として Markdown に明記してから直す。',
						'判定を緩めて green にする運用は行わない。',
					],
				},
				{
					heading: '機械で守っていること',
					kind: 'list',
					bullets: [
						'4 種（音楽 / 制作文化 / アーティスト / 映像作品）が §3 に 1 つずつ存在し、preview 側でも同じ 4 種である。',
						'§5 の禁止事項に該当する語（因果の断定・第三者の私生活・創作された数値）は、禁止節の中か、その語を禁じている文脈の中にしか現れない。',
						'preview が引用する file path が repository に実在する。',
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
						'Miro の付箋の全文。board の項目名（曲名・アーティスト名・作品名）と、それぞれの位置づけ。',
						'「好きなもの」cluster を Miro の他の board とどうつなぐか。',
						'音楽クラスタと映像制作のあいだに owner 自身が見ている関係。owner が明示するまでは「影響」と書かない。',
						'非公開編集メモの実際の保存先（tool / 場所 / 同期）。§6 の規則は確定しているが、置き場そのものは未決。',
						'採用した例を一般の読者にどう見せるか（§7 の採用は記録の成立であり、公開面の判断ではない）。',
					],
				},
				{
					heading: 'この Issue がやらないこと',
					kind: 'list',
					bullets: [
						'公開ページ・route の追加。',
						'好きな人物一覧（Issue #363）への追記。',
						'Miro 由来の情報の創作。',
						'owner の承認記録の作成（copy editorial approval の承認は owner が書く）。',
					],
				},
			],
		},
	],
} as const;
