# 依存 install lifecycle script 監査 runbook (Issue #474)

> `pnpm install` が実行できる third-party code の実行許可を、
> 「暗黙のリスト」から「理由つきのレビュー記録」へ変えるための
> 正本。Source-controlled by Issue #474。
> Cross-linked from
> [`quality/profile.yaml`](../../quality/profile.yaml#security_gates)、
> [`docs/security.md`](../security.md)、
> [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)。

## 1. 何を監査しているか

`pnpm install` は、リポジトリのコードを 1 行も検証する前に
third-party の `preinstall` / `install` / `postinstall` を実行しうる。
pnpm 12 はこれを **default-deny** にしていて、
`pnpm-workspace.yaml#allowBuilds`（`#permissions` があればそちらが優先）
に `true` で書かれた名前だけが実行される。
`#onlyBuiltDependencies` は旧形式のリストで、pnpm 12 の実行許可源ではない。
ここにだけ残る名前は「許可されたように見えるが実際には走らない」ため、
gate は **不一致 = violation** として落とす。

この default-deny が security boundary だが、それ自体は無口である。
「なぜそのエントリが必要なのか」を記録する場所が無かったため、

- ビルド 不要になったエントリが残り続ける
- 実行権限がいつ・なぜ与えられたのかを差分から読み取れない
- レビューする側も「許可してよいか」を毎回ゼロから判断する

という状態になっていた。この runbook が導入する gate は、その
「無口」を検査可能な契約に変える。

### hook の分類（監査の判断基準）

| 分類 | hook | fires | policy entry |
| --- | --- | --- | --- |
| install-time | `preinstall` / `install` / `postinstall` | `pnpm install` 中（許可された場合） | **必須** |
| install-time（暗黙） | `implicit:binding.gyp` | `scripts` が無くても `binding.gyp` を持つ package は buildable とみなされ、許可されると `node-gyp rebuild` が走る | **必須** |
| install-time（条件付き） | `prepare` | **git-hosted** dependency では `pnpm install` 中に prepare される（pnpm `git-fetcher` / `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`） | **必須**（その dependency が git 依存のとき） |
| root-only | `prepare` | workspace root project の `pnpm install` 時のみ（registry dependency では走らない） | **必須** |
| publish-time | `prepublish` / `prepublishOnly` / `prepack` / `postpack` | その package を publish / pack する時のみ | 不要（報告のみ） |

registry dependency の `prepare` は走らない（root project のみ）。
一方 **git 依存は別**: pnpm は git から取得した package を install 中に
prepare するため、git specifier の依存は `prepare` でも install-time 扱いになる。
依存元は root / 各 package manifest の dependency map から git specifier を
検出する（`git:` / `git+ssh:` / `github:` / `gitlab:` / `bitbucket:` /
`*.git` URL）。
`prepublishOnly` を持つ package が 121 個あるが、
そのどれかが install 時に走ることはないため、121 個の記録条目を作っても
セキュリティ上の価値はゼロである。報告に数えるだけにする。

## 2. 3 つのファイルの責務

| file | 責務 | 変更の 合否 |
| --- | --- | --- |
| `pnpm-workspace.yaml#allowBuilds` | **実行許可**（実際に何が走るか） | `allow` 判断と同期が必須 |
| `quality/install-scripts.json` | **判断記録**（何を許可/拒否したか、なぜ） | gate が読む |
| `scripts/check-install-scripts.mjs` | **検査**（両者の不一致を失敗させる） | `validate:fast` で実行 |

2 つのファイルは **別々** に drift しうる。だから gate は両方を読み、
矛盾するどちらの向きでも失敗する。

### gate が読む `pnpm-workspace.yaml` のキー

| key | 役割 | gate の扱い |
| --- | --- | --- |
| `allowBuilds` | pnpm 12 の実行許可（map / boolean） | **実行許可源**。`false` は許可ではない |
| `permissions` | pnpm 12 の新しい許可 map。両方あれば `allowBuilds` より優先される | 実効許可源として読む。同時宣言は ambiguoust なため入力エラー |
| `onlyBuiltDependencies` | 旧形式のリスト | 実効許可源には数えない。ここだけの名前は violation |
| `ignoredBuiltDependencies` | 明示的な deny リスト | 許可と併記されたら violation |

新しい grant key を追加했다ら parser の同期が必要。
意図しない key を黙って無視すると、「許可されているはずが走っていない」
状態を gate が green として見直すことになるためである。

## 3. 実行方法

```bash
# gate（validate:fast に含まれる。exit 1 = violation）
pnpm run install:scripts:check

# 機械可読（CI の集約ログなど）
node scripts/check-install-scripts.mjs --json

# 検証用 HTML レポート（runbook のスクリーンショット生成にも使う）
pnpm run install:scripts:html   # -> .tmp/install-script-audit.html
```

Exit codes: `0` = 監査済み・clean / `1` = violation / `2` = 入力不備
（policy / allow-list / `package.json` が読めない、policy が不正、
または `node_modules` が未 install で**監査対象自体が無い**）。
`2` は fail-closed なので、`pnpm install` を先に実行する。
「未 install でも 0 件 = clean」という偽の green は作らない。
`node_modules` の存在だけでは「install 済み」とは見なしません:
pnpm 自身が出す installation marker
（`node_modules/.modules.yaml` または `node_modules/.pnpm`）と、
依存 manifest 1 件以上を要求する。`mkdir node_modules` だけの中断 install は
監査対象にせず、`2` で落とす。

`--json` は **stdout に JSON だけ** を出します（verdict / progress 行は
stderr）。`jq` や集約ログにそのまま渡せるのはそのためです。

### 既存 secret SoT / Cloudflare Workers Builds / リリース承認への影響

**なし**。この gate は

- `node_modules` の package manifest と policy ファイル 2 個だけを読む
- secret 値（`.dev.vars` / Infisical / Worker secret）を一切読まない
- `pnpm install` 中のローカル実行を記述するもので、runtime / deploy /
  本番データに触れない

ので、ADR-0015 の secret SoT、Cloudflare Workers Builds による本番配信
(AGENTS.md §4)、release PR の human gate (AGENTS.md §6) はそのまま
維持される。ADR-0015 が定めた「status-only 出力で比較する」という
方針と同じ思想で、**名前・バージョン・hook 名・判断理由だけ**を出す。

## 4. 正常時の観測

Issue #474 の実行時点（head = 本 runbook の導入 PR）で
`pnpm run install:scripts:check` は **violation 0 / warning 0** で通る。

| package | hooks | 判断 | 許可 | 理由の要約 |
| --- | --- | --- | --- | --- |
| `.`（root） | `prepare` | allow | n/a | 自前コードの `panda codegen`（generated Panda types が無ければ typecheck 不可） |
| `@biomejs/biome` | `postinstall` | allow | yes | platform binary の解決。無いと `format:check` / `lint:check` が動かない |
| `esbuild` | `postinstall` | allow | yes | Vite 系の platform binary 検証。3 version 同時導入 |
| `workerd` | `postinstall` | allow | yes | `@cloudflare/vitest-plugin` の workerd pool と Cloudflare Vite plugin の runtime binary |
| `@infisical/cli` | **`preinstall`** | allow | yes | ADR-0015 の secret tooling が native binary を exec する。**risk 高・要記録**（§6） |

publish-time のみ: 121 package（記録不要）。
install 時に実行できる package は 5（root を含む）。
allow-list に残っていた `@cloudflare/vite-plugin` は、
pin されている version が install-time hook を宣言していないため
**この監査で allow-list の古い行（`onlyBuiltDependencies`）から削除済み**。
pnpm 12 の実効許可源は `allowBuilds` なので、これは「死んでいた行の撤去」で
あって「実行されていた権限の停止」ではない（warning の検出自体は実在する）。
将来 version が hook を持つようになれば、gate が「未レビュー」として
失敗させ、許可の追加が明示的な変更になる。

### 誤検出をLessonとして持つ（`ljharb-monorepo-symlink-test`）

最初の実装は `node_modules` 配下の `package.json` を再帰的に全部読んだため、
dependency が同梱している test fixture
（`resolve` package 内の `test/resolver/multirepo` にある
`ljharb-monorepo-symlink-test@0.0.0`）を「インストール済み package」と誤認し、
`block` の policy 条目を作っていた。pnpm は fixture を build しないので、
あの hook は install 時に走らない。
現在の実装は **package boundary のみ**（`node_modules` の entry、scope の 1 段下、
`.pnpm` の slot、各 package の入れ子 `node_modules`）を辿り、
該当 policy 条目は削除済み。

### スクリーンショット

![install lifecycle script audit](../verification/supply-chain/install-script-audit.webp)

`docs/verification/supply-chain/install-script-audit.webp`
（Issue が指定した `.png` パスは、中間 PNG を commit せず、
`sharp` で `width:1600` / `quality:80` の WebP に変換して commit している。
WebP 化の理由はリポジトリを小さく保つことであり、
その根拠を policy として主張するものではない。変換コマンドは §5）。

画像は **proof の全部ではない**。上の表と §3 のコマンドで誰でも
同じ結果を再現できる。

## 5. 検証

```bash
pnpm exec biome check scripts/_install-scripts.mjs \
  scripts/check-install-scripts.mjs scripts/check-install-scripts.test.mjs
node --test scripts/check-install-scripts.test.mjs     # 44 tests
pnpm run install:scripts:check                        # gate 自体
pnpm run architecture:check                           # 境界に影響しないこと
pnpm run test:wiring:check                            # test  が配線されていること
```

スクリーンショットを再生成する場合:

```bash
pnpm run install:scripts:html
node -e "const {chromium}=require('@playwright/test');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:1200},deviceScaleFactor:2});await p.goto('file://'+process.cwd()+'/.tmp/install-script-audit.html');await p.screenshot({path:'docs/verification/supply-chain/install-script-audit.png',fullPage:true});await b.close();})()"
node -e "require('sharp')('docs/verification/supply-chain/install-script-audit.png').resize({width:1600,withoutEnlargement:true}).webp({quality:80}).toFile('docs/verification/supply-chain/install-script-audit.webp')"
rm docs/verification/supply-chain/install-script-audit.png
```

## 6. 異常時の観測と修復手順

### 6.1 violation（gate が落ちます）

| 出力 | 意味 | 修復 |
| --- | --- | --- |
| `declares install-time lifecycle script(s) … but has no entry` | 未レビューの install-time hook が混入 | §6.2 |
| `policy decision "allow" but pnpm-workspace.yaml does not list it` | 許可した build が実際には走らない | policy を `block` に直す、または allow-list に名前を足す（後者は「本当に必要か」を先に判断） |
| `policy decision "block" but pnpm-workspace.yaml allows its lifecycle scripts` | **拒否した code が毎回 install で走っている** | allow-list から名前を削除する（最も緊急） |
| `policy records hook(s) […] but the installed version(s) declare […]` | manifest 側が二重に fractional（新しい hook が出現） | 新しい hook の必要性を判断し、policy を更新する |
| `…#onlyBuiltDependencies lists it, but the effective grant list is #allowBuilds` | 旧リストだけに残る「許可」は pnpm 12 で実行されない | `allowBuilds` へ移すか、行を削除する |
| `policy observed version(s) […] != installed […]`（decision が `allow`） | **version が上がり、同じ hook 名のまま未レビュー code が走る** | 新しい version の manifest を読んで再レビューし、同じ変更で `observed_version(s)` を更新する |
| `grants it in #allowBuilds and denies it in #ignoredBuiltDependencies` | 許可と拒否が併記されている | どちらが意図か気づき、片方へ寄せる |
| `"allowBuilds" and "permissions" both grant build scripts` | 実効許可源が 1 つに決まらない | どちらか一方の map に統一する |
| `cannot audit: quality/install-scripts.json …` | policy が壊れている / 存在しない | メッセージの `packages[i]` を直して再実行。gate は fail-closed |
| `required input not found: …/node_modules` | install 前のため監査対象が無い | `pnpm install` を実行してから再実行（空 tree を clean としない） |
| `… is not a pnpm installation` / `holds no installed package manifest` | `node_modules` が空、または install が中断された | `pnpm install` を完走させてから再実行 |

### 6.2 「新しい install-time script が見つかった」手順

1. **落ちた hook を読む**
   ```bash
   node -e "const p=require('./node_modules/<pkg>/package.json');console.log(p.name,p.version,JSON.stringify(p.scripts,null,2))"
   ```
2. **その build が必要かを判断する**
   - binary を download / link するだけ → 通常は **必要**（allow）
   - 開発者向け monorepo の自己検証、test fixture の setup → **不要**（block、pnpm が既に通していないので追加 작업ゼロ）
   - **network 実行 file の取得を含む preinstall** → 必要だが **risk 記録**（§6.3）
3. **判断を記録する**（理由はいずれ必ず書く。空文字は policy validation で拒否される）
   ```json
   { "name": "<pkg>", "hooks": ["postinstall"], "decision": "allow",
     "observed_version": "<installed version>",
     "justification": "<なぜこの build が必要か>",
     "remediation": "<不要になったら何をするか>" }
   ```
4. `allow` にした場合は **同じ変更で** `pnpm-workspace.yaml#allowBuilds` にも
   名前を足す。旧来の `onlyBuiltDependencies` だけへの追記では pnpm 12 で
   実行されない（gate が violation にする）。
5. 許可の記録には **レビューした version** を書く。version が上がったまま
   hook 名が同じでも、実行される code は別物なので、`allow` 条目の
   version drift は violation になる。
6. `pnpm run install:scripts:check` を再実行して 0 violation を確認。

### 6.3 記録済みの高リスク条目（`@infisical/cli` の preinstall）

install 時に upstream GitHub release から native binary を
**network で取得して実行可能にする** preinstall があり、
upstream script 内に checksum 検証はない。
Infisical は ADR-0015 の secret SoT の実体（`scripts/deploy-with-secrets.mjs` ほかが
`@infisical/cli#bin` を exec する）なので **allow** 以外の判断になりえない。

リスクは記録し、許容の根拠と撤去条件を policy の
`justification` / `remediation` に書いたうえで固定する。
上流の改修（platform package を `optionalDependencies` にする、
あるいは postinstall 化 + checksum 検証）は
**Issue #474 のスコープ外＝別 PR** とする。
上流が直ったら、この entry と allow-list の行を同時に削除し、
その事実を本 runbook の §4 表に反映する。

### 6.4 warning（落ちませんがレビューが必要です）

| 出力 | 意味 | 対応 |
| --- | --- | --- |
| `pnpm-workspace.yaml#… allows build scripts for "X" but … declare no install-time lifecycle script — remove the entry` | 許可しているのに build が要らない | allow-list から削除する（本 Issue で `@cloudflare/vite-plugin` の旧行を撤去） |
| `policy observed version(s) […] != installed […]`（decision が `block`） | version が上がったが、記録は「走らせない」ので実行権限は変わらない | 判断を `allow` に変えるなら §6.2 の手順で同時に再レビューして更新する |
| `policy records hook(s) … that the installed version(s) no longer declare` | upstream が hook を撤去した | policy から該当 hook を削除 |
| `policy entry "X" … declare no install-time lifecycle script` / `matches no installed package` | policy 側の記録が不要になった | entry を削除 |

## 7. スコープ境界（何かを足さないこと）

- この gate は **install 時** の実行権限だけを扱う。version bump、
  patched dependency の内容、audit report (OSV / Dependabot) は別責務。
  version bump で `allow` 条目に drift が生じた場合は policy 更新という形で
  この gate の責務内に入る（更新前の code は CI の install で既に走っている）。
- **tool / 上流の変更は別 PR**（Issue 本文の明示条件）。
  本 Issue は「棚卸しと記録」までで、上流への patch 提案は含めない。
- policy の entry を増やすのは「実行することの妥当性」に対する
  レビューであって、gate 自身の黙示の免責ではない。
  記録を差し飾るために entry を足すことは frowned upon であり、
  review で必ず問われる。

## 参照

- [`AGENTS.md`](../../AGENTS.md) §2（stack / pnpm 12.3.x）/ §5（quality gate）
- [`quality/profile.yaml`](../../quality/profile.yaml)（`gates.fast` / `security_gates.install_script_audit`）
- [`quality/install-scripts.json`](../../quality/install-scripts.json)（判断記録）
- [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)（実行許可）
- [`docs/security.md`](../security.md)（security policy からの導線）
- [`ADR-0015`](../../docs/adr/ADR-0015-infisical-env-management.md)（secret SoT / `@infisical/cli` の位置づけ）
- [`ADR-0003`](../../docs/adr/ADR-0003-package-manager.md)（pnpm 採用の判断）