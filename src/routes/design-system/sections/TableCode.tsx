import { css } from '../../../../styled-system/css';
import { TableCodeFixture } from '../../../editorial/table-code';

/**
 * Table / code readability — the `/design-system` mirror of the
 * Issue #407 fixture.
 *
 * The section renders the shipped fixture itself rather than a copy of
 * it, so the public screen and the Storybook story and the Chromium
 * capture (`scripts/capture-a11y-table-code.mjs`) are the same DOM.
 *
 * At 375 px the four fixture states are where the Issue's completion
 * condition is visible: each table and each code block keeps its scroll
 * inside its own box, so the page itself never scrolls sideways, and
 * the caption plus `scope` keep the structure available to assistive
 * technology.
 *
 * The copy is verification copy — public WCAG 2.2 criterion names and
 * what the shipped component provides for each. No product fact.
 */
export function TableCode() {
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '10' })}>
			<TableCodeFixture />
		</div>
	);
}
