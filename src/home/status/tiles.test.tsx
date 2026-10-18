import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SystemService, SystemServiceStatus } from './health';
import { StatusTiles } from './tiles';

/**
 * StatusTiles — SSR smoke tests. Pure-render, no DOM.
 *
 * The observed-at line is the section's only instant, and it is the
 * surface Issue #430 moves onto the home format adapter: the same
 * snapshot has to read per locale, and it has to name the time zone
 * it was read in. The zone label is asserted against `Intl` itself
 * rather than a hard-coded abbreviation, because the short zone name
 * is CLDR data (`UTC`, `GMT+9`, `JST`, …) and changes between ICU
 * releases.
 *
 * The section body is unchanged by this ticket: the service rows,
 * their bindings, and the health badges are asserted here so a
 * locale change cannot quietly alter the operational readout.
 */

const OBSERVED_AT = '2026-01-05T09:00:00.000Z';

const services: readonly SystemService[] = [
	{
		id: 'external-boundary',
		label: 'External boundary',
		binding: 'Hono',
		description: 'Public REST endpoints at /api/v1/*.',
	},
	{
		id: 'd1',
		label: 'Internal data',
		binding: 'D1',
		description: 'Structured content queried via createServerFn.',
	},
];

const statuses: readonly SystemServiceStatus[] = [
	{ id: 'external-boundary', health: 'ok', detail: '/api/v1/* wired through src/http/hono.ts' },
	{ id: 'd1', health: 'degraded', detail: 'empty result set' },
];

/** The short time-zone label `Intl` produces for a zone in a locale. */
function zoneLabel(locale: string, timeZone: string): string {
	const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(
		new Date(OBSERVED_AT),
	);
	return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

describe('StatusTiles', () => {
	it('renders one row per service with its binding and health', () => {
		const html = renderToStaticMarkup(
			<StatusTiles services={services} statuses={statuses} observedAt={OBSERVED_AT} />,
		);
		expect(html).toContain('External boundary');
		expect(html).toContain('Hono');
		expect(html).toContain('Internal data');
		expect(html).toContain('D1');
		expect(html).toContain('reachable');
		expect(html).toContain('degraded');
	});

	it('renders the observed-at instant in UTC by default', () => {
		const html = renderToStaticMarkup(
			<StatusTiles services={services} statuses={statuses} observedAt={OBSERVED_AT} />,
		);
		expect(html).toContain('observed at');
		expect(html).toContain('Jan 5, 2026');
		expect(html).toContain(zoneLabel('en', 'UTC'));
	});

	it('reads the same instant per locale', () => {
		const en = renderToStaticMarkup(
			<StatusTiles services={services} statuses={statuses} observedAt={OBSERVED_AT} locale="en" />,
		);
		const ja = renderToStaticMarkup(
			<StatusTiles services={services} statuses={statuses} observedAt={OBSERVED_AT} locale="ja" />,
		);
		const ko = renderToStaticMarkup(
			<StatusTiles services={services} statuses={statuses} observedAt={OBSERVED_AT} locale="ko" />,
		);
		expect(en).toContain('Jan 5, 2026');
		expect(ja).toContain('2026/01/05');
		expect(ko).toContain('2026. 1. 5.');
		// Every locale names the zone the instant was read in.
		expect(en).toContain(zoneLabel('en', 'UTC'));
		expect(ja).toContain(zoneLabel('ja', 'UTC'));
		expect(ko).toContain(zoneLabel('ko', 'UTC'));
	});

	it('names the time zone the snapshot was read in', () => {
		const utc = renderToStaticMarkup(
			<StatusTiles services={services} statuses={statuses} observedAt={OBSERVED_AT} />,
		);
		const tokyo = renderToStaticMarkup(
			<StatusTiles
				services={services}
				statuses={statuses}
				observedAt={OBSERVED_AT}
				timeZone="Asia/Tokyo"
			/>,
		);
		expect(tokyo).toContain(zoneLabel('en', 'Asia/Tokyo'));
		expect(tokyo).not.toBe(utc);
		// 09:00 UTC is 18:00 in Tokyo — a different clock reading of
		// the same instant.
		expect(tokyo).toContain('6:00 PM');
	});
});
