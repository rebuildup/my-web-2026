import { describe, expect, it } from 'vitest';
import contractSource from './contract.ts?raw';
import publishSource from './publish.ts?raw';
import readerSource from './reader.ts?raw';

/**
 * The site has no runtime dependency on Notion (Issue #814).
 *
 * ADR-0018 §2.1 says the site reads; it never writes, never schedules,
 * and never calls the provider. That is a property of the import graph,
 * not of a comment, so it is asserted against the three modules a
 * request can reach under `src/portfolio/notion/`.
 *
 * What is checked, and why each one is the real risk:
 *
 *   1. **no `fetch(`** — a transport smuggled into the bundled module is
 *      how "build-time only" becomes a request-time dependency without
 *      any config change.
 *   2. **no token name** — reading `NOTION_TOKEN` from `env` would make
 *      Notion a runtime secret and a Worker binding, which ADR-0018 §2.9
 *      forbids.
 *   3. **no provider host** — the only endpoint the import step may
 *      know lives in `scripts/_notion-transport.mjs`.
 *
 * The read side is allowed to know the committed snapshot, because that
 * is a repository file Vite inlines; it is not a network call.
 *
 * A future module under this directory is not covered by this list.
 * When one is added, add it here: the point of the test is that the
 * directory's whole runtime surface is enumerated, not sampled.
 */
const RUNTIME_MODULES = [
	['contract.ts', contractSource],
	['publish.ts', publishSource],
	['reader.ts', readerSource],
] as const;

describe('portfolio notion runtime boundary (Issue #814)', () => {
	it('enumerates every module the request path can reach', () => {
		// reader imports the other two; listing all three keeps a new
		// export from slipping in beside them unnoticed.
		expect(readerSource).toContain("from './contract'");
		expect(readerSource).toContain("from './publish'");
		expect(RUNTIME_MODULES).toHaveLength(3);
	});

	it.each(RUNTIME_MODULES)('%s performs no network call', (_name, source) => {
		expect(source).not.toMatch(/\bfetch\s*\(/);
		expect(source).not.toMatch(/\bnew\s+URL\s*\(\s*['"]https?:/);
	});

	it.each(RUNTIME_MODULES)('%s reads no Notion credential', (_name, source) => {
		expect(source).not.toContain('NOTION_TOKEN');
		expect(source).not.toContain('NOTION_PORTFOLIO_DB_ID');
		expect(source).not.toMatch(/\benv\.NOTION/);
	});

	it.each(RUNTIME_MODULES)('%s does not know the provider endpoint', (_name, source) => {
		expect(source).not.toContain('api.notion.com');
		expect(source).not.toContain('/v1/databases');
		expect(source).not.toContain('/v1/data_sources');
	});
});
