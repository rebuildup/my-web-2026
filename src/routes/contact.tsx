import { createFileRoute } from '@tanstack/react-router';
import { getVisibleChannels } from '../contact/public';
import { ContactPage } from '../contact/page';

/**
 * `/contact` route (Issue #103).
 *
 * Per the contact-surface decision doc in `docs/decisions/` (see
 * the issue-ticket for the file name; the release-trunk slug in
 * the filename is not a current-version claim). Decision §「/contact」:
 *
 *   - Lists only channels that are currently `active` AND whose
 *     `verified_at` is inside the freshness window (30 days).
 *   - The list is fail-closed: an unverified channel MUST NOT
 *     appear, even if it lives in `channels.json`.
 *   - No pricing / commission / shop affordance.
 *   - No form submit (no backend endpoint).
 *
 * The data layer (`src/contact/public.ts`) is the sole place that
 * reads `channels.json` and runs the gate. The route only calls
 * `getVisibleChannels(now)` once and passes the result through the
 * loader.
 */
export const Route = createFileRoute('/contact')({
	loader: async () => {
		const now = Date.now();
		const channels = getVisibleChannels(now);
		return { channels, now, empty: channels.length === 0 };
	},
	head: () => {
		const title = 'Contact — rebuildup.dev';
		const description =
			'現在 re-verified されている contact channel だけを掲載しています。Channel は用途 (採用 / 技術的な議論 / 配布) 別に明示しています。';
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: 'https://rebuildup.dev/contact' },
			],
			links: [{ rel: 'canonical', href: 'https://rebuildup.dev/contact' }],
		};
	},
	component: ContactRoute,
});

function ContactRoute() {
	const { channels, now, empty } = Route.useLoaderData();
	return <ContactPage channels={channels} now={now} empty={empty} />;
}
