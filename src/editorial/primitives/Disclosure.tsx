import type { DetailsHTMLAttributes, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * Disclosure — the owned progressive-disclosure primitive
 * (ADR-0022 C-5/C-8, layout-system.md §9).
 *
 * Native `<details>`/`<summary>`: the collapsed state is the default,
 * expansion is in-page and bounded by what the caller puts inside.
 * Long enumerations still belong on a dedicated index route — this
 * primitive is for summaries and secondary detail, not for hiding
 * the primary content of a page.
 */

export interface DisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
	/** Summary line — always visible. */
	summary: ReactNode;
	children?: ReactNode;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Disclosure({ summary, className, children, ...rest }: DisclosureProps) {
	return (
		<details
			className={cx(css({ borderTop: '1px solid', borderTopColor: 'border.subtle' }), className)}
			{...rest}
		>
			<summary
				className={css({
					paddingBlock: '4',
					cursor: 'pointer',
					fontWeight: '600',
					color: 'text.default',
					_hover: { color: 'text.muted' },
					_focusVisible: {
						outlineWidth: '2px',
						outlineStyle: 'solid',
						outlineColor: 'border.focus',
						outlineOffset: '2px',
						borderRadius: 'sm',
					},
				})}
			>
				{summary}
			</summary>
			<div className={css({ paddingBlockEnd: '4' })}>{children}</div>
		</details>
	);
}
