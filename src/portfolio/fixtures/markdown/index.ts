/**
 * Markdown regression fixtures (Issue #435).
 *
 * Two independent fixture files, one concern each:
 *
 *   - `technical-article.md` — a Japanese technical article written about
 *     the renderer's own boundary. Every sentence is a statement about
 *     `src/portfolio/markdown.lexer.ts` / `src/portfolio/load.ts`, so the
 *     "meaning survives rendering" assertions below check claims the
 *     repository itself can verify. Nothing personal, no measurement, no
 *     forecast: a fixture that asserts a fabricated number would only prove
 *     that the renderer copies text faithfully, not that the claim is true.
 *   - `hostile.md` — script / event-handler / dangerous-scheme payloads.
 *     It is an input, not an article; it must render as inert text.
 *
 * `.md?raw` is a Vite loader, so these fixtures load in the workerd test
 * pool and in the Storybook preview without a second copy of the text. The
 * `node scripts/markdown-format-report.mjs` generator reads the same two
 * files from disk, which keeps one source of truth for the CI fixture, the
 * preview, and the committed verification artefact.
 *
 * Both files are also the documented "unsupported syntax" surface: the
 * constructs that are NOT implemented are written into the article itself
 * so the literal-text degradation is visible to a reader, not only asserted
 * in a test.
 */

import hostileSource from './hostile.md?raw';
import technicalArticleSource from './technical-article.md?raw';

/** The supported-syntax sample article. Renders without losing any line. */
export const TECHNICAL_ARTICLE_MD: string = technicalArticleSource;

/** The hostile sample. Every payload must survive as inert, visible text. */
export const HOSTILE_MD: string = hostileSource;
