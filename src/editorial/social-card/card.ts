import {
	CANONICAL_ORIGIN,
	FALLBACK_CARD,
	FALLBACK_CARD_URL,
	SITE_LOCALE,
	SITE_NAME,
	socialCardUrl,
} from './contract';

/**
 * Open Graph / Twitter card composer (Issue #421).
 *
 * One place decides what a public surface publishes to a link
 * unfurler. Before this module the three card-bearing routes each
 * re-derived their own `og:*` array, and the *interesting* branch —
 * what happens when a project has no media — was a silent downgrade
 * to `twitter:card=summary` that no report could name.
 *
 * The two decisions this module owns:
 *
 *   1. **content-first**: publish the surface's own image URL when it
 *      is absolute and has alt text; otherwise publish the site-owned
 *      fallback card (`contract.json#fallbackCard`). Either way the
 *      preview has an image, and the emitted URL tells the gate which
 *      of the two happened — the degradation becomes visible in the
 *      verification report instead of being inferred from an absent tag.
 *   2. **never publish an unusable image**: a relative URL, a
 *      non-HTTP scheme, or an image with no alt text does not become an
 *      `og:image`. The fallback does instead. Crawlers show alt text
 *      next to a broken image more often than they show nothing, so a
 *      nameless image is worse than the fallback.
 *
 * It deliberately does NOT own: the canonical origin, the fallback
 * card's dimensions, the allowed `og:type` / `twitter:card` values, or
 * the per-route coverage matrix. Those live in `contract.json`.
 *
 * Inputs are structural, never portfolio types: `src/editorial/**`
 * imports neither `src/portfolio/**` nor `src/about/**`, so the fact
 * sources stay with the obligations that own them (ADR-0008).
 */

/** One `<meta>` descriptor, shaped for TanStack Start's `head().meta`. */
export type SocialCardMetaTag = Record<string, string>;

/** Which image the document ended up publishing. */
export type SocialCardImageSource = 'content' | 'fallback' | 'none';

/** The image a document publishes, once the policy has decided. */
export interface ResolvedCardImage {
	/** Absolute URL. This is the value that reaches `og:image`. */
	readonly url: string;
	readonly source: Exclude<SocialCardImageSource, 'none'>;
	readonly alt: string;
	readonly width: number | null;
	readonly height: number | null;
}

/** The surface's own image, as the loader composed it. */
export interface SocialCardImageInput {
	/** Composed public URL, or `null` when no media resolves. */
	readonly url: string | null;
	readonly alt?: string | null;
	readonly width?: number | null;
	readonly height?: number | null;
}

/** What the composer needs to build a card. */
export interface SocialCardInput {
	/** Document `<title>`. */
	readonly title: string;
	/** `og:title` / `twitter:title`; defaults to `title`. */
	readonly socialTitle?: string;
	readonly description: string;
	/** Absolute URL of this surface (its canonical). */
	readonly url: string;
	/** One of `contract.json#ogTypes`. */
	readonly ogType: string;
	/** The surface's own image, or `null` when it has none. */
	readonly image?: SocialCardImageInput | null;
	/**
	 * `content-first` (default) falls back to the site card;
	 * `none` publishes no `og:image` at all.
	 */
	readonly policy?: 'content-first' | 'none';
}

/** The composed card: the `<meta>` list plus what it actually published. */
export interface SocialCard {
	readonly meta: readonly SocialCardMetaTag[];
	readonly image: ResolvedCardImage | null;
}

/** Absolute `http(s)` URL, and nothing else. */
function isPublishableImageUrl(value: string | null | undefined): value is string {
	if (!value) return false;
	if (!/^https?:\/\//.test(value)) return false;
	// A URL with whitespace or a newline never survives a crawler's
	// parse intact, so treat it as unusable rather than shipping it.
	return !/[\s<>"]/.test(value);
}

/**
 * Apply the content-first policy.
 *
 * Content wins only when it is publishable: absolute, and carrying alt
 * text. Everything else — no media row, an unbound R2 custom domain
 * (`composeMediaUrl` → `null`), a relative URL, an empty `alt` — falls
 * back to the site card, which declares its own alt and dimensions.
 */
export function resolveCardImage(
	image: SocialCardImageInput | null | undefined,
): ResolvedCardImage | null {
	if (!image || !isPublishableImageUrl(image.url)) return null;
	const alt = image.alt?.trim() ?? '';
	if (alt.length === 0) return null;
	const width = typeof image.width === 'number' && image.width > 0 ? Math.round(image.width) : null;
	const height =
		typeof image.height === 'number' && image.height > 0 ? Math.round(image.height) : null;
	return { url: image.url, source: 'content', alt, width, height };
}

/** The site-owned fallback card, as a resolved image. */
export function fallbackCardImage(): ResolvedCardImage {
	return {
		url: FALLBACK_CARD_URL,
		source: 'fallback',
		alt: FALLBACK_CARD.alt,
		width: FALLBACK_CARD.width,
		height: FALLBACK_CARD.height,
	};
}

/**
 * Compose the full og / twitter meta list for a public surface.
 *
 * Always emits: `og:type`, `og:site_name`, `og:locale`, `og:title`,
 * `og:description`, `og:url` and `twitter:card`. Emits the image block
 * (`og:image` + `og:image:alt` + `og:image:width` / `og:image:height`
 * when the intrinsic size is known, and the mirrored `twitter:image` +
 * `twitter:image:alt`) whenever an image resolves — which, under
 * `content-first`, is always.
 *
 * The alt text is mirrored into the twitter namespace because a
 * Twitter consumer reads `twitter:image:alt` and ignores
 * `og:image:alt`: without the mirror the same image would be
 * published nameless to exactly the consumer the fallback rule exists
 * for, so the `never publish an image without alt text` contract would
 * hold for half the tag families only.
 */
export function composeSocialCard(input: SocialCardInput): SocialCard {
	const socialTitle = input.socialTitle?.trim() || input.title;
	const url = socialCardUrl(input.url);
	const image =
		(input.policy ?? 'content-first') === 'none'
			? null
			: (resolveCardImage(input.image) ?? fallbackCardImage());

	const meta: SocialCardMetaTag[] = [
		{ property: 'og:type', content: input.ogType },
		{ property: 'og:site_name', content: SITE_NAME },
		{ property: 'og:locale', content: SITE_LOCALE },
		{ property: 'og:title', content: socialTitle },
		{ property: 'og:description', content: input.description },
		{ property: 'og:url', content: url },
	];

	if (image) {
		meta.push({ property: 'og:image', content: image.url });
		meta.push({ property: 'og:image:alt', content: image.alt });
		if (image.width !== null)
			meta.push({ property: 'og:image:width', content: String(image.width) });
		if (image.height !== null) {
			meta.push({ property: 'og:image:height', content: String(image.height) });
		}
	}

	meta.push({ name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' });
	meta.push({ name: 'twitter:title', content: socialTitle });
	meta.push({ name: 'twitter:description', content: input.description });
	if (image) {
		meta.push({ name: 'twitter:image', content: image.url });
		meta.push({ name: 'twitter:image:alt', content: image.alt });
	}

	return { meta, image };
}

/** Canonical URL for a published portfolio path, re-exported for routes. */
export { CANONICAL_ORIGIN, FALLBACK_CARD_URL, SITE_LOCALE, SITE_NAME, socialCardUrl };
