# 音楽からの接続点 — 表示プレビューの検証画像 (#525)

- 対象: `docs/influences/music-connections.md`（参照文書の正本）と `src/personal/music-connections/`（preview データ + Storybook story）
- Issue: #525（`docs(influences): 好きなもの > 音楽 クラスタの参照文書`）
- 成果物: `docs/verification/influences/music-connections-preview.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §7 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/music-connections/MusicConnections.stories.tsx` の `Default` story（story 自身の `render()` 出力） |
| capture 手段 | `node scripts/capture-music-connections.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 3636 px、**258 kB** WebP（quality 80、budget 300 kB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ `storybook dev` ではなく harness なのか

`storybook dev` はこのリポジトリの story を配信できない。`.storybook/main.ts` はプロジェクトの `vite.config.ts` を merge し、その中の `@cloudflare/vite-plugin` が dev server を接管してから Worker の runtime secret を要求して起動に失敗する（実測: `Missing required secrets for Worker "my-web-2026"`）。同じ理由を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-a11y-table-code.mjs`（#407）が記録している。

そのため capture は `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、story 自身の `render()` が出力するものをレンダリングする。harness が描くものは「Copied した preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

### なぜ画像は文書の一部だけ인가

この文書は標準幅で **8039 px** の高さになる。WebP / quality 80 で 300 kB の budget に収まらないため、budget 内に収まる **最長の接頭辞**（切り口は必ず section の下端。section の途中では切らない）を採用した。commit した画像はヘッダー（表題 + メタ情報）と §1〜§4 を写した 3636 px である。

- 採用手順: 描画された section の下端を候補として、whole document から順に「budget 内に収まる最初の候補」を選ぶ。
- 断言は**常に文書全体**を対象にする（§3）。画像は一部でよいが、検証は文書全体で FAIL する。
- budget を上げることはしない。 DPI を上げることもしない（device scale factor は 1）。

## 2. 画面が示しているもの

画像は音楽からの接続点 preview の先頭部分を全ページ撮影したものである。

1. **document title** — `音楽からの接続点 — 楽曲・制作文化・映像表現・ソフトウェア制作の参照文書`。
2. **文書メタ情報 4 点** — status / 典拠 / 機械検証 / プレビューの path。
3. **§1「1. 目的とこの文書が解く問題」** — 目的と解かないこと。
4. **§2「2. 典拠と到達範囲」** — 書くもの / 代わりに使う典拠 / 未確認の扱い。
5. **§3「3. 4 種の区別（音楽 / 制作文化 / アーティスト / 映像作品）」** — 4 種それぞれの判別・記録する・記録しない・他の種との境界。
6. **§4「4. 4 つの接点軸（楽曲 / 制作文化 / 映像表現 / ソフトウェア制作）」** — 接点軸ごとの意味・記録できる接点・記録できない接点。

§5〜§9（禁止事項 / 分離 / 採用例 / 実装 / 未確認）は budget の外にあるが、§3 の断言により **描画されていることは検証済み** である。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が FAIL する条件は以下（描画から読み取った値が preview データと一致しない場合、non-zero exit）。

| 項目 | 判定 | 実測 |
| --- | --- | --- |
| document title | 描画された `<h1>` が `MUSIC_CONNECTIONS.document.title` と一致 | 1 件一致 |
| 文書メタ情報 | status / source / verification / preview の 4 点が `<header>` の `<ul>` に存在 | 4 件一致 |
| section 集合と順序 | 描画された `<h2>` の集合と順序が `sections[].heading` と一致 | 9 件一致 |
| sub-heading 集合と順序 | 描画された `<h3>` の集合と順序が `blocks[].heading`（null の block を除く）と一致 | 27 件一致 |
| section lead | 各 section の `<header><p>` が `sections[].lead` と一致 | 9 件一致 |
| 箇条書き | 描画された `<section> li` が `blocks[].bullets` と 1 文字ずつ一致 | 106 件一致 |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow）。撮影幅 1440 で横スクロールは出ない | 1440 <= 1440 |
| artefact budget | commit した WebP が 300 kB 以下 | 258 kB |

箇条書きの比較だけ **空白を除いた形** で突き合わせる。`種：` / `例：` / `典拠：` / `断定しないこと：` のラベルは別要素として描画されるため、描画結果にはデータ側にはない区切りの空白が 1 個入る。空白の位置の差で正しい preview を FAIL させないため、両側の空白を除去して比較する（空白以外の文字は 1 文字ずつ一致해야する）。

capture が FAIL した場合、終了コードは non-zero であり、artefact は書かれない（検証に失敗した画像を commit しないため）。

## 4. 本文との一致（parity gate）

本文 `docs/influences/music-connections.md` と preview データ `src/personal/music-connections/MusicConnections.preview.ts` の一致は `scripts/check-music-connections-preview-parity.test.mjs` が検証する。

- `##` 見出しの集合と順序が一致する。
- `###` 見出しの集合と順序が一致する。
- 箇条書きの項目と段落が一致する。
- 片側にしか存在しない見出しや例があれば FAIL する。
- §3 の 4 種（音楽 / 制作文化 / アーティスト / 映像作品）と §4 の 4 つの接点軸（楽曲 / 制作文化 / 映像表現 / ソフトウェア制作）が、本文側にも preview 側にもそれぞれ 1 つずつ存在する。
- §5 の禁止事項に該当する語（因果の断定・第三者の私生活・創作された数値）は、禁止節の中か、その語を禁じている文脈（禁止節そのもの、または「記録しない」「書かない」などの禁止表現を伴った文 / 小見出し）の中にしか現れない。
- preview が引用する file path が repository に実在する。

本 capture は parity gate の別系統である。parity gate は「本文と preview データの一致」を、capture は「preview データと **描画された DOM** の一致」を見る。片方だけ緑になりうるのは正因为の異なる二つの門だから。

## 5. 再現手順

```bash
# 検証画像（.webp）を再生成する
node scripts/capture-music-connections.mjs
# → docs/verification/influences/music-connections-preview.webp
# → .tmp/music-connections/report.json（観測値と判定）

# harness だけをビルドして artefact を出さない（browser を起動しない）
node scripts/capture-music-connections.mjs --no-capture

# 幅・高さ・切り口を指定する
node scripts/capture-music-connections.mjs --width=1440 --height=900 --clip-height=3636
```

capture script は `package.json` に登録していない（並列 PR の conflict を避けるため。`pnpm run` ではなく `node scripts/...` で実行する）。WebP 以外の出力先は拒否され、repository の外への出力も拒否される。

## 6. 機械で検証していない項目（人手での判断）

- 表題・見出し・箇条書きの**文言が読みやすいか**（mechanically には「preview データと描画結果の一致」しか確認していない）。
- 4 種の区別の記述が owner の意図と合っているか。
- §5 の禁止事項の書き方が実務的か。
- 採用例・未採用例の判定が owner の判断と合っているか。

## 7. 残存の未決事項

- 画像は §4 までしか写っていない（budget 制約）。文書全体を見たい場合は §5 の手順で `--clip-height` を外すか、budget を見直す判断が owner 次第。
- Miro の付箋本文は閲覧できないため、付箋内の詳細・年表・数値・評価は本文側で「未確認（owner 確認待ち）」と明示してある。確認後に本文を書き換える場合、本文と preview の parity gate が落ちるため、preview データも同時に更新する必要がある。
