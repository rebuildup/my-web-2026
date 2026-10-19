import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	CodeBlock,
	DataTable,
	TABLE_CODE_CASE_IDS,
	TableCodeFixture,
	cellText,
} from './table-code';

/**
 * table-code contract tests (Issue #407).
 *
 * Static markup, no DOM: same reason as `StateMark.test.tsx` — the
 * workerd pool has no `document` to query, and these components need
 * nothing but `react-dom/server`. What a browser actually does with
 * the markup (does arrow-key scrolling move the region, does the
 * document stay viewport-wide at 375 px) is measured by
 * `scripts/capture-a11y-table-code.mjs`, not asserted here.
 *
 * What these assertions can and cannot prove:
 *
 *   - CAN: every rendered table carries a caption, every header cell
 *     carries a scope, every scroll box is a focusable named region,
 *     and all four fixture states render in every state.
 *   - CANNOT: that the caption text reads well, that the colour
 *     contrast is sufficient, or that a screen reader announces the
 *     table as intended. Those are human evaluations and are listed
 *     as such in `scripts/check-table-code-a11y.mjs` and
 *     `docs/verification/a11y/table-code.md`.
 */

const COLUMNS = [
	{ id: 'sc', header: 'Success criterion' },
	{ id: 'level', header: 'Level' },
	{ id: 'provided', header: 'What it provides' },
] as const;

const ROWS = [
	{
		id: 'reflow',
		header: '1.4.10 Reflow',
		cells: { level: 'AA', provided: 'The scroll box is the widest element.' },
	},
	{
		id: 'keyboard',
		header: '2.1.1 Keyboard',
		cells: { level: 'A', provided: 'Each scroll box is a focusable region.' },
	},
] as const;

function attrsOf(html: string, attribute: string): string[] {
	return [...html.matchAll(new RegExp(`${attribute}="([^"]*)"`, 'g'))].map((match) => match[1]);
}

describe('DataTable — structure a screen reader can use', () => {
	it('names the scroll region with the table caption (SC 1.3.1, SC 2.4.6)', () => {
		const html = renderToStaticMarkup(
			<DataTable caption="Success criteria" columns={COLUMNS} rows={ROWS} />,
		);

		const captionId = /<caption id="([^"]*)"/.exec(html)?.[1];
		expect(captionId).toBeTruthy();
		expect(html).toContain('>Success criteria</caption>');
		expect(html).toContain(`aria-labelledby="${captionId}"`);
	});

	it('scopes every header cell so row and column relations are announced', () => {
		const html = renderToStaticMarkup(
			<DataTable caption="Success criteria" columns={COLUMNS} rows={ROWS} />,
		);

		expect(attrsOf(html, 'scope')).toEqual(['col', 'col', 'col', 'row', 'row']);
	});

	it('renders the row header column before the data cells', () => {
		const html = renderToStaticMarkup(
			<DataTable caption="Success criteria" columns={COLUMNS} rows={ROWS} />,
		);

		expect(html).toContain('<th scope="row" data-column="sc"');
		expect(html.indexOf('>1.4.10 Reflow</th>')).toBeLessThan(html.indexOf('>AA<'));
	});

	it('exposes the scroll box as a focusable region (SC 2.1.1)', () => {
		const html = renderToStaticMarkup(
			<DataTable caption="Success criteria" columns={COLUMNS} rows={ROWS} />,
		);

		// A named `<section>` is exposed as a `region` landmark
		// (HTML-AAM); the raw `role` attribute would be redundant.
		const scroll = /<section[^>]*data-table-scroll[^>]*>/.exec(html)?.[0] ?? '';
		expect(scroll).toContain('tabindex="0"');
		expect(scroll).toContain('aria-labelledby=');
	});

	it('keeps the header row in the empty state so the structure is still announced', () => {
		const html = renderToStaticMarkup(
			<DataTable caption="Success criteria" columns={COLUMNS} rows={[]} state="empty" />,
		);

		expect(html).toContain('data-table-state="empty"');
		expect(html.match(/<th scope="col"/g)).toHaveLength(3);
		expect(html).toContain('No rows to show yet.');
		expect(html).toContain('colSpan="3"');
		expect(html).not.toContain('<th scope="row"');
	});

	it('replaces the data rows with one full-width message in the failure state', () => {
		const html = renderToStaticMarkup(
			<DataTable
				caption="Success criteria"
				columns={COLUMNS}
				rows={ROWS}
				state="error"
				errorMessage="The read failed."
			/>,
		);

		expect(html).toContain('data-table-state="error"');
		expect(html).toContain('The read failed.');
		expect(html).not.toContain('1.4.10 Reflow');
		expect(html).toContain('colSpan="3"');
	});

	it('marks the compact variant so the narrow-width state is observable', () => {
		const html = renderToStaticMarkup(
			<DataTable caption="Success criteria" columns={COLUMNS} rows={ROWS} compact />,
		);

		expect(html).toContain('data-table-compact="true"');
		expect(html).toContain('scope="row"');
	});

	it('renders a missing cell value as an em dash, not an empty cell', () => {
		expect(cellText({ id: 'r', header: 'h', cells: {} }, 'level')).toBe('—');
		expect(cellText({ id: 'r', header: 'h', cells: { level: '' } }, 'level')).toBe('—');
		expect(cellText({ id: 'r', header: 'h', cells: { level: 'AA' } }, 'level')).toBe('AA');
	});
});

describe('CodeBlock', () => {
	it('names the scroll box with the visible label (SC 2.4.6)', () => {
		const html = renderToStaticMarkup(<CodeBlock label="Sample markup" code="const a = 1;" />);

		const labelId = /<p id="([^"]*)" data-code-label/.exec(html)?.[1];
		expect(labelId).toBeTruthy();
		expect(html).toContain('>Sample markup</p>');
		expect(html).toContain(`aria-labelledby="${labelId}"`);
	});

	it('exposes the code scroll box as a focusable region (SC 2.1.1)', () => {
		const html = renderToStaticMarkup(
			<CodeBlock label="Sample markup" code="const a = 1;" language="tsx" />,
		);

		const scroll = /<section[^>]*data-code-scroll[^>]*>/.exec(html)?.[0] ?? '';
		expect(scroll).toContain('tabindex="0"');
		expect(scroll).toContain('aria-labelledby=');
		expect(scroll).toContain('data-language="tsx"');
	});

	it('adds no visible text of its own when the caller owns none', () => {
		// `src/portfolio/markdown.safety.test.tsx` forbids a renderer from
		// publishing text the source document did not contain, so an
		// unlabelled code block must contribute nothing but attributes.
		const html = renderToStaticMarkup(<CodeBlock code="const a = 1;" />);

		expect(html).not.toContain('data-code-label');
		expect(html).not.toContain('aria-labelledby');
		expect(html).toContain('data-named="none"');
		const scroll = /<section[^>]*data-code-scroll[^>]*>/.exec(html)?.[0] ?? '';
		expect(scroll).toContain('tabindex="0"');
	});

	it("names the region from the author's own fence token when no label is given", () => {
		const html = renderToStaticMarkup(<CodeBlock code="const a = 1;" language="tsx" />);

		const scroll = /<section[^>]*data-code-scroll[^>]*>/.exec(html)?.[0] ?? '';
		expect(scroll).toContain('aria-label="tsx"');
		expect(scroll).toContain('data-named="language"');
		expect(html).not.toContain('data-code-label');
	});

	it('keeps the code text byte-exact inside a pre/code pair', () => {
		const code = 'const table = <DataTable\n\tcaption="x"\n/>;';
		const html = renderToStaticMarkup(<CodeBlock label="Sample markup" code={code} />);

		// React escapes `<`, `>` and `"` in text children; the point of
		// the assertion is that the CODE ITSELF is untouched (same tabs,
		// same newlines, same characters) rather than reformatted.
		const escaped = code
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
		expect(html).toContain(`<code>${escaped}</code>`);
	});
});

describe('TableCodeFixture — the four states the Issue names', () => {
	const html = renderToStaticMarkup(<TableCodeFixture />);

	it('renders exactly the four case ids, in order', () => {
		const rendered = [...html.matchAll(/data-case="([^"]*)"/g)].map((match) => match[1]);
		expect(rendered).toEqual([...TABLE_CODE_CASE_IDS]);
	});

	it('renders a table and a code block in every state', () => {
		for (const id of TABLE_CODE_CASE_IDS) {
			const caseHtml = html.slice(html.indexOf(`data-case="${id}"`));
			expect(caseHtml.slice(0, caseHtml.indexOf('</section>'))).toContain('data-table-scroll');
		}
		expect(html.match(/data-code-scroll/g)).toHaveLength(TABLE_CODE_CASE_IDS.length);
	});

	it('gives every table a caption, in every state', () => {
		expect(html.match(/<caption/g)).toHaveLength(TABLE_CODE_CASE_IDS.length);
		expect(html.match(/aria-labelledby=/g)).toHaveLength(TABLE_CODE_CASE_IDS.length * 2);
	});

	it('renders the ok / empty / error / compact states distinctly', () => {
		expect(html).toContain('data-table-state="ok"');
		expect(html).toContain('data-table-state="empty"');
		expect(html).toContain('data-table-state="error"');
		expect(html).toContain('data-table-compact="true"');
	});
});
