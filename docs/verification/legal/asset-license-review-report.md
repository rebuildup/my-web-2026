# 資産の権利 / 出典 / ライセンス検証 — 記録

- 判定: **WARN** / 記録: `quality/asset-license-inventory.json` / 監査対象ファイル: 126
- 資産記録 15 件（公開可 11 / 保留 2 / 提供者条件 2）
- 記録済みファイル 116 / 未記録 10 / findings 18（error 0 / warn 12 / info 6）

| 判定 | 記録 id | 種別 | 対象ファイル | 由来 | 公開状態 |
| --- | --- | --- | --- | --- | --- |
| publishable | `web-app-icons` | image | 9 | repository-generated | published |
| publishable | `web-favicon` | image | 1 | repository-authored | published |
| publishable | `web-app-manifest` | config | 1 | repository-authored | published |
| publishable | `static-asset-headers` | config | 1 | repository-authored | published |
| publishable | `image-cls-fixtures` | image | 2 | repository-generated | published |
| publishable | `og-fallback-card` | image | 1 | repository-generated | published |
| publishable | `share-procon2026-guide` | artwork | 1 | repository-authored | published |
| publishable | `share-procon2026-fonts-noto-sans-jp` | font | 49 | third-party-bundled | published |
| publishable | `share-procon2026-fonts-material-symbols` | font | 1 | third-party-bundled | published |
| hold | `share-procon2026-pdfs` | document | 6 | unknown-provenance | published |
| hold | `share-procon2026-images` | image | 35 | unknown-provenance | published |
| publishable | `pet-melty-sprites` | artwork | 8 | repository-authored | published |
| provider-terms | `web-fonts-google` | font | 0 | third-party-referenced | published |
| provider-terms | `tool-webfont-typekit` | font | 0 | third-party-referenced | published |
| publishable | `tool-preview-screens` | image | 1 | repository-generated | published |

## findings

- **L017** (info) `share-procon2026-pdfs` — 検証方法が未検証です。権利・出典・ライセンスの証拠はこのリポジトリにありません。
  - remedy: 証拠が揃うまで公開を保留するか、非公開にする。
- **L018** (info) `share-procon2026-pdfs` — 第三者を同梱しているのにライセンスが記録されていません（NOASSERTION）。
  - remedy: ライセンス表記を同梱するか、公開を保留する。
- **L010** (warn) `share-procon2026-pdfs` — 証拠が不足している（保留）にもかかわらず、このリポジトリでは公開中と宣言されています。
  - remedy: 公開の継続は owner の公開判断としてレビューする。取り下げ・ライセンス同梱のどちらかを記録する。
- **L017** (info) `share-procon2026-images` — 検証方法が未検証です。権利・出典・ライセンスの証拠はこのリポジトリにありません。
  - remedy: 証拠が揃うまで公開を保留するか、非公開にする。
- **L018** (info) `share-procon2026-images` — 第三者を同梱しているのにライセンスが記録されていません（NOASSERTION）。
  - remedy: ライセンス表記を同梱するか、公開を保留する。
- **L010** (warn) `share-procon2026-images` — 証拠が不足している（保留）にもかかわらず、このリポジトリでは公開中と宣言されています。
  - remedy: 公開の継続は owner の公開判断としてレビューする。取り下げ・ライセンス同梱のどちらかを記録する。
- **L011** (info) `web-fonts-google` — コピーを配布していないため、このリポジトリ側では公開を妨げる条件は確認されていません。
  - remedy: 提供側の条件変更時に、この記録をレビューし直す。
- **L011** (info) `tool-webfont-typekit` — コピーを配布していないため、このリポジトリ側では公開を妨げる条件は確認されていません。
  - remedy: 提供側の条件変更時に、この記録をレビューし直す。
- **S002** (warn) `src/home/digits/0.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/1.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/2.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/3.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/4.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/5.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/6.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/7.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/8.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
- **S002** (warn) `src/home/digits/9.webp` — 監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。
  - remedy: owner が判断したら、資産記録を追加して台帳の該当行を削除する。
