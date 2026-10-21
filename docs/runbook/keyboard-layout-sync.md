# Keyboard layout snapshot sync runbook (Issue #620)

> `/keyboard` が表示するキーボード配列のスナップショットを、公開
> GitHub リポジトリから取得して更新する手順。取得・検証・書き込みは
> `scripts/sync-keyboard-layout.mjs` が担い、**ページのリクエスト時に
> 外部へ問い合わせる経路は存在しない**。

---

## 1. 何を同期するか

`/keyboard` の表示は、`src/keyboard/sources/` にコミットされた
バイト列だけを読む。Worker は GitHub API も raw URL も呼ばない。
同期はスナップショットを更新する操作であり、表示時に行う処理ではない。

| source id | repository | path | 採用規則 |
| --- | --- | --- | --- |
| `mac-kanata` | `rebuildup/key-map-kanata` | `mac/kanata-us.kbd` | **pc-setup の installer が pin する `config_ref`** |
| `win-kanata` | `rebuildup/key-map-kanata` | `win/kay-map-win.kbd` | 取得時点のデフォルトブランチ head |
| `onishi-json` | `rebuildup/pc-setup` | `platforms/macos/keyboard/onishi.json` | 取得時点のデフォルトブランチ head |
| `pc-setup-install` | `rebuildup/pc-setup` | `platforms/macos/kanata/install-kanata.sh` | head。**バイト列は保存せず** ref と hash だけを記録 |

`mac/kanata-us.kbd` は `key-map-kanata/main` から取得しない。
`key-map-kanata/main` に同ファイルが存在しない期間があり、main の
head を「採用中の設定」と見なすと実機と違う図を現在のものとして
表示してしまうためである。installer の `config_ref` が変わると、
次の同期で macOS の図もその ref に追従する。

## 2. allowlist と取得境界

`scripts/sync-keyboard-layout.mjs` の `SOURCES` が唯一の allowlist で
あり、環境変数で広げることはできない。

- 取得先は上の 4 path だけ。任意 path、private repository、
  submodule、token、ローカル機器の状態は読まない。
- GitHub API は **unauthenticated** で呼ぶ。token を要求も保持もしない。
- すべての fetch は `redirect: 'error'`。allowlist 外へ転送させない。
- 1 source あたり 64 KiB、installer は 128 KiB を上限とし、
  `content-length` と実バイト数の両方で検査する。
- 取得した文字列は **parse してから**書き込む。HTML / JS として
  実行しない。表示モデルは `src/keyboard/parse-*.ts` の安全な
  中間表現だけである。

`docs/domain/integrations.md` の意味での third-party integration は
作らない。consumer は `/keyboard` 1 つだけで、credential / OAuth /
webhook / 常時接続の lifecycle を持たないため、obligation 内の
スナップショット同期に留める。

## 3. 実行方法

```bash
# 取得・検証だけ行い、差分の有無を表示する（書き込みなし）
pnpm run keyboard:sync -- --dry-run

# 取得・検証し、変更があれば sources と manifest を書き換える
pnpm run keyboard:sync
```

正常時の出力は status-only である。取得したキーボード設定本文は
表示しない。

```text
keyboard-sync: unchanged (4 sources checked)
```

```text
keyboard-sync: updated (3 source files, 1 manifest)
```

失敗時は reason code だけを stderr に出し、exit code 1 で終了する。
`KEYBOARD_SYNC_DEBUG=1` を付けた場合だけ stack trace を追加する
（取得内容は出さない）。

### 変更時の書き込み

`updated` のときだけ、次の 4 ファイルを一時ファイル経由で置換する。

- `src/keyboard/sources/key-map-kanata/mac/kanata-us.kbd`
- `src/keyboard/sources/key-map-kanata/win/kay-map-win.kbd`
- `src/keyboard/sources/pc-setup/platforms/macos/keyboard/onishi.json`
- `src/keyboard/sources/manifest.json`

ref と SHA-256 が前回と同じ source は `fetchedAt` を保持する。
**4 source のどれも変わっていない場合は `syncedAt` も進めない**ので、
無変更の定期実行は worktree を dirty にしない。

## 4. 自動更新の契機と許容遅延

同期はローカルのスケジューラで 1 日 1 回実行する。CI には置かない。
`.github/workflows/**` は Cloudflare credential を持たず、production
への反映は Cloudflare Workers Builds（`main` への push）が所有する
ため、同期自体を CI の deploy 経路に混ぜない。

macOS の `launchd` の例:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.rebuildup.my-web-2026.keyboard-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>pnpm</string>
    <string>run</string>
    <string>keyboard:sync</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/my-web-2026</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>17</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/path/to/my-web-2026/.tmp/keyboard-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/path/to/my-web-2026/.tmp/keyboard-sync.log</string>
</dict>
</plist>
```

`cron` を使う場合:

```cron
17 9 * * * cd /path/to/my-web-2026 && /usr/bin/env pnpm run keyboard:sync >> .tmp/keyboard-sync.log 2>&1
```

許容遅延:

| 区間 | 目標 |
| --- | --- |
| 公開 repository の変更 → 次回スケジュール実行 | 24 時間以内 |
| スケジュール実行 → スナップショット更新の commit / PR | 実行直後（スクリプトが書き込みまで完了する） |
| commit / PR → `main` 反映 | 通常の review / release 手順に従う |

スナップショットが 45 日を超えて更新されない場合、ページは図を
残したまま **stale** と表示し、最終同期日と経過日数を出す
（`KEYBOARD_STALE_AFTER_DAYS`）。「古いデータを最新として表示しない」
という契約は、この freshness 判定が担う。

### 人手のコピペを不要にする範囲

スケジューラが行うのは **取得・parse・検証・書き込み** までである。
`main` への直接 push はしない。変更があった場合は通常の branch /
PR / review 経路で land させる。コピペは不要だが、公開 contract を
review なしに更新しないための human gate は残す。

## 5. 検証内容（書き込み前）

次のいずれかが失敗した場合、**1 バイトも書き換えず** exit 1 になる。

| reason code | 条件 |
| --- | --- |
| `github-api-unreachable` / `github-api-status` | commit 一覧を取得できない |
| `github-api-invalid-json` / `github-api-invalid-sha` | API 応答が想定形状でない |
| `installer-missing-config-ref` | `config_ref` が 40 hex でない |
| `installer-config-url-mismatch` | `config_url` が allowlist の `mac/kanata-us.kbd` を指していない |
| `macos-kanata-parse-failed` / `windows-kanata-parse-failed` | Kanata として parse できない |
| `macos-kanata-key-count` / `windows-kanata-key-count` | `defsrc` が 72 / 74 キーでない（図の geometry と不一致） |
| `onishi-json-parse-failed` | hidutil JSON が bounded parser を通らない |
| `*-unreachable` / `*-status` / `*-too-large` | 取得失敗・HTTP エラー・サイズ超過 |

`installer-config-url-mismatch` は、installer が `config_ref` を
シェル変数のまま URL に埋めている場合（`.../$config_ref/mac/...`）と、
展開済み URL の両方を受け入れる。それ以外の URL は拒否する。

## 6. 変更がページに反映されることの確認

1. `pnpm run keyboard:sync -- --dry-run` で差分の有無を確認する。
2. 変更がある状態で `pnpm run keyboard:sync` を実行する。
3. `pnpm exec vitest run src/keyboard` と
   `pnpm exec vitest run test/integration/keyboard-page.test.ts` を実行する。
4. `src/keyboard/sources/manifest.json` の `syncedAt`、`ref`、
   `sha256` が更新され、`/keyboard` の出典表と図が新しい値になることを
   確認する。
5. 変更された fixture で表示が変わること、取得失敗・破損・未対応構文で
   安全な状態になることは unit / contract test が固定している。

## 7. 失敗時の扱い

- 同期スクリプトが失敗しても、コミット済みのスナップショットは
  そのまま残る。ページは最後に成功した内容を表示し、45 日を超えれば
  stale と表示する。
- 片方の platform の parse だけが失敗した場合、その platform は
  `unavailable` になり、もう片方は表示を続ける。ページ全体は
  落とさない。
- manifest の来歴が壊れている場合（repository / path / ref / URL /
  adoption の不整合）は、ページ全体が `invalid-manifest` の安全な
  状態になる。診断コードだけを表示し、古い内容を現在のものとして
  出さない。
- API rate limit は unauthenticated の範囲で足りる想定だが、失敗は
  fail-closed であり、取得できなかった source を空や推測で埋めない。
