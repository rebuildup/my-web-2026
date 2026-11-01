# Keyboard layout snapshot sync runbook (Issue #620, Issue #719)

> `/keyboard` が表示するキーボード配列のスナップショットを、公開
> GitHub リポジトリから取得して更新する手順。取得・検証・書き込みは
> `scripts/sync-keyboard-layout.mjs` が担い、**ページのリクエスト時に
> 外部へ問い合わせる経路は存在しない**。

---

## 0. Issue #719 で変わったこと（何が変わったか）

**以前は「ローカルのスケジューラが 1 日 1 回実行する」と書かれていたが、
インストールされているスケジューラは存在しなかった。** 以前の §4 にあった launchd /
cron は *例* であり、起動する仕組みは誰からも登録されていなかった。
そのため Issue #620 が掲げた「人手のコピペを不要にする」約束は、
運用されずに残っていた（= この runbook の記述と実態の乖離）。

Issue #719 で、これを **このリポジトリが実行を証明できる唯一の
スケジューラ = GitHub Actions の scheduled workflow** に置き換えた。

| 項目 | 以前（Issue #620 時点） | 現在（Issue #719） |
| --- | --- | --- |
| スケジューラ | launchd / cron の**例**（未登録） | `.github/workflows/keyboard-sync.yml`（**インストール済み**） |
| 実行場所 | 開発者の手元 | GitHub Actions（毎日 04:41 UTC） |
| 反映経路 | 手元の worktree を人手 commit | 自動 commit → 自動 PR → **人が merge** |
| 失敗の見え方 | 開発者の手元のログ | リポジトリの **Actions ページ**の赤い run |
| 復旧の担当 | 不明（記載なし） | **リポジトリの owner**（§5） |

置き換えた理由:

1. ローカルスケジューラは「動いている」ことを第三者から確認できず、
   実際にも動いていない（§0 のとおり実体がなかった）。
2. CI は既に `main` への push → Cloudflare Workers Builds の deploy
   経路と分離しており、credential を持たない（`quality/actions-pins.json`
   の `secrets.allow_references` は空）。同じ形の workflow として
   置けば、「読み取るだけ・書くのは自分のブランチだけ」の境界を
   そのまま保てる。
3. 同じ接続点にある `Project introduction sync`
   （`.github/workflows/projects-sync.yml`）という先例がある。

**以前の launchd / cron の例は削除した。** 例のまま残すと「動いている」
ように見えるので。運用上の代替手段が必要になった場合は、
`workflow_dispatch`（手動実行）を使う（§3.2）。

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

### 3.1 自動（インストール済みのスケジューラ）

| 項目 | 値 |
| --- | --- |
| workflow file | `.github/workflows/keyboard-sync.yml` |
| workflow 名 | `Keyboard layout sync` |
| スケジュール | 毎日 04:41 UTC（`cron: '41 4 * * *'`） |
| 手動実行 | 同ページの `workflow_dispatch`（Run workflow） |
| 対象ブランチ | `keyboard-layout-sync`（自動作成・更新） |
| PR の base | 変数 `vars.KEYBOARD_SYNC_BASE_REF` が指すブランチ |

- 実行履歴は **リポジトリの Actions タブ** → `Keyboard layout sync` の
  run 一覧で確認できる。定期実行は `schedule` トリガーとして実行され、
  同じ画面に出る。
- 分を `41` にしているのは、0 分ちょうどは全リポジトリの定期 job が
  queued される混雑する時刻のため（`Project introduction sync` と同じ
  理由）。
- **`vars.KEYBOARD_SYNC_BASE_REF` が未設定の場合、job は status-only の
  メッセージを出して停止する（base を推測しない）。** この変数は
  sprint cut 時に owner が active な `release-x-y-z` ブランチへ設定する
  ものとする。`Project introduction sync` の
  `vars.PROJECTS_SYNC_BASE_REF` と同じ運用である。
- workflow は **merge / tag / deploy / publish を行わない**。做出的 PR は
  必ず 사람이 merge する（§7）。

### 3.2 手動（同一スクリプトを直接叩く）

```bash
# 取得・検証だけ行い、差分の有無を表示する（書き込みなし）
pnpm run keyboard:sync -- --dry-run

# 取得・検証し、変更があれば sources と manifest を書き換える
pnpm run keyboard:sync

# コミット済みスナップショットだけを検査する（ネットワーク不要）
pnpm run keyboard:check
```

正常時の出力は status-only である。取得したキーボード設定本文は
表示しない。

```text
keyboard-sync: unchanged (4 sources checked)
```

```text
keyboard-sync: updated (1 source file(s), 1 manifest)
```

失敗時は reason code だけを stderr に出し、exit code 1 で終了する。
**失敗には 2 種類があり、意味が異なる（§6）：**

```text
keyboard-sync: unavailable (mac-kanata-not-found)
```

```text
keyboard-sync: failed (windows-kanata-parse-failed)
```

`KEYBOARD_SYNC_DEBUG=1` を付けた場合だけ stack trace を追加する
（取得内容は出さない）。

### 変更時の書き込み

`updated` のときだけ、**実際にバイト列が変わったファイル**を
一時ファイル経由で置換する（変更のない source のファイルは触らない）。

- `src/keyboard/sources/key-map-kanata/mac/kanata-us.kbd`
- `src/keyboard/sources/key-map-kanata/win/kay-map-win.kbd`
- `src/keyboard/sources/pc-setup/platforms/macos/keyboard/onishi.json`
- `src/keyboard/sources/manifest.json`

ref と SHA-256 が前回と同じ source は `fetchedAt` を保持する。
**4 source のどれも変わっていない場合は `syncedAt` も進めない**ので、
無変更の定期実行は worktree を dirty にしない。

## 4. 自動更新の契機と許容遅延

### 4.1 遅延を「検証済み」と「目標」に分ける

| 区分 | 値 | 根拠 |
| --- | --- | --- |
| **検証済み** | 取得 → 差分検出 → publish 計画の機械的処理 | fixture で実証済み（`scripts/_keyboard-sync-publish.test.mjs`、14 tests）。upstream が変われば diff が出て PR 形状（branch / base / changed files）になり、変われば何も起きない |
| **検証済み** | スケジュールの間隔 = 24 時間 | `cron: '41 4 * * *'` の定義から確定 |
| **検証済み** | ページの「古さ」の判定 = 45 日 | `KEYBOARD_STALE_AFTER_DAYS`（`src/keyboard/types.ts`）。45 日を超えた snapshot は `stale` として表示される |
| **目標** | upstream 変更 → ページ反映 = 24 時間 + queue + 人手 review | **目標値であり、観測値ではない**。workflow が初めて 1 周した後に実測値を更新する |
| **目標** | 変更から PR 作成まで = 実行直後 | script が書き込みと push まで完了する |
| **目標** | PR → `main` 反映 = 通常の review / release 手順 | 人間前提であり、所要時間は owner の判断 |

> **未検証の事項（Issue #719 の時点では観測できていない）**: 実際の
> scheduled run が 1 回も走っていない（workflow はまだ merge されて
> いない）。したがって「upstream 変更 → ページ反映」の実測遅延は
> **まだ存在しない**。上の「目標」は、merge 後の初回 run を観察した
> 時点で実測値に置き換えること。

### 4.2 snapshot が古いとき

スナップショットが 45 日を超えて更新されない場合、ページは図を
残したまま **stale** と表示し、最終同期日と経過日数を出す
（`KEYBOARD_STALE_AFTER_DAYS`）。「古いデータを最新として表示しない」
という契約は、この freshness 判定が担う。

### 4.3 人手のコピペを不要にする範囲

スケジューラが行うのは **取得・parse・検証・書き込み・commit・PR 作成**
までである。`main` への直接 push はしない。変更があった場合は
`keyboard-layout-sync` ブランチへの commit と review PR で land させる。
コピペは不要だが、公開 contract を review なしに更新しないための
human gate は残す。

## 5. 失敗時の通知と復旧の担当

### 5.1 通知

- **通知は「Actions ページに赤い run が見える」こと**である。
  「The workflow failed」という定型文を誰かに送る仕組みは
  実装していない（通知の宛先は owner 1 人であり、e-mail / webhook を
  足すことは owner 決定と ADR を要する）。したがって:

  | 状況 | 見え方 |
  | --- | --- |
  | 取得または検証が失敗 | その run が **失敗（red）** になる。Actions タブ → `Keyboard layout sync` で確認できる |
  | upstream が変化していない | run は **成功（green）**。ログに `keyboard-sync: unchanged` が残る。commit も PR も出ない |
  | base 変数が未設定 | run が **失敗（red）**。ログに `vars.KEYBOARD_SYNC_BASE_REF is unset` が出る |

### 5.2 復旧の担当

**復旧の担当はリポジトリの owner**（`rebuildup/my-web-2026` の
owner）。判断と操作の划分は次のとおり。

1. owner が Actions ページの run を開く（= 通知を受ける）。
2. 原因が上流側の一時的な問題（`error`）なら、Actions ページの
   **Re-run all jobs** でその run を再実行する。一時的な 5xx や
   timeout は再実行で回復する。
3. 原因が上游の状態変化（`unavailable`）なら、再実行しても直らない。
   owner が upstream 侧（`rebuildup/key-map-kanata` /
   `rebuildup/pc-setup`）を確認して、allowlist の path が変わったのか、
   repository が変わったのかを判断し、必要なら本 Issue の
   allowlist 改定（コード変更）を行う。
4. snapshot の書き込みは失敗時に一切行われないので、復旧までの
   あいだもページは「最後に成功した内容」を表示し、45 日を超えると
   `stale` になる（§4.2）。

**Agent が自動 merge することは無い。** 失敗の修復、路線の再取得、
allowlist の改定は、いずれも owner 决定を要する。

## 6. 失敗の種類（`unavailable` と `error`）

同期が失敗したとき、**「upstream が変わっていない」とは言わない**。
2 種類を区別して報告する。

| 種類 | 意味 | 典型的な reason code | 处置 |
| --- | --- | --- | --- |
| `unavailable` | **upstream の状態**として、もう allowlist された内容を配信していない | `github-api-not-found`、`*-not-found`、`installer-missing-config-ref`、`installer-config-url-mismatch` | owner が upstream を確認（§5.2-3） |
| `error` | **transport / 検証**の失敗。一時的、あるいは解析できない | `github-api-unreachable`、`github-api-status`、`*-unreachable`、`*-status`、`*-too-large`、`*-kanata-parse-failed`、`*-kanata-key-count`、`onishi-json-parse-failed` | owner が再実行（§5.2-2） |

両方の種類で **snapshot のバイト列は一切書き換えない**。したがって
`syncedAt` は進まず、古い snapshot が「現在」と読まれることはない
（45 日で `stale` になる）。

401 / 403 / 429 は `unavailable` ではなく `error` として扱う。
GitHub は匿名クライアントに対して private repository を 404 で返す
ので、403 / 429 は一時的な認証・リトライ境界であり、
「upstream が消えた」という状態として記録してはならない。

## 7. PR review の担当

- 自動作成される PR の base は `vars.KEYBOARD_SYNC_BASE_REF`、
  head は `keyboard-layout-sync`。
- **merge は人間（owner）が行う。** workflow は merge / approve /
  tag / deploy / publish のいずれも行わない（AGENTS.md §6）。
- PR 本文には変更ファイル、取得の境界（token なし・redirect 禁止・
  サイズ上限あり）、「変更がなければ commit も PR も出ない」こと、
  「取得できないときは `unavailable` / `error` として扱い、直近の
  snapshot を current として扱わない」ことが明記される。

## 8. push の安全性

- publish は `scripts/_projects-sync-push.mjs`（Issue #739）の lease
  机制を使う。期待値は **remote の現在の状態**（`git ls-remote`）から
  解決するので、**常に明示的な lease** を渡す。並行 run が push して
  いた場合は拒否され、相手の snapshot を上書きしない。
- push は `keyboard-layout-sync` ブランチに対してのみ行う。
  `main` / release ブランチ / tag / Release への push はしない。

## 9. 検証内容（書き込み前）

次のいずれかが失敗した場合、**1 バイトも書き換えず** exit 1 になる。

| reason code | 種類 | 条件 |
| --- | --- | --- |
| `github-api-unreachable` / `github-api-status` | error | commit 一覧を取得できない |
| `github-api-not-found` | unavailable | repository が見つからない（削除 / private） |
| `github-api-invalid-json` / `github-api-invalid-sha` | error | API 応答が想定形状でない |
| `installer-missing-config-ref` | unavailable | `config_ref` が 40 hex でない |
| `installer-config-url-mismatch` | unavailable | `config_url` が allowlist の `mac/kanata-us.kbd` を指していない |
| `macos-kanata-parse-failed` / `windows-kanata-parse-failed` | error | Kanata として parse できない |
| `macos-kanata-key-count` / `windows-kanata-key-count` | error | `defsrc` が 72 / 74 キーでない（図の geometry と不一致） |
| `onishi-json-parse-failed` | error | hidutil JSON が bounded parser を通らない |
| `*-not-found` | unavailable | allowlist された path が 404 |
| `*-unreachable` / `*-status` / `*-too-large` | error | 取得失敗・HTTP エラー・サイズ超過 |

`installer-config-url-mismatch` は、installer が `config_ref` を
シェル変数のまま URL に埋めている場合（`.../$config_ref/mac/...`）と、
展開済み URL の両方を受け入れる。それ以外の URL は拒否する。

## 10. 変更がページに反映されることの確認（fixture による）

`scripts/_keyboard-sync-publish.test.mjs`（`node --test`）が、upstream
を fixture に差し込んだ状態で**経路全体**を動かして確認する。
「スクリプトがファイルを書いた」だけでは证明にならない。

| 確認項目 | 期待 |
| --- | --- |
| upstream の変更 | snapshot に diff が出る。変更のない source のファイルは書き換えられない |
| publish 計画 | branch `keyboard-layout-sync` / base / 変更ファイル一覧という **PR 形状**が得られる |
| upstream の変更なし（**負の対照**） | diff 0・commit 0・PR 0。ファイルは byte 同一 |
| upstream が 404（**負の対照**） | `unavailable`。committed snapshot は byte 同一。`syncedAt` は進まない |
| upstream が parse 不能（**負の対照**） | `error`。committed snapshot は byte 同一 |
| ページの表示モデル | 更新後の byte 列が bounded parser を通り、表示ラベルの付与と manifest の provenance（ref / sha256 / adoption ref）が整合する |
| push の安全性 | lease 付きで remote にブランチが作られ、期待値が変わった remote への push は拒否される |

CI では、同じ検査が **更新後の snapshot に対して** additionally
実行される（`pnpm run keyboard:check` と `pnpm exec vitest run src/keyboard
test/integration/keyboard-page.test.ts`）。つまり、公開されるバイト列は
ページ自身のテストを通ってから PR になる。

## 11. スクリプトがしないこと

- **リクエスト時の取得をしない。** Worker は `src/keyboard/sources/` の
  コミット済みバイト列だけを読む。`src/**` にネットワーク呼び出しは
  1 つも含まれていない。
- **自動 merge しない。** PR を作るだけで、merge / approve / tag /
  deploy / publish は行わない（§7）。
- **credential を扱わない。** upstream 読み出しは unauthenticated。
  token を要求も保持もしない。`GITHUB_TOKEN` は push と PR 作成にのみ
  使い、スクリプトはその値を見ない。
- **allowlist の外を見ない。** 任意 path・任意 repository・redirect を
  追わない。

## 12. 参照

- workflow: `.github/workflows/keyboard-sync.yml`
- 取得・検証・書き込み: `scripts/sync-keyboard-layout.mjs`
- publish 計画と push: `scripts/_keyboard-sync-publish.mjs`
- lease: `scripts/_projects-sync-push.mjs`（Issue #739）
- fixture による経路検証: `scripts/_keyboard-sync-publish.test.mjs`
- オフライン検査: `pnpm run keyboard:check`
- allowlist / 契約: `src/keyboard/sources/manifest.json`、
  `src/keyboard/load.ts`
