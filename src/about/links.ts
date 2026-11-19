/**
 * `/links` — verified external-link inventory (Issue #390).
 *
 * This module is the repo-controlled source of truth for the public
 * links page. Every entry was published on the predecessor site
 * (`https://links.yusuke-kim.com/about/links`, `data.ts`) and is
 * carried over verbatim where the destination still names the same
 * account. Two deliberate deviations from the 2025 list:
 *
 *   - The `yusuke-kim.com` profile / portfolio / gallery rows pointed
 *     at the predecessor domain. The successor platform owns
 *     `/about` and `/portfolio`, so those rows became internal links
 *     (`external: false`) instead of external URLs — the gallery
 *     rows (develop / video / design) have no 2026 equivalent and
 *     are dropped rather than pointed at a 404.
 *   - The two `mailto:` rows are NOT carried over. Issue #390 scopes
 *     this surface to "承認した URL のみ" and forbids growing private
 *     contact channels on its own; the verified contact channels
 *     stay owned by `src/contact/channels.json`, and this page links
 *     to `/contact` instead of restating an address.
 *
 * `externalHandles` in `src/about/data.ts` stays the canonical
 * "finds me elsewhere" footer on `/about`; this inventory is the
 * expanded, grouped form of the same approved accounts plus the
 * accounts the footer does not have room for. Where the two disagree
 * on a handle (X), BOTH published handles are listed under their own
 * 2025 labels rather than silently merged — the page reports what
 * the predecessor published, it does not adjudicate which account is
 * current.
 *
 * No entry here may carry an email address, a phone number, or a
 * personal-data-shaped literal: `src/about/**` is a declared
 * published-content root for `scripts/check-publication-redaction.mjs`
 * (D001 fires on any `local@domain` shape).
 */

/** One row of the links page. */
export interface AboutLink {
	readonly id: string;
	/** Display title — the service / account name. */
	readonly title: string;
	/** Absolute `https:` URL, or an internal `/path` for on-site rows. */
	readonly url: string;
	/** Short qualifier shown beside the title (handle, audience, note). */
	readonly description: string;
	/** `true` renders the external-link affordance (`target=_blank`). */
	readonly external: boolean;
}

/** A labelled group of links. */
export interface AboutLinkGroup {
	readonly id: string;
	readonly label: string;
	readonly labelEn: string;
	readonly links: readonly AboutLink[];
}

const external = (url: string): boolean => url.startsWith('https://');

/**
 * Ordered link groups. Order is editorial (the order a reader meets
 * them), ported from the 2025 `links` / `contactLinks` arrays.
 */
export const ABOUT_LINK_GROUPS: readonly AboutLinkGroup[] = [
	{
		id: 'site',
		label: 'このサイト',
		labelEn: 'On this site',
		links: [
			{
				id: 'portfolio',
				title: 'Portfolio',
				url: '/portfolio',
				description: '公開作品',
				external: false,
			},
			{
				id: 'contact',
				title: 'Contact',
				url: '/contact',
				description: 'verified channel 一覧',
				external: false,
			},
			{
				id: 'commission',
				title: '制作依頼',
				url: '/commission',
				description: '受付状況と依頼内容',
				external: false,
			},
		],
	},
	{
		id: 'accounts',
		label: 'アカウント',
		labelEn: 'Accounts',
		links: [
			{
				id: 'x-samuido',
				title: 'X (samuido)',
				url: 'https://x.com/samuido',
				description: '@samuido',
				external: external('https://x.com/samuido'),
			},
			{
				id: 'x-tech',
				title: 'X (Tech)',
				url: 'https://x.com/361do_sleep',
				description: '@361do_sleep',
				external: external('https://x.com/361do_sleep'),
			},
			{
				id: 'x-design',
				title: 'X (Design)',
				url: 'https://x.com/361do_design',
				description: '@361do_design',
				external: external('https://x.com/361do_design'),
			},
			{
				id: 'github',
				title: 'GitHub',
				url: 'https://github.com/rebuildup',
				description: 'rebuildup',
				external: external('https://github.com/rebuildup'),
			},
			{
				id: 'linkedin',
				title: 'LinkedIn',
				url: 'https://www.linkedin.com/in/yusuke-kimura-835055398/',
				description: 'Yusuke Kimura',
				external: external('https://www.linkedin.com/in/yusuke-kimura-835055398/'),
			},
			{
				id: 'youtube',
				title: 'YouTube',
				url: 'https://www.youtube.com/@361do_sleep',
				description: '@361do_sleep',
				external: external('https://www.youtube.com/@361do_sleep'),
			},
			{
				id: 'discord',
				title: 'Discord Server',
				url: 'https://discord.gg/qmCGSBmc28',
				description: 'いど端',
				external: external('https://discord.gg/qmCGSBmc28'),
			},
			{
				id: 'booth',
				title: 'BOOTH',
				url: 'https://samuido.booth.pm',
				description: '361doのBOOTH',
				external: external('https://samuido.booth.pm'),
			},
			{
				id: 'bluesky',
				title: 'BlueSky',
				url: 'https://bsky.app/profile/361do.bsky.social',
				description: '361do',
				external: external('https://bsky.app/profile/361do.bsky.social'),
			},
		],
	},
	{
		id: 'development',
		label: '開発',
		labelEn: 'Development',
		links: [
			{
				id: 'zenn',
				title: 'Zenn',
				url: 'https://zenn.dev/361do_sleep',
				description: '361do_sleep',
				external: external('https://zenn.dev/361do_sleep'),
			},
			{
				id: 'qiita',
				title: 'Qiita',
				url: 'https://qiita.com/samuido',
				description: 'samuido',
				external: external('https://qiita.com/samuido'),
			},
			{
				id: 'atcoder',
				title: 'AtCoder',
				url: 'https://atcoder.jp/users/rebuildup',
				description: 'rebuildup',
				external: external('https://atcoder.jp/users/rebuildup'),
			},
			{
				id: 'wantedly',
				title: 'Wantedly',
				url: 'https://www.wantedly.com/id/rebuildup',
				description: 'rebuildup',
				external: external('https://www.wantedly.com/id/rebuildup'),
			},
			{
				id: 'note',
				title: 'note',
				url: 'https://note.com/alert_toad4443',
				description: 'samuido',
				external: external('https://note.com/alert_toad4443'),
			},
			{
				id: 'gitty',
				title: 'Gitty',
				url: 'https://gitty-code.com/user/rebuildup',
				description: 'rebuildup',
				external: external('https://gitty-code.com/user/rebuildup'),
			},
		],
	},
	{
		id: 'games',
		label: 'ゲーム・その他',
		labelEn: 'Games & more',
		links: [
			{
				id: 'tetrio',
				title: 'Tetrio',
				url: 'https://ch.tetr.io/u/samuido',
				description: 'samuido',
				external: external('https://ch.tetr.io/u/samuido'),
			},
			{
				id: 'osu',
				title: 'osu!',
				url: 'https://osu.ppy.sh/users/36986836',
				description: 'samuido',
				external: external('https://osu.ppy.sh/users/36986836'),
			},
			{
				id: 'duolingo',
				title: 'Duolingo',
				url: 'https://www.duolingo.com/profile/samuido',
				description: 'samuido',
				external: external('https://www.duolingo.com/profile/samuido'),
			},
		],
	},
];

/** Flattened inventory — tests and future consumers read this. */
export const ABOUT_LINKS: readonly AboutLink[] = ABOUT_LINK_GROUPS.flatMap((group) => group.links);
