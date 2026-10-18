import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../styled-system/css';
import type { HomeCounterData } from './access/load';
import { CounterTile } from './access/tiles';
import { HOME_LOCALES, createHomeFormat } from './format';
import { LOCALE_COMPARISON_ROWS } from './format.compare';

/**
 * Locale comparison — the preview surface for Issue #430.
 *
 * The home format adapter formats instants, counts, and relative
 * spans. This story renders **one** instant, **one** count, and
 * **one** set of relative spans in every locale the home advertises,
 * side by side, so a reviewer can see the difference without any
 * other issue landing and without a running Worker.
 *
 * The rows come from `src/home/format.compare.ts` — the same
 * fixture the static verification report is generated from, so the
 * story and the committed screenshot can never disagree.
 *
 * What the rows deliberately show:
 *
 *   - **One instant, three readings.** The instant is fixed
 *     (`2026-01-05T09:00:00Z`); only the locale and the time zone
 *     change. The clock reading moves with the zone; the instant does
 *     not.
 *   - **The typography differences.** `ko` writes a day period
 *     (오전), `ja` writes 24-hour, `en` writes 12-hour; `ja` and
 *     `ko` differ in how the unit is spaced.
 *   - **What does NOT differ.** Digit grouping is identical in all
 *     three locales today (`1,234,567`) — a recorded observation, not
 *     an assumption.
 *
 * The row marked "unit reference" is the only place a CLDR unit
 * (`Intl.NumberFormat` `style: 'unit'`) is rendered. No home surface
 * shows a quantity whose unit is a CLDR unit yet, so the adapter
 * deliberately does not wrap one; the row is here so the next
 * surface that needs a unit starts from rendered evidence instead of
 * a guess.
 */

const meta = {
	title: 'home/LocaleComparison',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The fixed clock the relative rows measure from. */
const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);

/** Counter data shared by the three locale previews below the table. */
const COUNTER: HomeCounterData = {
	key: 'home-page',
	count: 12_345,
	first_hit: Date.UTC(2026, 0, 1, 0, 0, 0),
	last_hit: NOW - 5 * 60_000,
	enabled: true,
};

function LocaleComparison() {
	return (
		<div
			className={css({
				padding: { base: '6', lg: '10' },
				display: 'flex',
				flexDirection: 'column',
				gap: '10',
				maxWidth: '1100px',
				marginInline: 'auto',
			})}
		>
			<header className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
					})}
				>
					Issue #430 — Intl date / number / unit formatting
				</span>
				<h2
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'xl',
						fontWeight: '700',
						color: 'text.default',
						lineHeight: '1.3',
					})}
				>
					One instant, three locales / 同一 instant・3 ロケール
				</h2>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
						lineHeight: '1.6',
						maxWidth: '70ch',
					})}
				>
					The values are the locale's own: the instant, the count, and the relative span are
					formatted by <code>Intl</code> through the home format adapter. The surrounding labels
					stay English until an approved translation exists — only the value is localised.
				</p>
			</header>

			<table
				className={css({
					width: '100%',
					borderCollapse: 'collapse',
					fontFamily: 'mono',
					fontSize: 'sm',
				})}
			>
				<thead>
					<tr>
						<th
							className={css({
								textAlign: 'left',
								padding: '2',
								color: 'text.muted',
								fontWeight: '400',
								verticalAlign: 'top',
							})}
						>
							Value
						</th>
						{HOME_LOCALES.map((locale) => (
							<th
								key={locale}
								className={css({
									textAlign: 'left',
									padding: '2',
									color: 'text.muted',
									fontWeight: '400',
									verticalAlign: 'top',
								})}
							>
								{locale}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{LOCALE_COMPARISON_ROWS.map((row) => (
						<tr key={row.label}>
							<th
								scope="row"
								className={css({
									textAlign: 'left',
									padding: '2',
									fontWeight: '400',
									color: 'text.default',
									verticalAlign: 'top',
									whiteSpace: 'nowrap',
								})}
							>
								{row.label}
								{row.note ? (
									<span
										className={css({
											display: 'block',
											color: 'text.muted',
											fontSize: 'xs',
										})}
									>
										{row.note}
									</span>
								) : null}
							</th>
							{HOME_LOCALES.map((locale) => (
								<td
									key={locale}
									className={css({
										padding: '2',
										color: 'text.default',
										verticalAlign: 'top',
										whiteSpace: 'nowrap',
									})}
								>
									{row.render(createHomeFormat({ locale, timeZone: row.timeZone, now: () => NOW }))}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>

			<section className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'lg',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					04 — Access counter, per locale
				</h3>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', md: 'repeat(3, 1fr)' },
						gap: '10',
					})}
				>
					{HOME_LOCALES.map((locale) => (
						<div
							key={locale}
							className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}
						>
							<span
								className={css({
									fontFamily: 'mono',
									fontSize: 'xs',
									color: 'text.muted',
									letterSpacing: '0.06em',
									textTransform: 'uppercase',
								})}
							>
								{locale}
							</span>
							<CounterTile data={COUNTER} locale={locale} now={() => NOW} />
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

export const Comparison: Story = {
	render: () => <LocaleComparison />,
};
