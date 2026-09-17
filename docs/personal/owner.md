# Owner

> Status: **Canonical personal grounding**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self

この文書は、my-web-2026 における owner の公開してよい職能上の前提と意思決定境界を定義する。
履歴書の代替ではなく、実装や文章生成で「誰のサイトなのか」を勝手に補完しないための grounding である。

## Public identity

- 公開上のハンドルネームは **samuido**。
- この repository の保守・delivery 上の identity は **@rebuildup**。
- my-web-2026 は個人 Web Platform であり、特定の企業・団体の公式サイトではない。
- 実名、生年月日、居住地、学校名、私的な連絡先などは、この文書の canonical data にしない。

## Role

私は Web / software engineering を中心に、個人開発、creative coding、制作支援ツールや After Effects 周辺の開発、映像・グラフィックデザインを横断して活動する。

「エンジニア」「デザイナー」「映像制作者」のどれか一つに自分を固定しない。my-web-2026 では、活動ごとに必要な専門性を分けて表現しつつ、それらを同一人物の活動として矛盾なく接続する。

## Vision

my-web-2026 は単なる portfolio の作り直しではない。

公開プロフィール、作品、文章、活動履歴、制作した Tools、外部サービスとの接続など、私の活動に関する情報と機能を **個人ドメインの上で長期的に扱える infrastructure** にする。表示するためだけのデータではなく、後から検索・再構成・連携・自動化できる形で持つことを目指す。

そのため、ページ構成や framework の都合を canonical model にしない。Web UI は personal domain の一つの projection であり、将来 UI や runtime が変わっても、活動の意味と責任境界が残る構造を優先する。

## Decision authority

最終的な human authority は owner が保持する。agent や contributor は調査・実装・提案を行えるが、次の内容を owner の代わりに発明してはならない。

- **self-narrative authority** — 自己紹介、肩書き、活動の意味付け
- **career / activity fact authority** — 経歴、実績、時系列、公開可否
- **architecture authority** — stack、dependency、obligation boundary
- **visual authority** — visual language、表現方針、ブランド上の判断
- **integration authority** — 外部サービスを personal domain に接続する判断
- **release authority** — release PR merge、tag、GitHub Release 公開

事実の追加と、事実の見せ方の変更は別の判断として扱う。公開済みの記述が存在しても、それだけで新しい canonical fact へ昇格させない。

## Working languages

repository-wide contract として以下を使う。

- source code: English
- commit messages: English
- internal development docs: 日本語
- Issue / PR title and body: 日本語
- review discussion: 日本語
- branch names: identifier または release version。prose を使わない

公開コンテンツの言語は capability ごとに決める。repository の作業言語と、visitor-facing content の言語は同一 obligation ではない。

## Publication boundary

この repository は public / MIT である。docs に置く personal knowledge は professional framing に限定する。

- 実装に不要な個人特定情報を architecture grounding に混ぜない。
- 古い portfolio に存在する情報を「現在も正しい」と自動継承しない。
- 数値実績、経歴、受賞、連絡先など変化し得る情報は、current source of truth を確認してから公開 surface に使う。
- private な意思決定や認証情報はこの repository の domain knowledge にしない。

## Operating mode

my-web-2026 は **owner-operated / single-author を基本** とする。

協力者や agent が参加しても、personal narrative の authority は分散しない。一方、実装 responsibility は capability や integration ごとに分離してよい。人が一人であることと、obligation を一つにまとめることは別である。

## Grounding rule

owner について不明なことは unknown のまま扱う。

古いサイト、SNS、Issue、会話ログ、repository history は evidence にはなるが、それらの断片から新しい personal fact を推測しない。my-web-2026 で必要になった時点で、根拠を持つ fact だけを canonical data に昇格させる。
