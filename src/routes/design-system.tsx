import { createFileRoute } from '@tanstack/react-router';
import { PublicNav } from '../editorial/nav';
import { DesignSystemPage } from './design-system/DesignSystemPage';

/**
 * `/design-system` — editorial design-system showcase page (Issue #181, Issue #199).
 *
 * Sits at `src/routes/design-system.tsx` per the TanStack Start file-route
 * convention (the colocated `src/routes/design-system/` directory holds
 * the page composition + section components and does not collide with
 * the auto-router because only `*.tsx` files at the routes root become
 * routes — subdirectory files are inert).
 *
 * The route is a thin shell: it owns the head metadata and delegates
 * rendering to `DesignSystemPage`. The page consumes only the editorial
 * visual language — semantic tokens, `Container`, `SectionHeading`,
 * `Badge` — and never reaches into raw color literals or feature code.
 *
 * Section order is documented in `DesignSystemPage.tsx` and matches
 * `src/editorial/colors.md` §"accent.* token roles" so the page reads
 * as a verifiable companion to that guide.
 *
 * Chrome convention (Issue #199). The `<PublicNav />` is rendered
 * here explicitly (rather than mounted at the `__root` level) so the
 * showcase page stays a self-contained surface — see
 * `src/routes/about.tsx` for the rationale. `<Breadcrumbs />` is
 * intentionally NOT rendered here: `/design-system` is in
 * `SUPPRESS_BREADCRUMB_LEAF_IDS` (it is a top-level storybook-style
 * entry, not part of the editorial IA), and `<Breadcrumbs />` would
 * return `null` for that leaf anyway.
 */
export const Route = createFileRoute('/design-system')({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Design System — rebuildup.dev' },
			{
				name: 'description',
				content:
					'Editorial visual language showcase — semantic tokens, typography scale, spacing scale, surface treatments, interactive states, status / category accents.',
			},
			{ property: 'og:type', content: 'website' },
			{ property: 'og:title', content: 'Design System — rebuildup.dev' },
			{
				property: 'og:description',
				content:
					'Editorial visual language showcase — semantic tokens, typography scale, spacing scale, surface treatments, interactive states, status / category accents.',
			},
			{ property: 'og:url', content: 'https://rebuildup.dev/design-system' },
		],
		links: [{ rel: 'canonical', href: 'https://rebuildup.dev/design-system' }],
	}),
	component: DesignSystemRoute,
});

function DesignSystemRoute() {
	return (
		<>
			<PublicNav />
			<DesignSystemPage />
		</>
	);
}
