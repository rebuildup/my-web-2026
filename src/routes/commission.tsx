import { createFileRoute } from '@tanstack/react-router';
import { CommissionPage } from '../contact/commission-page';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';

/**
 * `/commission` — 制作依頼の受付状況と依頼内容 (Issue #390;
 * status contract per spikes #368 / #369).
 *
 * Thin route per the obligation contract: the service inventory,
 * request flow, estimate requirements and software list live in
 * `src/contact/commission.ts` (repo-controlled, ported from the
 * predecessor site's `about/commission/*` pages) and the
 * composition in `src/contact/commission-page.tsx`. `src/contact`
 * owns this surface because the commission-intake purpose already
 * lives in its channel schema (`PurposeSchema` 'commission-intake')
 * and the parked intake decision is a contact-surface question,
 * not an identity one.
 *
 * The page publishes NO prices, NO estimate calculator and NO
 * intake form: the commission mode is `parked` in the approved
 * `/about` narrative (`src/about/data.ts` `future.parked`), spike
 * #368 reserves the paused-state UI, and spike #369 reserves the
 * pricing surface for a preview-only prototype. The status notice
 * is the first thing the page renders.
 *
 * Deliberately NOT in `PUBLIC_NAV_ITEMS` and NOT in
 * `SITEMAP_ENTRIES` — reached from `/about`, `/contact` and
 * `/links`, same class as `/keyboard` (see
 * `scripts/_index-boundary.mjs` and `src/http/seo/sitemap.ts`).
 *
 * The canonical literal stays readable here because
 * `scripts/check-index-boundary.mjs` cross-checks it textually.
 */
export const Route = createFileRoute('/commission')({
	head: () => {
		const title = '制作依頼 / Commission — rebuildup.dev';
		const description =
			'Web 開発・アプリケーション開発・映像制作の依頼案内。受付状況と依頼時に必要な情報を掲載しています。';
		const url = 'https://rebuildup.dev/commission';
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: url },
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: CommissionRoute,
});

function CommissionRoute() {
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<CommissionPage />
		</>
	);
}
