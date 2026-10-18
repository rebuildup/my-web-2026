# フォーム入力のラベル・説明・エラー関連付けの検証 — 正常 / 空欄 / 形式違反 / 失敗 / 縮小表示 (#404)

- 対象: `src/editorial/forms/**`（フォームフィールド契約 + component）と、その利用側 4 フォーム
- Issue: #404（`feat(a11y): フォーム入力エラーをラベル・説明へ関連付ける`）
- 成果物: `docs/verification/a11y/form-error-story.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §7 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/editorial/forms/form-errors.stories.tsx` の `Editorial/Forms` → `Gallery`（shipped story を harness が直接 import して描画） |
| capture 手段 | `pnpm run capture:a11y:form-errors`（`node scripts/capture-a11y-form-errors.mjs`。`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 2461 px、**88 kB** WebP（quality 80、budget 300 kB） |
| Node / OS | v26.x / darwin arm64 |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

Issue は `.png` 経路を指定しているが、Playwright は WebP を書けず、検証 artefact のために
-tree に恒久的な大容量バイナリを置くのは妥当でないため（他 artefact と同じ方針）**`.webp`**
を commit した。`scripts/capture-a11y-form-errors.mjs` は `.webp` 以外の出力先を拒否し、
中間 PNG は削除する。

この画像は**実表示**の記録である。§4 の機械検査（markup / 属性）と §5 の人間の評価（実際に
支援Chlorium で読み上げた結果と文言の判断）は別のレイヤであり、どちらか片方だけで
「満たしている」と主张してはいない。

## 2. 画面が示している状態（5 つ）

画像の上から 5 段が、そのまま本 Issue が対象にする state に対応する。

| state | 表示しているもの | 根拠となる WCAG 2.2 |
| --- | --- | --- |
| 正常 | label・説明・`autoComplete` を持つ 2 フィールド。エラー state ではない (`aria-invalid` を書かない) | 1.3.1 / 3.3.2 |
| 空欄 | required ラベル。「必須」マーカーは `aria-hidden` なので支援技術には「Email」と一度だけ読まれ、要件は control 側の `required` から伝わる | 3.3.2 |
| 形式違反 | `aria-invalid="true"` + `aria-describedby` が `image-description image-error` を指す。エラー文言は control 直下にテキストで出る | 3.3.1 / 4.1.3 |
| 失敗 | フォーム冒頭の `role="alert"` 要約（項目ごとに control へのリンク付き）+ 各 field の同じ文言。要約だけが live region | 3.3.1 + 4.1.3 |
| 縮小表示 | 狭幅な行レイアウト（2 列 grid + ボタン）。狭幅でも文言が切れていない | 1.4.4 / 1.4.10 |

「形式違反」「失敗」の 2 段は、**同じ文言を 2 か所に出しても live region は 1 つだけ**という
設計の絵である。field 側は `aria-describedby` で参照されるだけなので、submit した瞬間に同じ
文が二重に読み上げられることはない。

## 3. 適用したフォーム（4 つ）

`/contact` には送信フォームが存在しない（Decision §「/contact」: フォーム送信なし / バックエンド
エンドポイントなし）ため、公開・非公開を問わず**代表的な admin フォーム 4 つ**を対象にした。

| フォーム | 直前の欠陥 | 適用後 |
| --- | --- | --- |
| `/admin/login` | 説明なし、`autoComplete` なし、refused `?returnTo=` は無地の `<output>` | `TextField` x2（`username` / `current-password`）、refusal は form-level 要約 |
| `/admin/invitations`（作成） | **label が無く placeholder のみ**、サーバー refusal は form 外の無地 `<p>` | `TextField`（`email`）+ 要約。`email_already_registered` は field  refined、それ以外は form  refined |
| `/admin/invitations/accept` | refusal が form 末尾の無地 `<p>`。どの control が悪いか不明 | 要約 + `weak_password` のみ password control に `aria-invalid` |
| `/admin/images`（upload） | `role="alert"` が field error と二重、label はあったが説明なし | `FileField` + 要約（client 3 gate と server policy code を全て field refined に集約） |

いずれも既存の**文言は変更していない**（`describeUploadFailure` / `FAILURE_COPY` / 分類器が
返す message）。変更したのは「その文言をどう関連付けるか」だけである。

## 4. 機械検査（人手レビューなしで再現する部分）

| 検査 | 場所 | 内容 |
| --- | --- | --- |
| 契約の純関数 | `src/editorial/forms/contract.test.tsx` | id 派生、空文字 message の扱い、`aria-describedby` の順序、`aria-invalid` の出し分け |
| SSR markup | `src/editorial/forms/forms.test.tsx` | `react-dom/server` の出力に「宣言された id だけ」を参照する `<label for>` / `aria-describedby` が書かれているか、`role="alert"` が 1 つだけか |
| 招待受諾フォーム | `src/admin/invitations/accept-view.client.test.tsx` | 実 DOM 上で submit → 要約・`aria-invalid`・再提出時に reflace が消えること、refusal でない field が invalid にならないこと |
| 画像アップロード | `src/admin/images/images.client.test.tsx` | 実 DOM + 実 File で空・size・形式・server policy code の 4 refusal、および成功時に state が解除されること |
| capture harness | `scripts/capture-a11y-form-errors.test.mjs` | WebP 拒否・サイズ budget・story を直接 import すること・静的配信の traversal 拒否 |
| 静的解析 | `pnpm run lint:check`（Biome `a11y/*` ルール） | label / role に関する機械が決められる違反 |

検証用に実 Chromium で採取した値（`Gallery` の 4 段目、1440px）:

```text
- alert "招待を作成できませんでした":
  - heading "招待を作成できませんでした" [level=3]
  - list:
    - listitem: link "Email" → /url: "#email"  / text: ": この email は既に登録されています。"
    - listitem: link "Password" → /url: "#password" / text: ": パスワードが短すぎます (8 文字以上)。"
    - listitem: "招待の作成: 作成に失敗しました。"
- text: Email
- paragraph: 招待するアカウントのメールアドレス。
- textbox [invalid]
- paragraph: この email は既に登録されています。
```

- 読み上げられる label は `Email` であり `Email必須` ではない（「必須」マーカーは `aria-hidden`）。
- invalid な control だけが `[invalid]` として出る。
- 360px 幅でも `document.scrollWidth - innerWidth = 0`、overflow による切り詰め要素 0 個。

## 5. 人間の評価が必要な部分（機械では判定できない）

| 論点 | 現状の判断 | 未実施 |
| --- | --- | --- |
| 文言が「なぜ拒否されたか」を日本語で伝わるか | 既存文言を再利用し、field 要約と summary で重複提示している | 実際のスクリーンリーダー利用者による読み上げ検証（NVDA / VoiceOver / Orca） |
| 実ブラウザの constraint validation（required 空欄） | `noValidate` を付けておらず、ブラウザ標準の検証はそのまま残した | 実ブラウザでの空欄 submit 挙動の確認（Playwright の `input.checkValidity` 相当） |
| 色だけに依存していないか（1.4.1） | error は文字マーカー + 太字 + 太い border + 文言の 4 経路で表現 | グレースケール表示・高コントラスト環境での目視確認 |
| 要約へフォーカスを移すべきか | `role="alert"` で 1 回だけ読み上げ、要約内 link は tab 到達可能、という設計にした（focus を動かさない） | 実利用者が「Tab で要約に到達する」体験として十分か |
| 縮小表示の実機挙動 | 360px / 1440px の 2 点で overflow 0 を確認 | 200% ズーム・`prefers-reduced-motion` 併用時の目視 |

## 6. 適用していないフォームと理由

| フォーム | 状態 |
| --- | --- |
| `/admin/emoji-catalog`（新規 entry） | label と `role="alert"` は既にあり、`pattern` / `maxLength` も宣言済み。本 Issue の story が示す「縮小表示」行レイアウトの参考にしたが、contract への置換は別 Issue に分けた（ Stories 側で同じレイアウトを先に検証している） |
| `/admin/keys` の step-up パネル | 同上（label・`autoComplete="current-password"`・`role="alert"` は既にある） |
| `/home` のリアクション composer | 公開面だが入力が「種別を選ぶ」操作で、label ではなく `aria-label`（1.3.1 は満たす）。本 Issue の対象範囲（Contact / Admin の代表フォーム）の外 |
| `/contact` | フォームが存在しない |

## 7. 未決事項 / 制約

1. **サインイン失敗の UI は本 Issue の対象外**。`/admin/login` は素の HTML form が
   `POST /api/v1/auth/sign-in/email` へ飛ぶ設計で、認証失敗は Better Auth が 401 JSON を
   返す。そのため「認証失敗」の field error をこのページ側に持つ手段が無く、本 Issue は
   ページ側で**新しいエラー文言を作らない**判断をした（credential の失敗表示を一元化する
   には auth 境界側の設計変更が必要）。
2. **summary へのフォーカス移動は行っていない**。判断根拠は §5。未確定なら owner 決定。
3. **`form.reset()` による file input のクリアは実ブラウザでのみ確認**。happy-dom が reset
   アルゴリズムを実装していないため、`images.client.test.tsx` では assert していない。
4. Storybook 自体の static build は manager のみ（Issue #501 と同一の制約）のため、capture は
   `.tmp/` の harness 経由。`build-storybook` 自体は `validate:integration` で走る。
5. `/admin/images` の成功パスに **既存の latent bug を 1 件修正**した: submit handler が
   `await` の後に `e.currentTarget` を読んでいたため（React は dispatch 後に
   `currentTarget` を null にする）、アップロード成功時に必ず例外になり「アップロードに
   失敗しました。」が出ていた。form 要素を `await` 前に捕捉する形に変更。