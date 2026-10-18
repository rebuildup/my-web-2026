import { css } from '../../../../styled-system/css';
import { CJK_MODES, CjkLineBreakShowcase } from '../../../editorial/cjk-line-break';

/**
 * CJK line-break verification blocks — the `/design-system` mirror of
 * the Issue #431 fixture.
 *
 * The showcase renders the three opt-in levels in sequence
 * (shipped default → `lang` → `lang` + CJK typography) so a reader
 * can diff them without leaving the page, and
 * `scripts/cjk-line-break-measure.mjs` measures the very same DOM:
 * the wrapper carries `data-cjk-showcase`, and each locale wrapper
 * carries `data-cjk-sample` / `data-cjk-mode` / `lang`.
 *
 * The copy is verification copy (see `src/editorial/cjk-line-break.tsx`
 * for the full contract): no product facts, and no published text is
 * changed by rendering it here.
 */
export function CjkLineBreak() {
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '10' })}>
			{CJK_MODES.map((spec) => (
				<CjkLineBreakShowcase key={spec.mode} spec={spec} />
			))}
		</div>
	);
}
