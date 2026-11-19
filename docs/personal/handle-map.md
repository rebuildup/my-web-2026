# 名前と handle の対応 — identity legend

> Status: **Preview / Issue #524**
> Visibility: repository-internal の参照文書。表示先は未確定で、route には mount しない。
> Source: Issue #524 本文、docs/personal/domain.md §1、docs/personal/owner.md、src/about/data.ts、src/about/links.ts
> 機械検証: scripts/check-handle-map-preview-parity.test.mjs
> プレビュー: src/personal/handle-map/HandleMap.stories.tsx

samuido / 361do / rebuildup / yusuke-kim.com と用途別の handle が、利用者に「別々のアカウント」「別の人物」と誤認されないようにするための小さな identity legend である。各名前が同じ人物・同じ活動のどの側面を指すかを、公開承認済みの名前だけで説明する。

## 名前と側面の対応

samuido / 361do / rebuildup / yusuke-kim.com と用途別の handle は、すべて同じ一人の人物の異なる側面を指す。別人格・別 organization としては扱わない。

- 名前: 木村友亮 / Yusuke Kimura
- 側面: real-name identity
- 説明: 学校・採用・経歴・対外的な本人確認を含む real-name identity。samuido とは別人格ではない。
- 公開リンク: LinkedIn — https://www.linkedin.com/in/yusuke-kimura-835055398/
- 名前: yusuke-kim.com
- 側面: 個人ドメイン
- 説明: owner.md が挙げる personal domain。my-web-2026 以前の個人 site が使ってきたドメインで、後継 platform は rebuildup.dev を canonical とする。
- 公開リンク: yusuke-kim.com — https://yusuke-kim.com
- 名前: samuido
- 側面: primary public handle
- 説明: 制作・開発・発信を横断する public creator identity で、最も広い活動名。Web 開発・ソフトウェア開発・After Effects 向けツール・映像制作・デザイン・creative coding・記事や実験を一つの名義の下に置く。
- 公開リンク: X (samuido) — https://x.com/samuido
- 公開リンク: Qiita — https://qiita.com/samuido
- 名前: 361do
- 側面: stylized / distribution identity
- 説明: samuido と同じ人物・同じ活動圏を指す stylized / numeric identity。BOOTH など配布・販売面や social handle に現れる。独立したブランド人格や別 organization として扱わない。
- 公開リンク: BOOTH — https://samuido.booth.pm
- 公開リンク: BlueSky — https://bsky.app/profile/361do.bsky.social
- 名前: 361do_sleep
- 側面: 用途別 social handle（技術・開発側）
- 説明: 主に技術・開発側の social handle。
- 公開リンク: X (Tech) — https://x.com/361do_sleep
- 公開リンク: Zenn — https://zenn.dev/361do_sleep
- 公開リンク: YouTube — https://www.youtube.com/@361do_sleep
- 名前: 361do_design
- 側面: 用途別 social handle（映像・デザイン側）
- 説明: 主に映像・デザイン側の social handle。
- 公開リンク: X (Design) — https://x.com/361do_design
- 名前: rebuildup
- 側面: development-facing identity
- 説明: 主に GitHub 上で使う development-facing identity / repository namespace。open-source・個人開発・agent tooling・architecture・release engineering の文脈で強く現れる。visitor-facing な第一表示名として samuido を置き換えない。
- 公開リンク: GitHub — https://github.com/rebuildup
- 公開リンク: AtCoder — https://atcoder.jp/users/rebuildup

## リンクの規則

- この凡例が扱うのは、公開承認済みの名前と handle の対応だけである。
- 各名前は同じ一人の人物の異なる側面を指し、別人格・別 organization として扱わない。
- 公開 URL の記録が無い名前はリンクにしない。名前そのものはテキストとして残す。
- リンク先は src/about/data.ts（/about の externalHandles）・src/about/links.ts（/links の承認済み一覧）・src/about/career.ts（前身 domain の legacy source URL）の記録にある URL だけを使う。
- 表示位置は未確定であり、この preview は route を持たない。英日以外の locale は必要になってから対応する。

## 典拠

- docs/personal/domain.md §1 — 名前と handle の canonical な対応（samuido / 361do / rebuildup / channel-specific handles）。
- docs/personal/owner.md — primary public handle / stylized identity / development identity / personal domain の整理。
- src/about/data.ts — /about が公開する externalHandles と identity.secondary の記述。
- src/about/links.ts — /links が公開する承認済みアカウント一覧（前身 site からの引き継ぎを含む）。
- src/about/career.ts — 前身 domain（yusuke-kim.com）の legacy source URL。
- Issue #524 本文 — 完了条件と Miro 上の根拠（個人 > samuido / 361do_sleep / 361do_design / rebuildup）。

## 実装と機械検証

- 参照文書（正本）: docs/personal/handle-map.md
- preview データ: src/personal/handle-map/HandleMap.preview.ts
- preview component: src/personal/handle-map/HandleMap.tsx
- preview story: src/personal/handle-map/HandleMap.stories.tsx（Storybook の Preview / Handle map）
- 一致検証: scripts/check-handle-map-preview-parity.test.mjs（pnpm run test が scripts/*.test.mjs を discovery する）
- 検証画像: docs/verification/identity/handle-map-story.png（node scripts/capture-handle-map.mjs で再生成）
- 一致が壊れたら fail する。差分は「保留」として文書に明記してから直す。判定を緩めて green にする運用は行わない。

## 未確認（owner 確認待ち）

- Miro board の付箋本文にはアクセスできない。見出し語（個人 > samuido / 361do_sleep / 361do_design / rebuildup）以外の由来・背景は創作しない。
- yusuke-kim.com が現在も公開面として機能しているかは、この凡例では確認していない。/links は前身 site の記録を引き継いだ一覧であり、各 account の現在の公開状態（凍結・移行・閉鎖）は記録時点のもの。
- この凡例をどの公開 surface に置くかは未決。route への mount は owner の判断であり、本 Issue では行わない。
