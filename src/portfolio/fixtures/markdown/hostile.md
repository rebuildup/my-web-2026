# 危険な入力 fixture

このファイルは「表示されない」ことをアサートするための入力であって、読むための記事ではない。`markdown.safety.test.tsx` が `PortfolioMarkdown` に通し、生成された HTML に実行可能な要素・属性・URL が 1 つも無いことを検査する。文字列は inert なテキストとして画面に残る。

<script>alert(1)</script>

<img src=x onerror="alert(1)">

<svg/onload=alert(1)>

<iframe src="https://example.com/frame"></iframe>

<a href="javascript:alert(1)">raw anchor</a>

[link](javascript:alert(1))

[link](JaVaScRiPt:alert(1))

[link]( javascript:alert(1) )

[link](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

[link](vbscript:msgbox(1))

[link](file:///etc/passwd)

[quote breakout](https://example.com/"onmouseover="alert(1))

[external](https://example.com/safe)

[internal](/portfolio)

> 引用の中の <script>alert(2)</script> も inert。

```html
<script>alert(3)</script>
```