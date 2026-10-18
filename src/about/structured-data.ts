import { type PersonFacts, canonicalUrl } from '../editorial/structured-data';
import type { AboutData, AboutPageData } from './types';

/**
 * `/about` → `Person` projection (Issue #422).
 *
 * The mapping is intentionally lossy. `ABOUT_DATA.identity` carries
 * five display fields, and only three of them survive into structured
 * data:
 *
 *   - `name`   → `name` (the approved combined identity string)
 *   - `handle` → `alternateName` (one value, one source)
 *   - `lead`   → `description` (self-description prose)
 *
 * `role` is dropped on purpose. It reads
 * 「宇部高専 制御情報工学科 本科4年 / developer & creator」 — a school
 * name, a year of study and a role, concatenated for display. Emitting
 * it as `jobTitle` would turn that display string into a
 * machine-readable job / education claim, which is exactly what
 * `contract.json#person.unapprovedProperties` forbids. The school and
 * the study year are real facts; what is missing is the record that
 * would carry their period (see
 * `docs/personal/knowledge-model.md`), so the structured graph waits
 * for that record instead of paraphrasing the paragraph.
 *
 * `externalHandles` → `sameAs`, verbatim. Those URLs are the approved
 * identity set, and the validator rejects any `sameAs` entry outside
 * it.
 *
 * This module owns the mapping because `about` owns the facts; the
 * editorial module only knows the narrow `PersonFacts` shape.
 */

const ABOUT_CANONICAL_PATH = '/about';

/** The subset of the about snapshot the projection needs. */
export type AboutPersonSource = Pick<AboutData, 'identity' | 'externalHandles'>;

/** Map the approved about snapshot onto the structured-data input. */
export function personFactsFromAbout(data: AboutPersonSource): PersonFacts {
	return {
		name: data.identity.name,
		alternateName: [data.identity.handle],
		description: data.identity.lead,
		url: canonicalUrl(ABOUT_CANONICAL_PATH),
		sameAs: data.externalHandles.map((handle) => handle.href),
	};
}

/** The resolved page snapshot stays assignable to the projection input. */
export type AboutPageDataFitsProjection = AboutPageData extends AboutPersonSource ? true : never;
