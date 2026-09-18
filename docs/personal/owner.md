# Owner

> Status: **Canonical owner / authority grounding**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self

my-web-2026 が表現する人物そのものの canonical grounding は **[domain.md](domain.md)** に置く。

この文書は、その人物が my-web-2026 の owner としてどの authority を持つか、repository が personal-domain knowledge をどう扱うかを定義する。

## Identity summary

- **Person:** 木村友亮 / Yusuke Kimura
- **Primary public handle:** samuido
- **Stylized / distribution identity:** 361do
- **Development / GitHub identity:** rebuildup
- **Personal domain:** yusuke-kim.com
- **Current context:** 宇部工業高等専門学校 制御情報工学科 在学、2028年3月卒業予定
- **Broad role:** developer / creator
- **Career direction:** frontend / software engineering を軸にした product development

これらの関係、経験、好み、current activities、future direction は [domain.md](domain.md) を参照する。

## Decision authority

最終的な human authority は owner が保持する。agent や contributor は調査・実装・提案を行えるが、次の内容を owner の代わりに発明してはならない。

- **self-narrative authority** — 自己紹介、肩書き、活動の意味付け
- **career / activity fact authority** — 経歴、実績、時系列、公開可否
- **architecture authority** — stack、dependency、obligation boundary
- **visual authority** — visual language、表現方針、ブランド上の判断
- **integration authority** — 外部サービスを personal domain に接続する判断
- **release authority** — release PR merge、tag、GitHub Release 公開

事実の追加と、事実の見せ方の変更は別の判断として扱う。

## Working languages

repository-wide contract:

- source code: English
- commit messages: English
- internal development docs: 日本語
- Issue / PR title and body: 日本語
- review discussion: 日本語
- branch names: identifier または release version。prose を使わない

visitor-facing content の言語は capability ごとに決める。

## Publication model

この repository は public / MIT であり、personal-domain knowledge 自体も public site を構築するための資料として扱う。

ただし「公開可能」と「常に表示すべき」は同義ではない。

- 実名・学校・経歴など public profile として意図された情報は personal domain に保持できる。
- contact、metrics、current status など変化しやすい事実は current source を確認する。
- private credentials、private relationships、site と無関係な sensitive information は含めない。
- old site / social / conversation は evidence だが、古い mutable fact を自動的に current truth にしない。

## Operating mode

my-web-2026 は **owner-operated / single-author を基本** とする。

協力者や agent が参加しても personal narrative の authority は分散しない。一方、implementation responsibility は capability / integration ごとに分離してよい。

人が一人であることと、architecture 上の obligation を一つにまとめることは別である。

## Grounding precedence

owner / personal domain に関する情報は次の順で扱う。

1. owner が current interaction で明示した内容
2. `docs/personal/domain.md` の canonical statement
3. current public site / current repository data
4. dated public portfolio / repository history
5. historical docs / old site
6. inference

6 の inference を public fact として出力してはならない。

unknown は unknown のまま保持し、必要になった時点で authority に戻る。
