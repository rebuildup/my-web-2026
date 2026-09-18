# Personal domain

> Status: **Canonical personal-domain grounding**
> Visibility: public (MIT)
> Audience: site implementation, content authoring, contributor, agent, future-self
> Grounded: 2026-09-18

この文書は、my-web-2026 が表現する人物そのものを定義する。

目的はプロフィール文章を一つ固定することではない。Home / About / Portfolio / Activity / Content / Tools など別々の surface が実装されても、すべてが **同じ一人の人物から自然に生えているようにするための共通前提** を置くことである。

architecture 上の owner authority は [owner.md](owner.md)、設計思想は [principles.md](principles.md) に分ける。この文書はその前段にある「誰なのか」「何をしてきたか」「何を好むか」「何を目指しているか」を扱う。

---

## 1. Identity

### Person

- **実名:** 木村友亮
- **英字表記:** Yusuke Kimura
- **主な活動名:** samuido
- **個人ドメイン:** yusuke-kim.com
- **現在:** 宇部工業高等専門学校 制御情報工学科 本科4年に在学
- **卒業予定:** 2028年3月
- **大きな進路方向:** frontend / software engineering を軸にした product development

実名と活動名は別人格ではない。

木村友亮は学校・採用・経歴・対外的な本人確認を含む real-name identity、samuido は制作・開発・発信を横断する public creator identity である。my-web-2026 は両方を同じ人物として扱い、文脈に応じて適切な名前を選ぶ。

### samuido

samuido は最も広い活動名である。

Web 開発、ソフトウェア開発、After Effects 向けツール、映像制作、デザイン、creative coding、記事や実験などを一つの名義の下に置く。

「映像用の名前」「開発用の名前」のどちらかではない。技術と制作を分割せず、両方を含む umbrella identity として扱う。

### 361do

361do は samuido と同じ人物・同じ活動圏を指す stylized / numeric identity である。

BOOTH など配布・販売面や、361do_sleep / 361do_design のような social handle に現れる。独立したブランド人格や別 organization として扱わない。

用途別アカウントが存在しても、その背後の作品・考え・実績は samuido / 木村友亮へ統合できる。

### rebuildup

rebuildup は主に GitHub 上で使う development-facing identity / repository namespace である。

open-source、個人開発、agent tooling、architecture、release engineering など、code と project operation の文脈で強く現れる。

rebuildup も別人ではないが、visitor-facing な第一表示名として samuido を置き換えるものではない。

### Channel-specific handles

現在までの公開 surface では、用途に応じて次の名前が使われてきた。

- samuido — public creator identity
- 361do — stylized identity / distribution brand
- 361do_sleep — 主に技術・開発側の social handle
- 361do_design — 主に映像・デザイン側の social handle
- rebuildup — GitHub / development identity

これらを別々の人物として UI や structured data に生成しない。

---

## 2. One-line model

最も短く表すなら、次の人物である。

> **ソフトウェアを作りながら、映像やデザインも作る developer / creator。興味を持ったものを実際に作り、公開し、使われるところまで持っていく。**

「高専生」は重要な現在地だが、人物の中心カテゴリではない。

「frontend engineer」は将来の職業方向として強いが、現在の活動を Web UI だけに狭めるカテゴリではない。

「映像制作者」「デザイナー」「plugin developer」も同様に、人物全体の facet である。

---

## 3. What connects the different activities

一見すると、Web、After Effects plugin、映像、デザイン、ゲーム、AI agent tooling は別分野に見える。

自分の中では、かなり同じ動機から始まっている。

1. 面白いもの、新しいもの、便利になりそうなものを見つける。
2. 中身がどう動いているかを知りたくなる。
3. 既存のものだけで足りなければ自分で作る。
4. 見た目・操作・技術のどれか一つで終わらせず、使える形まで持っていく。
5. 公開・配布・運用して、実際の反応から次を直す。

そのため「技術」と「クリエイティブ」は別の趣味ではない。

After Effects の表現を深掘りして C++ plugin を作ることも、Web の UI を気にして design system を作ることも、面倒な release 作業から自動化や agent workflow を作ることも、同じ延長線上にある。

---

## 4. Core tendencies

### Curiosity first

新しい技術や表現を試すこと自体がかなり強い動機になっている。

新しい Web framework、AI tooling、agent、programming language、graphics、映像表現など、まだ自分の専門になっていないものでも「面白そう」であれば触る。

ただし、新しいという理由だけで採用し続けるわけではない。試した後は、自分の project にとって実際に価値があるかを評価したい。

### Build to understand

読むだけ・調べるだけより、実際に作ることで理解する傾向が強い。

新しい技術を知ったときも、sample を眺めるより、tool、plugin、site、small product、experiment の形にして境界や失敗点を確かめる。

そのため personal site でも「知っている技術一覧」より、何を作り、どこまで動かし、どんな制約にぶつかったかを重視する。

### Do not self-limit with labels

自分を一つのラベルに固定して、そのラベルを「できない理由」に使うことを好まない。

現在得意なものと、将来できるものは別である。未経験であることは境界ではなく、必要なら調べて作る対象として扱う。

このため site 上でも、skill level badge や固定的な「○○系エンジニア」という分類で可能性を狭めすぎない。

### Product, not only implementation

コードが書けたこと自体より、誰かが使える状態まで持っていくことに価値を置く。

UI、distribution、documentation、versioning、release、feedback、maintenance まで含めて product と考える。

Aulymo の販売、After Effects plugin の配布、学校イベントの Web site、個人サービス開発などは、この傾向の代表例である。

### Quality should be operational

品質は「丁寧に作ったつもり」ではなく、test、CI、review、release gate、architecture boundary など再現可能な仕組みに落としたい。

問題を見つけた場合、遠慮して曖昧にするより、Issue や review として早めに表面化させる方を好む。

### Experiment, then refine

最初から完璧な体系を作るより、まず動く slice を作って観測し、その後で構造を改善する。

一方で、一度 production / release の責任を持ったものは、prototype の気分のまま放置したくない。

---

## 5. Technical interests

現在の中心は Web / software engineering だが、技術選択は用途で広く変わる。

### Strong / frequently used

- JavaScript / TypeScript
- React / frontend development
- Web platform / browser APIs
- Git / GitHub based development
- After Effects scripting / plugin development
- C / C++ for lower-level implementation
- design-system / UI implementation
- AI-assisted development and agent workflows

### Expanding interests

- Rust
- backend / systems architecture
- low-level behavior and performance
- formal / mechanical verification
- agent environment / evaluation
- real-time graphics / creative coding
- cross-platform application development

「frontend だから backend は扱わない」「creator だから systems は不要」という分け方はしない。

必要な product を成立させるために layer を下りたり、別 stack に移ったりすることを自然なものとして扱う。

---

## 6. Creative interests

### Motion / video

After Effects を中心に、文字 PV、lyric motion、MV、short video、animation を継続的に作ってきた。

映像制作から scripting、expression、automation、plugin development へ関心が広がった経緯があり、**表現を作る側と道具を作る側を行き来する**ことが大きな特徴になっている。

### Graphic / UI design

Illustrator、Figma を含む graphic / UI design に関心がある。

デザインを「装飾」だけではなく、情報の優先順位、操作性、伝わり方、product の目的を解く手段として扱う。

### Creative coding

p5.js / WebGL / game / interactive expression など、code 自体を表現手段として使うことにも関心がある。

software と visual expression の境界にあるものは、特に自然な活動領域である。

---

## 7. Taste that should influence the site

ここでいう「好み」は、好きな色の一覧ではなく、site の判断に再利用できる傾向を指す。

### New over familiar, but not novelty for novelty's sake

既に完成された定番だけを繰り返すより、新しい技術や表現を取り込みたい。

ただし「最新技術 showcase」にするのではなく、試した結果として適切なら残す。

### Avoid generic convergence

どこかで見た SaaS landing page、テンプレート的な portfolio、AI が平均化して生成したような UI に収束することを避けたい。

奇抜さそのものを目的にはしないが、その project / content / person である理由が見える visual decision を好む。

### Restrained base, deliberate accents

情報設計の土台は落ち着いていてよい。

clear hierarchy、余白、タイポグラフィ、整った alignment を基礎にし、必要なところだけ色、motion、graphic、interaction を強く使う。

my-web-2026 の current visual direction である calm / technical / restrained、neutral-cool な base と blue accent は、この傾向と整合する。

### Motion is a language, not decoration

映像を作る人間として motion への関心は強いが、Web の全要素を動かす必要はない。

意味のある state change、attention、rhythm、character を与えるところで使う。読ませる文章や重要な情報を motion で邪魔しない。

### Factual copy with a little personality

過度に格好つけた自己紹介、企業 brochure のような抽象語、長い philosophy poem は避ける。

事実を中心に、本人の言い回しや少しのユーモアが見える文章を好む。

「すごい人に見せる」より、「何を考え、何を作ってきた人なのか」が伝わる方を優先する。

---

## 8. Experience

この section は全履歴ではなく、現在の人物像を作った経験を並べる。

### Early programming / competition experience

- 2022: U-16 プログラミングコンテスト山口大会 アイデア賞
- 2023: U-16 プログラミングコンテスト山口大会 技術賞・企業賞
- 2023: 宇部工業高等専門学校 制御情報工学科へ入学
- 2024: 中国地区高専コンピュータフェスティバル ゲーム部門 1位
- 全国高等専門学校プログラミングコンテスト本戦への複数年の出場経験

競技だけを続ける方向にはならず、ここから Web、product development、creative tooling へ活動範囲が広がった。

資格として Webデザイン技能検定3級を取得している。

### Video / motion experience

2023 年末ごろから After Effects を使った映像制作を継続している。

個人練習だけでなく、MV、short video、学校・部活動向け映像など実際の用途を持つ制作を経験してきた。

制作を続ける中で「手作業を減らしたい」「既存 effect では足りない」という問題が、script / plugin development へつながった。

### Tool / plugin development

代表例:

- **Aulymo** — After Effects で lyric motion を作るための tool。配布・販売を通じ、実装だけでなく productization / support / update を経験。
- **MultiSlicer** — C++ / After Effects SDK を使った effect plugin。公開・配布を通して native plugin development を実践。
- その他、After Effects 向け effect / utility / script を継続的に制作。

Aulymo は 2026 年初頭までの公開プロフィール上で累計 500 本以上の販売実績があり、MultiSlicer も数千 download 規模まで利用された実績がある。

数値は時間で変わるため、site の live metric として使う場合は別途 source を確認する。

### Web / real-user experience

個人 site を複数世代にわたって自作してきた。

my-web-2025 は portfolio、workshop、Tools、About 等を一つの site に統合する実験になり、my-web-2026 ではその経験を踏まえて personal information / capability / integration を長期的に扱える platform へ再設計している。

学校イベントの Web site 制作では、実際の来場者・学生が使う環境で公開する経験を持つ。宇部高専祭 2025 site は公開実績として 1,700 人以上の利用規模を経験した。

### Team / community / operation

個人制作だけでなく、学校・部活動・community・複数 repository の中で制作や開発を行ってきた。

コンピュータ部での活動・運営経験、共同 project、release management、review、CI、issue management など、「一人でコードを書く」以外の software delivery も継続的に経験している。

### Professional exposure

2026 年夏には ScienceArts と OPTiM で software / product development に関する internship を経験した。

学校外の開発環境に触れたことで、個人開発で得た速度や幅だけでなく、team で読める code、仕様、review、運用として成立させることへの関心がさらに強くなっている。

---

## 9. What I am doing now

2026-09 時点では、次の活動が同時進行している。

### Study

宇部高専 制御情報工学科で、software / control / information engineering の基礎を学んでいる。

授業だけを skill source にせず、必要になった技術を個人 project で先に使うことが多い。

### Web / software

- my-web-2026: personal Web Platform の再構築
- Web application / frontend architecture
- Rust を含む新しい implementation stack の試行
- test / CI / release / architecture の仕組み化
- AI coding agent / agent workflow の実験と実運用

### Creative tooling

After Effects 向け script / plugin を継続的に開発している。

C++ / SDK の低レイヤから UI / distribution まで、制作 workflow を改善する software を作る領域は今後も重要な柱にする。

### Product / project development

Web だけでなく、mobile / desktop / backend を含む product project に取り組んでいる。

「一つの技術を極めるための project」より、実際に必要な product を成立させるために複数の技術をつなぐ project を好む。

### Video / design

software に軸足が移っても、映像・デザインをやめる予定はない。

依頼制作、個人制作、motion study、graphic / UI work は、技術とは別枠の過去の趣味ではなく現在も続く activity である。

---

## 10. Future direction

### 2028

2028 年 3 月に高専を卒業し、software engineer / frontend engineer を主軸として就職する方向で考えている。

特に、単に画面を実装するだけではなく、UX、architecture、data flow、quality、delivery まで product 全体に関われる engineering を志向する。

### Engineering breadth

frontend は入口として強いが、長期的に frontend だけに閉じるつもりはない。

必要に応じて backend、native、systems、performance、tooling へ降りられる software engineer になりたい。

### Creative software

After Effects tooling の経験を含め、creator が使う software / creative tool は将来も重要な関心領域である。

engineering と design / motion の両方が分かることを、別々の career として分断せず強みにしたい。

### Build and ship continuously

就職後も、個人 project、open-source、tool distribution、product creation を続ける。

会社での仕事だけが activity の全てになる model ではなく、学習・制作・公開を継続している状態を保ちたい。

### AI as leverage

AI を「自分ができないことの代替」ではなく、調査、実装、検証、運用の速度と範囲を拡張する tool として使う。

agent を使うほど、人間側には requirement、architecture、review、taste、decision の質がより必要になると考えている。

---

## 11. Narrative invariants for my-web-2026

site の feature や copy が増えても、次を壊さない。

### 1. samuido / 木村友亮 / 361do / rebuildup are one person

channel によって handle が違っても別人格化しない。

### 2. Student is a current state, not the whole identity

「高専生だからすごい」という framing に依存しない。

在学中であることは重要な context だが、作品や engineering decision はそれ自体の内容で見せる。

### 3. Engineering and creative work are not separate biographies

Develop / Video / Design に UI を分けることはあっても、「engineer と creator が別人格」のようには表現しない。

tool development が映像制作から生まれ、design experience が UI に戻るような相互関係を見せる。

### 4. Show shipped work, not only declared skills

skill list より project / artifact / release / user impact を優先する。

使った技術名は evidence を説明する metadata であって、それ自体を主役にしない。

### 5. Experiments and unfinished learning are part of the person

完成品だけを並べて過度に整った career story を作らない。

新しいものを試し、失敗し、直している activity も samuido の continuity の一部である。

### 6. Do not inflate

売上、download、award、user count などは強い evidence だが、古い数値を current value のように見せない。

肩書きも実態以上に盛らない。

### 7. Future direction is a direction, not a promise

「frontend / software engineer を志向」「creative software を続けたい」は現在の direction であり、未来の選択肢を拘束する immutable profile ではない。

---

## 12. Implications for site design and content

### Home

最初の数秒で、少なくとも次が分かること。

- 誰か: 木村友亮 / samuido
- 何者か: developer / creator
- 何を扱うか: software / Web / creative tools / video / design
- 現在何をしているか
- どこへ進めば作品・活動・文章を見られるか

my-web-2026 という repository / platform 名だけを hero の主人公にしない。platform は samuido を表現・運用する infrastructure であり、visitor にとっての主語は人である。

### About

履歴書の文章版だけにしない。

Identity → interests → experience → current → future という流れで、「なぜこのバラバラに見える活動を同じ人がやっているのか」が分かる内容にする。

### Portfolio

Develop / Video / Design は navigation facet として使えるが、完全に独立した人物像へ分断しない。

cross-disciplinary な作品は複数 facet にまたがってよい。

### Activity

activity は GitHub commit 数だけではない。

release、plugin update、映像公開、記事、experiment、event work など、現在何に時間を使っているかが見える timeline を目指す。

### Content

記事は「専門家として教えるもの」だけでなく、調査、experiment、失敗、比較、設計判断を残せる。

新しいものを触って理解していく過程が personal domain と相性がよい。

### Visual language

base は calm / technical / restrained に置きつつ、作品や experiment の surface では visual language を変えてよい。

すべてを一つの corporate design system に均すより、同一人物の複数の活動が共存できる構造を優先する。

### Writing voice

- factual
- direct
- calm
- 少しだけ本人らしいユーモアを残す
- 過剰に謙遜しない
- 過剰に自己評価しない
- philosophy だけで実体を隠さない
- 「AI が書いた整った自己紹介」に収束させない

---

## 13. Freshness model

personal domain の全情報を同じ寿命として扱わない。

| Information | Stability | Rule |
| --- | --- | --- |
| real name / handle relationship | high | canonical。明示変更時のみ更新 |
| broad identity: developer / creator | high | 長期的 narrative |
| school / graduation target | medium | 年度・status 変化時に更新 |
| current interests / focus | medium | 半年程度で見直す |
| current projects | low | activity / project source から更新 |
| project metrics | low | date + source を伴わせる |
| skills / tools | low-medium | static ranking より activity から導く |
| contact channels | low | channel availability を source of truth にする |
| future career direction | medium | intention。事実として固定しない |
| visual / writing preference | medium-high | explicit change がない限り design grounding として使う |

---

## 14. What must not be inferred

この文書にないことを「それっぽい人物像」のために追加しない。

特に次は、public content 生成時に勝手に確定しない。

- 性格診断や personality label
- skill の数値レベル
- 現在の売上 / download / follower 数
- employment offer / joining company など未確定の進路
- private relationships / family information
- political / religious / medical 等、site domain に不要な personal information
- 過去 site に書いてあったという理由だけの current fact

必要になった時点で owner authority または current public source に戻る。
