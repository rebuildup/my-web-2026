import { createFileRoute } from '@tanstack/react-router';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { composeSocialCard } from '../editorial/social-card';
import { KeyboardPage } from '../keyboard/components';
import { KEYBOARD_SOURCES, loadKeyboardPage } from '../keyboard';

/**
 * `/keyboard` — read-only keyboard-layout surface (Issue #620).
 *
 * The loader reads the committed snapshot only. `loadKeyboardPage`
 * validates the provenance manifest and returns either the parsed
 * catalog with freshness or a fixed safe state; it performs no I/O and
 * therefore never reaches GitHub at request time. The page is
 * indexable but intentionally not listed in the sitemap (it is a
 * personal reference page linked from About), which is recorded in
 * `src/http/seo/sitemap.ts#SITEMAP_EXCLUSIONS` and
 * `scripts/_index-boundary.mjs`.
 *
 * The canonical literal stays readable here because
 * `scripts/check-index-boundary.mjs` cross-checks it textually against
 * the index-boundary entry.
 */
export const Route = createFileRoute('/keyboard')({
	loader: async () => {
		return loadKeyboardPage(KEYBOARD_SOURCES, Date.now());
	},
	head: () => {
		const title = 'キーボード配列 — 大西配列と Kanata';
		const description =
			'macOS と Windows のキーボード設定を、実際のキー位置に沿って表示する read-only リファレンス。hidutil のベース差し替え、Kanata の HUB / 記号 / 自動化レイヤー、Space 長押しと Shift 長押しの分岐を確認できます。';
		const url = 'https://rebuildup.dev/keyboard';
		const card = composeSocialCard({
			title,
			description,
			url,
			ogType: 'website',
		});
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title },
				{ name: 'description', content: description },
				...card.meta,
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: KeyboardRoute,
});

function KeyboardRoute() {
	const data = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<KeyboardPage data={data} />
		</>
	);
}
