import { createFileRoute } from '@tanstack/react-router';
import { css } from '../../styled-system/css';
import { getContactChannels } from '../contact/load';
import { ContactPage } from '../contact/page';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { Container } from '../editorial/primitives/Container';
import { PrivacyNoticeCompact } from '../home/privacy-notice-compact';
import { getCompactPrivacyNotice } from '../home/privacy/load';
import { getHomeReactions } from '../home/public';
import { ReactionsWidget } from '../home/reactions/widget';

/**
 * `/contact` route (Issue #103, Issue #199).
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
 * `getContactChannels()` once and passes the projected
 * loader.
 *
 * Chrome convention (Issue #199). The `<PublicNav />`,
 * `<Breadcrumbs />`, and `<BreadcrumbJsonLd />` components are
 * imported and rendered here explicitly rather than mounted at the
 * `__root` level — see `src/routes/about.tsx` for the rationale.
 */
export const CONTACT_REACTIONS_TARGET = 'contact-page';

export const Route = createFileRoute('/contact')({
	loader: async () => {
		const { channels, unverifiableCount } = await getContactChannels();
		const [reactions, privacyNotice] = await Promise.all([
			getHomeReactions({ data: { target: CONTACT_REACTIONS_TARGET } }),
			// Issue #370 — compact data-notice pointer for the reaction
			// surface below (see `src/routes/about.tsx`).
			getCompactPrivacyNotice(),
		]);
		return {
			channels,
			empty: channels.length === 0,
			unverifiableCount,
			reactions,
			privacyNotice,
		};
	},
	head: () => {
		const title = 'Contact — rebuildup.dev';
		const description =
			'現在 re-verified されている contact channel だけを掲載しています。Channel は用途別に明示しています。';
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
	const { channels, empty, unverifiableCount, reactions, privacyNotice } = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<ContactPage channels={channels} empty={empty} unverifiableCount={unverifiableCount} />
			<ReactionsWidget data={reactions} />
			{/* Issue #1298 — the page must close on the contact contract,
			    not on a padded legal band: the notice renders as one
			    muted line (`bare`) inside the canonical container. */}
			<div className={css({ paddingBlock: '8' })}>
				<Container>
					<PrivacyNoticeCompact {...privacyNotice} bare />
				</Container>
			</div>
		</>
	);
}
