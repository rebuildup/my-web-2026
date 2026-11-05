import { createFileRoute } from '@tanstack/react-router';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { DotfilesIntroductionPage, getDotfilesIntroduction } from '../projects';

/**
 * `/projects/dotfiles` — public introduction to `rebuildup/dotfiles`
 * (Issue #621).
 *
 * The loader runs on the Worker at request time but reads only a
 * committed JSON snapshot: no binding, no outbound request, no
 * server function. The sync that refreshes the snapshot is a
 * separate offline job, so the page's cost is the same as any
 * static route.
 *
 * `Date.now()` is evaluated here, once, so SSR and hydration agree
 * on the freshness state for the request.
 */
export const Route = createFileRoute('/projects/dotfiles')({
	loader: () => getDotfilesIntroduction(Date.now()),
	head: () => {
		const title = 'dotfiles — rebuildup.dev';
		const description =
			'開発マシンのユーザー設定、エージェント共通設定の固定、Infisical を介した実行時 secret 注入を担う rebuildup/dotfiles の公開紹介。OS とパッケージの provisioning を担う pc-setup との境界も説明します。';
		const url = 'https://rebuildup.dev/projects/dotfiles';
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
	component: ProjectsDotfilesRoute,
});

function ProjectsDotfilesRoute() {
	const view = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<DotfilesIntroductionPage view={view} />
		</>
	);
}
