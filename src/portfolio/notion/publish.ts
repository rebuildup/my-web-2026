import type { PortfolioFacet, PortfolioLink, PortfolioMedia, PortfolioProject } from '../schema';
import type { NotionMedia, NotionRecord, ReadSnapshot } from './contract';

/**
 * Publication and projection for CMS records (Issue #765).
 *
 * `map.ts` says what Notion authoring *is*; this module says what a public
 * caller may *see*. Keeping the two apart is the point of ADR-0018 §2.6:
 * a Notion property is an input, and the decision to publish stays in the
 * repository. Concretely:
 *
 *   * `status`/`visibility` follow the same rule the D1 loader enforces in
 *     SQL (`published` + `public`). A CMS record that says `unlisted` is
 *     never listed, even though its slug would resolve.
 *   * **Rights are fail-closed per asset, not per record.** An image whose
 *     offline verdict is not `recorded` produces no URL and no `<img>`; the
 *     surrounding text still publishes. That matches ADR-0018 §2.5 (image →
 *     placeholder) and `src/legal/**`, which refuses a cleared verdict for
 *     anything it has no record of. Dropping the whole project would hide
 *     text the author wrote; publishing the image would publish a byte
 *     nobody cleared. Neither is acceptable, so the asset is what goes.
 */

/** Does this record belong on a public surface at all? */
export function isPublicRecord(record: NotionRecord): boolean {
	return record.status === 'published' && record.visibility === 'public';
}

/**
 * The media a public surface may render: rights `recorded` only.
 *
 * The ordering is the record's own (`isCover` first, then `displayOrder`),
 * so the cover contract the D1 loader preserves is preserved here too.
 */
export function publishedMedia(record: NotionRecord): readonly NotionMedia[] {
	return record.media
		.filter((media) => media.rights === 'recorded')
		.slice()
		.sort((left, right) => {
			if (left.isCover !== right.isCover) return left.isCover ? -1 : 1;
			return left.displayOrder - right.displayOrder;
		});
}

function toMedia(record: NotionRecord, media: NotionMedia): PortfolioMedia {
	return {
		// Stable across syncs: the page id plus the key names the same asset.
		id: `${record.pageId}:${media.displayOrder}`,
		r2Key: media.r2Key,
		contentType: media.contentType,
		width: media.width,
		height: media.height,
		alt: media.alt,
		caption: media.caption,
		isCover: media.isCover,
		displayOrder: media.displayOrder,
		// Filled by the loader, which owns `composeMediaUrl` and the
		// `MEDIA` binding. A projection must not know an origin.
		url: null,
	};
}

function toLink(link: NotionRecord['links'][number]): PortfolioLink {
	return {
		id: `${link.kind}:${link.displayOrder}`,
		kind: link.kind,
		label: link.label,
		url: link.url,
		displayOrder: link.displayOrder,
	};
}

/**
 * Project a record into the shape the public pages already render.
 *
 * `updatedAt` is Notion's `last_edited_time`, not the sync instant: the
 * page's ordering and its "last updated" line should move when the author
 * edits, not when the build ran.
 *
 * Only `published` is projected. `archived` is a shipped state in
 * `PORTFOLIO_STATUSES`, but the D1 boundary
 * (`status='published' AND visibility='public'`, `load.ts`) never returns
 * an archived row, so projecting one from the CMS would make the two
 * sources obey different publication rules — and the CMS would be the
 * looser one. `toProject` therefore returns `null` for every state the
 * public list cannot carry, and `isPublicRecord` is the only gate.
 */
export function toProject(record: NotionRecord): PortfolioProject | null {
	if (record.status !== 'published') return null;
	return {
		id: `notion:${record.pageId}`,
		slug: record.slug,
		title: record.title,
		summary: record.summary,
		role: record.role,
		periodStart: record.periodStart,
		periodEnd: record.periodEnd,
		periodLabel: record.periodLabel,
		motivationMd: record.sections.motivation,
		architectureMd: record.sections.architecture,
		constraintsMd: record.sections.constraints,
		implementationMd: record.sections.implementation,
		evidenceMd: record.sections.evidence,
		retrospectiveMd: record.sections.retrospective,
		facets: record.facets as readonly PortfolioFacet[],
		technologies: record.technologies,
		visibility: record.visibility,
		status: record.status,
		pinned: record.pinned,
		displayOrder: record.displayOrder,
		createdAt: Date.parse(record.editedAt),
		updatedAt: Date.parse(record.editedAt),
		links: record.links.map(toLink),
		media: publishedMedia(record).map((media) => toMedia(record, media)),
	};
}

/**
 * Every project the snapshot makes public.
 *
 * A snapshot in `unavailable` state still yields its records: the last
 * known content is what the page shows while it says the source could not
 * be reached (ADR-0018 §2.5). The *state* travels separately so the page
 * can say so; it does not silently delete pages a visitor bookmarked.
 */
export function publicProjects(snapshot: ReadSnapshot | null): readonly PortfolioProject[] {
	if (snapshot === null) return [];
	return snapshot.records
		.filter(isPublicRecord)
		.map(toProject)
		.filter((project): project is PortfolioProject => project !== null);
}

/** The four columns the canonical order is defined over. */
export interface Orderable {
	readonly pinned: boolean;
	readonly displayOrder: number;
	readonly updatedAt: number;
	readonly id: string;
}

/**
 * Ordering key shared with the D1 loader's canonical order
 * (`pinned DESC, display_order ASC, updated_at DESC, id ASC`).
 *
 * Returning a comparable tuple rather than sorting here keeps the merge in
 * `load.ts` the only place that knows how two sources interleave — and
 * makes the comparison testable on its own.
 */
export function orderingKey(project: Orderable): readonly [number, number, number, string] {
	return [project.pinned ? 1 : 0, -project.displayOrder, project.updatedAt, project.id];
}

/** Canonical comparator; negative when `left` sorts before `right`. */
export function compareProjects(left: Orderable, right: Orderable): number {
	const a = orderingKey(left);
	const b = orderingKey(right);
	for (let index = 0; index < 3; index += 1) {
		const difference = (b[index] as number) - (a[index] as number);
		if (difference !== 0) return difference;
	}
	return String(a[3]).localeCompare(String(b[3]), 'en');
}
