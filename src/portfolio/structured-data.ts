import { type CreativeWorkFacts, canonicalUrl } from '../editorial/structured-data';
import type { PortfolioProject } from './schema';

/**
 * Portfolio project → `CreativeWork` projection (Issue #422).
 *
 * Only what the row can prove is projected. The visibility boundary
 * is not re-implemented here: `loadPortfolioProject` /
 * `listPortfolioProjects` already return `public + published` rows
 * only, so a node built from their output cannot leak a draft.
 *
 * Two deliberate omissions:
 *
 *   - `keywords` — `technologies` is a real, row-backed fact, but
 *     `keywords` reads as a search-intent claim, and this repository
 *     does not make search-intent claims (`docs/personal/domain.md`
 *     §11.4: technology names explain the evidence, they are not the
 *     subject).
 *   - `dateCreated` when the period label carries no parsable year —
 *     see `structuredDateFromPeriodLabel` below.
 *
 * Cross-references:
 *   - `src/editorial/structured-data/contract.json` — the properties
 *     the emitted graph is allowed to use
 *   - `docs/personal/knowledge-model.md` — date precision semantics
 */

/** Map one public portfolio row onto the structured-data input. */
export function creativeWorkFactsFromProject(project: PortfolioProject): CreativeWorkFacts {
	const cover = project.media.find((media) => media.isCover) ?? project.media[0];
	return {
		name: project.title,
		description: project.summary,
		url: canonicalUrl(`/portfolio/${project.slug}`),
		dateCreated: structuredDateFromPeriodLabel(project.periodLabel),
		dateModified: new Date(project.updatedAt).toISOString(),
		imageUrl: cover?.url ?? null,
	};
}

/**
 * Derive a schema.org date from the human-readable period label at
 * the precision the label actually records.
 *
 * `period_start` is stored as an epoch value whose day component is
 * a storage convention, not a known fact: a project labelled
 * 「2022 - present」 is known to the YEAR, not to 1 January 2022.
 * Widening that to `2022-01-01` would fabricate a date the source
 * never recorded, which `docs/personal/knowledge-model.md` forbids
 * ("日付の精度を捏造しない").
 *
 * So the label is the precision source:
 *
 *   「2022 - present」               → `2022`        (xsd:gYear)
 *   「2025-09 - present」            → `2025-09`     (xsd:gYearMonth)
 *   「2026 夏 (Summer 2026)」        → `2026`
 *   anything else / empty            → omitted (fail closed)
 *
 * Exported for unit testing; the pattern is deliberately strict —
 * a label that does not start with a four-digit year yields no date
 * rather than a guessed one.
 */
export function structuredDateFromPeriodLabel(label: string | null): string | undefined {
	const trimmed = label?.trim() ?? '';
	const year = /^(\d{4})(?:-(0[1-9]|1[0-2]))?(?![-\d])/.exec(trimmed);
	if (!year) return undefined;
	const yearPart = year[1] as string;
	if (year[2]) return `${yearPart}-${year[2]}`;
	return yearPart;
}
