import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * TextLink — the only owner of inline-link affordance (ADR-0022 C-6,
 * layout-system.md §8).
 *
 * Direction B: a link is ink + underline, never a hue. `standalone`
 * gives a link its own line-level padding for use as a list-row or
 * card-level affordance; `inline` is for links inside prose.
 */

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	/**
	 * `standalone` adds block padding + radius for row/card usage;
	 * `chip` is the bordered pill affordance for handle/reference
	 * link groups (footer "elsewhere" rows, site-reference nav).
	 */
	variant?: 'inline' | 'standalone' | 'chip';
	children?: ReactNode;
}

export function TextLink({ variant = 'inline', className, children, ...rest }: TextLinkProps) {
	return (
		<a
			className={cx(
				css({
					color: 'text.accent',
					textDecoration: 'underline',
					textUnderlineOffset: '0.15em',
					_hover: { color: 'text.default' },
					_focusVisible: {
						outlineWidth: '2px',
						outlineStyle: 'solid',
						outlineColor: 'border.focus',
						outlineOffset: '2px',
						borderRadius: 'sm',
					},
					...(variant === 'standalone'
						? {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '2',
								paddingBlock: '2',
								paddingInline: '2',
								borderRadius: 'sm',
								_hover: { backgroundColor: 'bg.subtle', color: 'text.default' },
							}
						: {}),
					...(variant === 'chip'
						? {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '2',
								paddingBlock: '2',
								paddingInline: '4',
								borderRadius: 'full',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: 'border.subtle',
								fontFamily: 'sans',
								fontSize: 'sm',
								fontWeight: '600',
								_hover: { borderColor: 'border.strong' },
							}
						: {}),
				}),
				className,
			)}
			{...rest}
		>
			{children}
		</a>
	);
}
