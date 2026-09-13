---
name: navigation-design
description: >
  Design navigation for websites and applications by choosing the right navigation model for the information structure,
  preserving orientation and context, and verifying the delivered interaction across responsive and accessible states.
---

# Navigation Design

Navigation は menu component を並べる作業ではない。

**Inspect → Extract → Translate → Implement → Verify** を順に実行し、まず navigation 自体が必要か、次に「何の空間を移動する navigation か」を決める。

目的は link 数を増やすことではなく、ユーザーが **今どこにいて、どこへ移動でき、移動後もどの文脈にいるか** を理解できる状態を作ること。

Last reviewed: 2026-09-12

## When to use

以下を設計・再設計するときに使う。

- website / service / product の global・service-level navigation
- sidebar / section navigation
- hierarchical navigation / breadcrumbs
- parent-detail navigation
- in-page navigation / table of contents
- URL を切り替える tab-like navigation
- collection pagination / previous-next movement
- responsive 時の navigation transformation

線形な transaction / wizard / form flow に persistent navigation を足すためには使わない。まず end-to-end journey を簡潔にし、navigation が不要なら追加しない。

## Boundary

- `layout-system` は page surface の spatial composition を担当する。ここでは **information space 間の移動と orientation** を扱う。
- `responsive-design` は一般的な adaptation policy を担当する。ここでは **navigation の wording / order / destination / current-state / reachability を変形後も保つ判断** を扱う。
- `accessibility-audit` は broad accessibility retest を担当する。ここでは navigation-specific な landmark、current location、focus order、skip path を設計する。
- `motion-system` は route / panel transition の motion を担当する。navigation structure は animation がなくても理解できなければならない。
- router API、framework-specific link component、SEO sitemap generation は source of truth にしない。

## Workflow

1. current information architecture と user journey を Inspect する。
2. [`references/navigation.md`](./references/navigation.md) から task に近い primary references を実際に開く。
3. 下の observation axes で複数 reference を比較する。
4. repeated relationship と trade-off を Extract する。
5. navigation model を選び、current product の hierarchy / task / vocabulary へ Translate する。
6. current design system の component / token を優先して Implement する。
7. rendered UI と実 interaction を Verify する。

## Observe

reference を開いたら、見た目より先に次を見る。

### Information scope

- navigation が global / product / service / section / page 内のどの scope を動かすか
- navigation item が「最重要 top-level destination」なのか単なる sitemap の列挙なのか
- primary と secondary navigation の責務が混ざっていないか
- user が繰り返し section を切り替える必要があるか

### Orientation

- current page / current section を何で示しているか
- parent context を残しているか
- title / breadcrumb / side navigation / selected state が互いに矛盾していないか
- deep link から直接入っても現在地を理解できるか

### Movement model

- URL / route が変わる navigation か
- 同じ URL / context 内で panel visibility だけを切り替える interaction か
- hierarchy を上へ戻るのか
- linear progress を次へ進むのか
- long page の anchor へ移動するのか
- collection の前後 / page 間を移動するのか

意味が違うものを「全部 tabs」「全部 breadcrumbs」にしない。

### Hierarchy and depth

- breadcrumb が hierarchy を示しているか、履歴や progress の代用になっていないか
- side navigation の depth が読み取れるか
- nested navigation が深くなりすぎて current path の把握を妨げていないか
- hierarchy を navigation chrome だけで説明せず page heading / section heading でも補強しているか

### Responsive transformation

- compact state でも item の wording / relative order / destination が変わっていないか
- collapsed navigation に移しても current-state が見えるか
- hidden item へ keyboard / touch で到達できるか
- wide header → side panel / disclosure への変形が information scope を変えていないか

### Interaction and semantics

- repeated navigation regions を識別できる label があるか
- current page / current item が semantic に示されているか
- visual order と keyboard focus order が一致しているか
- dense repeated navigation を飛ばせる skip path があるか
- ordinary site navigation を application menu interaction に過剰変換していないか

## Decision rules

### 1. Decide whether persistent navigation is necessary

persistent navigation を足す前に、journey を分類する。

- repeated use / multiple independent tasks / non-linear movement が中心 → persistent navigation を検討する
- clear end-to-end transaction / wizard / question flow → persistent navigation を避け、continue / back / task progress を使う

navigation は「ある方が便利そう」ではなく、ユーザーが複数 destination を自分で選ぶ必要があるときに置く。

### 2. Assign one scope to each navigation region

1つの navigation region に global utility、service section、page-local anchor を無秩序に混ぜない。

より general な scope から specific な scope へ階層化し、各 region が「どこを移動させるか」を説明できる状態にする。

### 3. Keep navigation selective

primary navigation を sitemap にしない。

トップレベルには product / service を理解するための重要 destination を置き、rare / contextual destination は secondary location、body link、search 等へ逃がす。

### 4. Use breadcrumbs only for hierarchy

breadcrumb は現在ページの ancestor relationship を示す secondary navigation として使う。

以下には使わない。

- multi-step form の progress
- browser history
- flat hierarchy
- primary navigation の代替

current page を含めるかどうかは design system と page title の明瞭さに合わせるが、ancestor path と current location の意味を壊さない。

### 5. Separate linked navigation from tab panels

見た目が horizontal tabs でも interaction model を先に決める。

- activation で URL / route が変わり、別 view として deep link できる → navigation link model
- current context のまま panel visibility だけを切り替える → tab / panel interaction model

見た目を揃えるために semantics を混同しない。

### 6. Use side navigation for repeated section switching

section / parent-detail 間を頻繁に切り替える task では persistent side navigation が有効になりうる。

ただし deep nested tree を無制限に増やさない。hierarchy が深い場合は page-level navigation、breadcrumbs、tabs、search、information architecture 自体の再編を比較する。

### 7. Preserve navigation meaning across breakpoints

responsive adaptation で presentation は変えてよいが、同じ navigation item について原則として以下を維持する。

- wording
- relative order
- destination
- current-state meaning
- keyboard / touch reachability

mobile だけ別 taxonomy にしない。項目を省く場合は task priority と alternative path を確認する。

### 8. Place navigation near the context it affects

- global / product navigation → persistent shell に近い場所
- section / parent-detail navigation → affected detail content に近い場所
- in-page navigation → long-form content の section structure に近い場所
- pagination → 対象 collection の直後

visual placement と information scope を一致させる。

## Avoid

- clear linear journey に hamburger / sidebar を足す
- primary navigation に全ページを列挙する
- breadcrumb を progress indicator として使う
- browser Back と hierarchy-up navigation を同一視する
- URL が変わる navigation と tab panel を見た目だけで同じ semantics にする
- narrow viewport だけ wording / item order / destination を変える
- current state を色だけで示す
- navigation landmark を過剰に増やして region 構造をノイズ化する
- nested navigation を深くし続け、information architecture の問題を component で隠す
- component library の menu / tabs API から navigation model を逆算する

## Verify

実装後は source / component tree だけで完了しない。

### Orientation

- top-level page、deep nested page、external/deep-link entry を開く
- page title、current navigation state、parent context が一致することを確認する
- breadcrumb / sidebar / header が互いに別の「現在地」を示していないか確認する

### Movement

- primary / secondary / breadcrumb / in-page / pagination の各 link を実際に操作する
- URL-changing navigation は expected route / history behavior を持つか確認する
- same-context panel は不要な route change を発生させていないか確認する

### Responsive

- narrow → medium → wide を連続 resize する
- collapsed / disclosed state を実際に開閉する
- wording / order / destination / current-state が presentation change で壊れていないか確認する
- zoom / long labels / localization 相当の長い文字列で clipping と unreachable item を確認する

### Keyboard and structure

- keyboard だけですべての navigation destination に到達する
- focus order が visual order と一致する
- repeated navigation を skip して main content へ移れる
- multiple navigation regions が識別可能か確認する
- current page / current item が visual cue 以外でも判断できることを確認する

### Completion gate

次を説明できるまで完了扱いにしない。

- なぜこの画面に persistent navigation が必要か
- 各 navigation region がどの information scope を担当するか
- ユーザーが現在地をどう判断するか
- hierarchy movement と linear progress をどう分離したか
- responsive transformation 後も navigation meaning がどう保持されるか
- keyboard / deep link / long-content / narrow viewport で実 interaction を確認したか
