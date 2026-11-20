import type { TableColumn } from '../../editorial/table-code';

/**
 * Column declaration for the Biome settings `DataTable` on `/stack`
 * (Issue #382).
 *
 * This lives in a `.ts` module — never inline in `StackPage.tsx` —
 * on purpose: Panda's extractor treats object literals in `tsx`
 * files as style candidates and would ship `key:` / `label:` as
 * bogus CSS declarations (the same trap `table-code.tsx` documents
 * for `{ id, header }`). A `.ts` module-level literal is data, not a
 * style candidate — the same reason `table-code.fixture.ts` keeps its
 * `TABLE_CODE_COLUMNS` here-shaped.
 */
export const BIOME_SETTINGS_COLUMNS: readonly TableColumn[] = [
	{ key: 'setting', label: '設定' },
	{ key: 'value', label: '値' },
];
