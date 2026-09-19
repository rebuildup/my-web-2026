import { css } from '../../styled-system/css';
import type { HomeCounterData } from './access/load';
import { CounterTile } from './access/tiles';
import type { Capability } from './capabilities/capability';
import { CapabilitiesGrid } from './capabilities/grid';
import { Footer } from './footer';
import { Hero } from './hero';
import type { SystemService, SystemServiceStatus } from './status/health';
import { StatusTiles } from './status/tiles';

export interface HomePageData {
	capabilities: readonly Capability[];
	services: readonly SystemService[];
	statuses: readonly SystemServiceStatus[];
	observedAt: string;
	counter: HomeCounterData;
}

export interface HomePageProps {
	data: HomePageData;
}

/**
 * Canonical composition for GET /.
 *
 * The route owns routing; this component owns the home reading order.
 * Individual sections keep their own change reasons below src/home/.
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
				<CapabilitiesGrid capabilities={data.capabilities} />
				<StatusTiles
					services={data.services}
					statuses={data.statuses}
					observedAt={data.observedAt}
				/>
				<CounterTile data={data.counter} />
			</main>
			<Footer />
		</>
	);
}
