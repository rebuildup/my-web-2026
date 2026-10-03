import type { AboutData } from './types';

/**
 * Repo-controlled source of truth for the `/about` narrative copy.
 *
 * `identity` / `interests` / `current` / `future` /
 * `externalHandles` are stored as in-repo TypeScript constants
 * (rather than JSON) so the page loader can type-check the shape
 * at build time and the editorial coordinate system stays free
 * of an extra loader. `experienceSlugs` is the narrative-ordered
 * subset of `/portfolio` items the page should surface — the
 * actual projects are fetched through `src/portfolio/load.ts` so
 * the public visibility boundary is preserved.
 *
 * Cross-references:
 *   - `docs/personal/domain.md` §11 narrative invariants — no
 *     fabricated affordances, no skill percentages, no current
 *     metrics framed as current value.
 *   - `docs/decisions/about-cv-contact.md` §「/about
 *     structure」 — the repo-controlled copy is bound here, the
 *     experience subset flows from `portfolio`.
 *   - Decision §「How to apply」 — the page is fail-closed: if a
 *     handle, an identity field, or a curated slug disappears, the
 *     page renders less, never fabricates an alternative.
 *
 * Update policy:
 *   `docs/personal/domain.md` §14 (Freshness guidance) treats
 *   identity (`high` stability), interests (`medium` — revisit
 *   every half year), current / future / externalHandles
 *   (`low` — update as the underlying state changes) at different
 *   freshness horizons. Treat this file the same way: identity
 *   rows rarely change; `current` / `future` change whenever the
 *   actual project / role state changes; `externalHandles`
 *   change whenever a channel is opened or retired.
 */

export const ABOUT_DATA: AboutData = {
	identity: {
		name: '木村友亮 / Yusuke Kimura',
		handle: 'samuido',
		role: '宇部高専 制御情報工学科 本科4年 / developer & creator',
		lead: 'ソフトウェアと映像・デザインを行き来しながら、作ったものを公開・運用まで持っていく developer / creator。',
		secondary:
			'samuido / 361do / rebuildup はすべて同じ人物。my-web-2026 は、それらを一つの platform として束ねる個人 site の再構築です。',
	},
	interests: [
		{
			title: 'Build to understand',
			description:
				'読むより先に手を動かして、技術や表現の境界を試す。新しい道具は自分の project で使い、合うものだけが残る。',
		},
		{
			title: 'Product, not only implementation',
			description:
				'コードが書けたことより、誰かが使える状態まで持っていくことに価値を置く。UI・配布・ドキュメント・運用まで含めて product と考える。',
		},
		{
			title: 'Do not self-limit with labels',
			description:
				'frontend / backend / engineer / creator を排他的なラベルとして扱わない。product を成立させるために層を降りることを自然なものとして扱う。',
		},
		{
			title: 'Quality should be operational',
			description:
				'品質は「丁寧に作ったつもり」ではなく、test / CI / review / release gate / architecture boundary のような再現可能な仕組みに落とす。',
		},
	],
	// Narrative subset of public+published portfolio projects.
	// Ordered as the visitor should read them (story arc), not the
	// canonical `pinned → display_order → updated_at → id` sort.
	// Slugs that no longer resolve to a public project are dropped
	// at load time — this list does not pin visibility itself.
	experienceSlugs: ['aulymo', 'multi-slicer', 'my-web-2026'],
	current: [
		'my-web-2026 — personal Web Platform の再構築。foundation release を 2026-09 に終え、portfolio / about を順にこの release へ乗せている。',
		'Tastile — scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。',
		'After Effects 向け script / plugin / extension の継続開発。配布と運用まで含む product として扱う。',
		'AI coding agent / agent workflow の実運用と形式知化。project-init / design-skills として実験と文書を並行。',
	],
	future: {
		active: [
			'2028 年 3 月に高専を卒業し、software engineer / frontend engineer を主軸として就職する。',
			'就職後も個人 project・open-source・tool 配布・product creation を継続する。会社での仕事だけが activity の全てになる状態を避けたい。',
			'AI を「自分ができないことの代替」ではなく、調査・実装・検証・運用の速度と範囲を拡張する tool として使う。',
		],
		parked: [
			'依頼制の映像 / デザイン制作を継続的に受ける mode は、現時点では parked。需要と制作余力が見合ったときに再開する。',
			'plugin / tool の販売 channel の拡張 (BOOTH 以外の storefront、海外向け決済など) は、利益が見合う scope が立つまで見送り。',
			'/cv の canonical fact list (decision §「Why not /cv in this release」) は将来の release として parked。機械可読な CV data layer を別 obligation で起こす必要がある。',
		],
	},
	externalHandles: [
		{
			label: 'GitHub (rebuildup)',
			href: 'https://github.com/rebuildup',
		},
		{
			label: 'X (samuido)',
			href: 'https://x.com/samuido',
		},
		{
			label: 'BOOTH (361do)',
			href: 'https://samuido.booth.pm',
		},
	],
} as const;
