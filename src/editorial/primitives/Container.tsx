import type { ElementType, PropsWithChildren } from 'react';
import { css, cx } from '../../../styled-system/css';

export interface ContainerProps {
	/**
	 * Override the rendered tag. Use a semantic landmark
	 * (`section`, `header`, `footer`) when wrapping a logical
	 * region so the surrounding landmarks remain correct.
	 */
	as?: ElementType;
	className?: string;
}

/**
 * Container — page-width wrapper.
 *
 * Establishes the shared coordinate system used by the Marketing
 * layout family: a single max-width with responsive horizontal
 * page-margin that scales across the existing breakpoints.
 *
 * Use this as the outermost wrapper of any page section that should
 * participate in the shared grid. Feature-local containers (e.g. a
 * capability grid that needs a wider canvas) define their own
 * max-width and must not use this primitive for that purpose.
 */
export function Container({ as, children, className }: PropsWithChildren<ContainerProps>) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			className={cx(
				css({
					width: '100%',
					maxWidth: '1024px',
					marginInline: 'auto',
					paddingInline: { base: '4', md: '6', lg: '8' },
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}
