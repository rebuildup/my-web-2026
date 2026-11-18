# Inclusive Design References

Last reviewed: 2026-09-13

この reference は inclusive design を accessibility checklist や empathy exercise に縮退させず、**exclusion / capability demand / lived experience / multiple participation paths** を観察するために使う。

個々の framework の terminology や diagram をそのまま current product へコピーしない。複数 source を比較し、現在の task / environment / user evidence に翻訳する。

## Microsoft Inclusive Design

- [Microsoft Inclusive Design](https://inclusive.microsoft.design/)
  - Observe: `Recognize exclusion` / `Learn from diversity` / `Solve for one, extend to many` が一連の method としてどう接続されているか。
  - Useful for: exclusion を人の欠陥ではなく design interaction の問題として捉え直す初期 framing。
  - Avoid: Microsoft 固有の diagram / persona spectrum を universal taxonomy として固定すること。

- [Inclusive 101 Guidebook](https://inclusive.microsoft.design/articles/inclusive-101-guidebook)
  - Observe: accessibility を product の attribute、inclusive design を method として区別する点。permanent / temporary / situational constraints、persona spectrum、mismatch の framing。
  - Useful for: capability diversity を設計変数へ変換し、specific exclusion から broader transfer を検討するとき。
  - Avoid: permanent / temporary / situational の例を「同じ人・同じ need」と同一視すること。simulation や spectrum だけで lived experience を理解したと扱わない。

- [Designing inclusive software in Windows](https://learn.microsoft.com/en-us/windows/apps/design/accessibility/designing-inclusive-software)
  - Observe: product lifecycle の早期から inclusion を扱うこと、target audience を functional terms で定義すること、telemetry と direct conversations が異なる evidence を提供すること。
  - Useful for: software / application flow に inclusive-design method を適用するとき。
  - Avoid: Windows-specific API や component rule を cross-platform design principle としてコピーすること。

## Production / co-design evidence

- [Microsoft Inclusive Tech Lab](https://www.microsoft.com/en-us/inclusive-tech-lab/)
  - Observe: people with disabilities を design process の中心へ置き、workshop / sprint / prototyping を通じて継続的に co-design する運用。
  - Useful for: disabled participants を final validation だけでなく problem framing / iteration へ含める方法を考えるとき。
  - Avoid: Lab 自体の設備や hardware を inclusion の必須条件とみなすこと。

- [Surface Adaptive Kit — Microsoft Japan](https://news.microsoft.com/ja-jp/features/211208-surface-adaptive-kit/)
  - Observe: disability community との collaboration、Inclusive Design Sprint、beta testing から具体的な physical adaptation へ至る流れ。
  - Useful for: specific participation barrier を targeted accommodation へ変換する production example。
  - Avoid: product-specific sticker / marker / hardware form を current artifact にそのまま転用すること。

## Capability demand / design exclusion

- [University of Cambridge Engineering Design Centre — Inclusive Design](https://www-edc.eng.cam.ac.uk/research/inclusive-design)
  - Observe: product / service が要求する capability と population diversity の mismatch を design exclusion として扱う framing。
  - Useful for: current task が vision / hearing / dexterity / cognition 等にどの程度の demand を課しているかを分析するとき。
  - Avoid: capability measurement を individual diagnosis や deterministic persona score として使うこと。

- [Inclusive Design Toolkit](https://www-edc.eng.cam.ac.uk/sites/default/files/idtoolkit_0.pdf)
  - Observe: capability demand、design exclusion、population diversity、evaluation を systematic に接続する established framework。
  - Useful for: exclusion matrix や capability-demand review の観点を増やすとき。
  - Avoid: historical toolkit 内の数値・population model を current project の universal threshold として無検証で使うこと。

## W3C WAI — user involvement and evaluation

- [Involving Users in Web Projects for Better, Easier Accessibility](https://www.w3.org/WAI/planning/involving-users/)
  - Observe: people with disabilities を early / throughout the project に含めること、既存 product や workaround を聞くこと、standards と user involvement の役割分担。
  - Useful for: research / co-design / prototype review の参加計画。
  - Avoid: user involvement が standards-based accessibility work を置換すると考えること。

- [Involving Users in Evaluating Web Accessibility](https://www.w3.org/WAI/test-evaluate/involving-users/)
  - Observe: real users が technical evaluation では見つかりにくい usability issue を発見できる一方、一人の participant の experience を disability population 全体へ一般化できないという注意。
  - Useful for: final task trial、evidence interpretation、remaining limitation の記録。
  - Avoid: 少人数 user test の成功を conformance / universal accessibility の証明にすること。

## GOV.UK — service-level responsibility

- [GOV.UK Design System — Accessibility strategy](https://design-system.service.gov.uk/accessibility/accessibility-strategy/)
  - Observe: Design System の component を使用するだけでは service 全体の accessibility を保証できないこと、flexibility / tolerance for error / low physical and cognitive effort 等を service design へ適用する考え方。
  - Useful for: component-level compliance から end-to-end service participation へ視野を広げるとき。
  - Avoid: universal-design principle を「一つの solution が全員へ等しく適する」という意味に読み替えること。

## Comparison axes

複数 reference を横断するときは次を比較する。

- exclusion の unit: individual impairment / interaction / task / environment / service のどこを見るか
- capability demand: どの能力・環境条件を暗黙に要求しているか
- user involvement: consultation / evaluation / co-design のどの段階か
- alternative participation: equivalent path / adaptation / personalization / helper support のどれか
- evidence: direct lived experience / observation / telemetry / standards / heuristic の区別
- transfer: specific accommodation が broader audience にどう作用するか
- remaining exclusion: solution 後にも誰が参加できないか

## Failure modes to look for

- accessibility を component checklist だけで完了扱いする
- disability label や demographic から具体的 ability を推測する
- simulation や persona だけで user research を置換する
- 一人の participant の preference を population 全体へ一般化する
- permanent / temporary / situational constraint を identical need として扱う
- alternative path が primary goal へ到達できない degraded fallback になっている
- targeted accommodation を broader appeal のために弱める
- telemetry から barrier の原因まで推測し、直接 evidence を取らない
- standards を user testing の代わりにする、または user testing を standards の代わりにする
