import { css } from '../../../../styled-system/css';
import { Breakout } from '../../../editorial/primitives/Breakout';
import { Grid, GridItem } from '../../../editorial/primitives/Grid';
import { Overlap, OverlapLayer } from '../../../editorial/primitives/Overlap';
import { Panel } from '../../../editorial/primitives/Panel';

/**
 * Composition primitives showcase (ADR-0023 §3). Demonstrates the
 * vocabulary the page-level contract now allows: the 12-track
 * asymmetric grid, the declared measure breakout and figure/ground
 * overlap. Storybook counterpart:
 * `src/editorial/primitives/composition.stories.tsx`.
 */
export function Composition() {
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '10' })}>
			<Grid template="12" gap="4">
				<GridItem span={{ base: 12, md: 12, lg: 7 }}>
					<Panel variant="subtle" padding="6">
						<div className={css({ fontSize: 'lg', fontWeight: 'bold' })}>
							非対称グリッド — lead block (span 7)
						</div>
						<p className={css({ margin: '2 0 0', fontSize: 'sm', color: 'text.muted' })}>
							Grid template=&quot;12&quot; + GridItem の span / start で、
							等分でない構図を宣言的に組みます。base は常に全幅で、 mobile は自動的に 1
							カラムへ再編成されます。
						</p>
					</Panel>
				</GridItem>
				<GridItem span={{ base: 12, md: 12, lg: 4 }} start={{ lg: 8 }}>
					<Panel variant="surface" padding="6">
						<div className={css({ fontSize: 'lg', fontWeight: 'bold' })}>
							Offset rail (span 4 / start 8)
						</div>
						<p className={css({ margin: '2 0 0', fontSize: 'sm', color: 'text.muted' })}>
							start でトラックをずらし、lead との間に意図的な余白を置きます。
						</p>
					</Panel>
				</GridItem>
				<GridItem span={{ base: 12, md: 12, lg: 3 }} start={{ lg: 10 }}>
					<Panel variant="subtle" padding="6">
						<div className={css({ fontSize: 'lg', fontWeight: 'bold' })}>注記</div>
						<p className={css({ margin: '2 0 0', fontSize: 'sm', color: 'text.muted' })}>
							span 3 / start 10 — 小さな補助情報を脇へ逃がす配置です。
						</p>
					</Panel>
				</GridItem>
			</Grid>

			<Breakout variant="wide">
				<Panel variant="subtle" padding="1">
					<div
						className={css({
							aspectRatio: '21 / 9',
							backgroundColor: 'bg.subtle',
							display: 'grid',
							placeItems: 'center',
							color: 'text.muted',
							fontSize: 'sm',
						})}
					>
						Breakout — canonical measure (1024px) を意図的に逸脱する宣言的手段
					</div>
				</Panel>
			</Breakout>

			<Grid template="12" gap="4">
				<GridItem span={{ base: 12, lg: 7 }}>
					<Overlap>
						<OverlapLayer align="stretch" justify="stretch">
							<Panel variant="subtle" padding="1">
								<div
									className={css({
										aspectRatio: '4 / 3',
										backgroundColor: 'bg.subtle',
										display: 'grid',
										placeItems: 'center',
										color: 'text.muted',
									})}
								>
									figure layer
								</div>
							</Panel>
						</OverlapLayer>
						<OverlapLayer align="end" justify="start">
							<div
								className={css({
									padding: '3',
									backgroundColor: 'bg.surface',
									borderRadius: 'sm',
									fontSize: 'sm',
								})}
							>
								caption layer — 同一セルに重なり、DOM 順で読み順を維持
							</div>
						</OverlapLayer>
					</Overlap>
				</GridItem>
				<GridItem span={{ base: 12, lg: 4 }} start={{ lg: 9 }}>
					<Panel variant="surface" padding="6">
						<div className={css({ fontSize: 'lg', fontWeight: 'bold' })}>
							Overlap — figure / ground
						</div>
						<p className={css({ margin: '2 0 0', fontSize: 'sm', color: 'text.muted' })}>
							OverlapLayer は同一グリッドセルを共有します。position / z-index は公開せず、align /
							justify の宣言だけで重なりを表現します。
						</p>
					</Panel>
				</GridItem>
			</Grid>
		</div>
	);
}
