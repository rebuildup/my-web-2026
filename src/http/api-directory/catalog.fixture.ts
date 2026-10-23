import type { TableColumn } from '../../editorial/table-code';

/**
 * The published API directory columns — Issue #530.
 *
 * Why this data lives in a `.ts` fixture rather than in the story
 * ----------------------------------------------------------------
 * The column declaration is an array of object literals whose keys
 * (`key`, `label`) are also readable as CSS property names. Panda's
 * extractor reads object literals in a `.tsx` source loosely, so
 * writing them next to the JSX that renders them produced real rules
 * in the generated stylesheet — `.key_endpoint { key: endpoint }`,
 * and, because an array is read as a responsive condition list,
 * `.sm:key_auth`, `.md:key_rateLimit`, `.lg:key_purpose` — all of
 * which a browser drops. `scripts/check-css-syntax.test.mjs` fails on
 * exactly that, with the message that the rule "silently does less
 * than it reads".
 *
 * A `.ts` module is extracted narrowly, which is the same reason
 * `src/editorial/table-code.fixture.ts` exists: the data is data, and
 * only the component file carries style vocabulary.
 *
 * The keys are deliberately not HTML-attribute-like either — see the
 * `TableColumn` doc in `src/editorial/table-code.tsx` for why `key`
 * and `label` were chosen over `id` and `header`.
 */
export const ENDPOINT_COLUMNS: readonly TableColumn[] = [
	{ key: 'endpoint', label: 'Endpoint' },
	{ key: 'auth', label: '認証' },
	{ key: 'rateLimit', label: 'Rate limit' },
	{ key: 'purpose', label: '責務 / 利用例' },
];
