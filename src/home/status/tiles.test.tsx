import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SystemService, SystemServiceHealth, SystemServiceStatus } from './health';
import { HEALTH_LABEL } from './health';
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
 *
 * Issue #411 adds the last block: the health badge must stay
 * separable when hue is removed. `ok` used to be the only accented
 * pill and both failure states shared one neutral fill, so in
 * greyscale the three states were three identical rounded
 * rectangles. The tests assert the two channels that survive
 * greyscale — a silhouette unique per health, and the existing word
 * — and that the silhouette is decorative.
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

	describe('health is never encoded by fill alone (Issue #411)', () => {
		const allHealths: readonly SystemServiceHealth[] = ['ok', 'degraded', 'unreachable'];
		const oneService: readonly SystemService[] = [
			{ id: 'd1', label: 'Internal data', binding: 'D1', description: 'Internal data.' },
		];

		it('gives every health its own silhouette', () => {
			const rendered = allHealths.map((health) =>
				renderToStaticMarkup(
					<StatusTiles
						services={oneService}
						statuses={[{ id: 'd1', health }]}
						observedAt={OBSERVED_AT}
					/>,
				),
			);
			// One silhouette per health, and no two share it: this is
			// the property that survives greyscale / forced colours.
			const marks = rendered.map((html) => html.match(/data-state-mark="([^"]+)"/)?.[1]);
			expect(marks).toEqual([...allHealths]);
			expect(new Set(marks).size).toBe(allHealths.length);
		});

		it('keeps the word beside the silhouette', () => {
			for (const health of allHealths) {
				const html = renderToStaticMarkup(
					<StatusTiles
						services={oneService}
						statuses={[{ id: 'd1', health }]}
						observedAt={OBSERVED_AT}
					/>,
				);
				expect(html).toContain(`data-state-mark="${health}"`);
				expect(html).toContain(HEALTH_LABEL[health]);
			}
		});

		it('keeps the silhouette decorative so the word stays the accessible name', () => {
			const html = renderToStaticMarkup(
				<StatusTiles services={services} statuses={statuses} observedAt={OBSERVED_AT} />,
			);
			expect(html).toContain('<svg aria-hidden="true" data-state-mark="ok"');
			expect(html).toContain('<svg aria-hidden="true" data-state-mark="degraded"');
		});

		it('falls back to the unreachable silhouette when a service has no read', () => {
			// The empty snapshot is a real state: a service whose probe
			// returned nothing must not look healthy, and it must say so
			// in the same two channels as every other state.
			const html = renderToStaticMarkup(
				<StatusTiles services={services} statuses={[]} observedAt={OBSERVED_AT} />,
			);
			expect(html).toContain('data-state-mark="unreachable"');
			expect(html).toContain(HEALTH_LABEL.unreachable);
		});
	});
});
