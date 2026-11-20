import type { DetailsHTMLAttributes, ReactNode, Ref } from 'react';
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

export interface DisclosureProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'open'> {
	/** Summary line — always visible. */
	summary: ReactNode;
	children?: ReactNode;
	/**
	 * Element ref. Callers that need to toggle `open` after
	 * hydration (e.g. a viewport-dependent initial state) use this
	 * instead of the `open` prop, whose SSR serialization the HTML
	 * standards gate rejects (`open=""` is a bad value).
	 */
	ref?: Ref<HTMLDetailsElement>;
}

export function Disclosure({ summary, className, children, ref, ...rest }: DisclosureProps) {
	return (
		<details
			ref={ref}
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
