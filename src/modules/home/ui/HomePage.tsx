import { css } from '../../../../styled-system/css';
import type { HomePageData } from '../model';
import { CapabilitiesSection } from './CapabilitiesSection';
import { Footer } from './Footer';
import { Hero } from './Hero';
import { SystemStatusSection } from './SystemStatusSection';

export interface HomePageProps {
	data: HomePageData;
}

/**
 * HomePage — top-level component for `GET /`.
 *
 * Renders the four canonical sections in order: hero, capabilities,
 * system status, footer. The loader-driven data is passed in by
 * the route file (`src/routes/index.tsx`) so the component stays
 * pure and easy to render in Storybook.
 */
export function HomePage({ data }: HomePageProps) {
	return (
		<>
			<a
				href="#main"
				className={css({
					position: 'absolute',
					left: '0',
					top: '0',
					padding: '2',
					backgroundColor: 'bg.canvas',
					color: 'text.default',
					textDecoration: 'none',
					transform: 'translateY(-200%)',
					_focusVisible: {
						transform: 'translateY(0)',
						outline: '2px solid {colors.border.focus}',
						outlineOffset: '2px',
					},
				})}
			>
				本文へスキップ
			</a>
			<Hero />
			<main id="main">
				<CapabilitiesSection capabilities={data.capabilities} />
				<SystemStatusSection
					services={data.services}
					statuses={data.statuses}
					observedAt={data.observedAt}
				/>
			</main>
			<Footer />
		</>
	);
}
