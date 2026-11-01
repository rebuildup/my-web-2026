/**
 * Current projects — the editable snapshot the home page publishes
 * (Issue #316).
 *
 * What this file owns
 * -------------------
 * ONE array — `CURRENT_PROJECTS` — is the source of truth for the
 * "現在地 / Where I am now" section. The owner edits **only that
 * array**: every field below it is code, and every field below it is
 * read by `selectPublicProjects`, which decides what is actually
 * published. Editing the array is a copy decision; changing the
 * filter is a contract decision.
 *
 * There is no runtime fetch, no binding and no third-party read
 * here. The snapshot is committed to the repository on purpose: the
 * section says "this is what is going on", and a claim that changes
 * without a commit cannot be reviewed, diffed or rolled back. A
 * later decision to fetch this list from a service would be a NEW
 * obligation (its own ADR), not a change to this file.
 *
 * Owner confirmation: PENDING. The four entries below are the
 * projects the `/about` "current" narrative already publishes
 * (`src/about/data.ts`). The wording of each `statusJa` line and the
 * decision to publish no link at all are **not** yet confirmed by the
 * owner — see `test/integration/home-about-current-consistency.test.ts`,
 * which pins the Home side to the About side so the two cannot drift
 * apart silently.
 *
 * Publication rules (`selectPublicProjects`)
 * ------------------------------------------
 * The filter is fail-closed. An entry that cannot be published is
 * dropped or reduced, never rendered half-broken:
 *
 *   - an entry whose `id`, `name` or `statusJa` is empty (after
 *     trimming) is dropped — there is no half-row;
 *   - a repeated `id` keeps its FIRST occurrence, so one project can
 *     never be listed twice;
 *   - a `link` survives only when its `href` is an internal path
 *     (`/…`, but not `//…`) or an `https://` URL, and its `label` is
 *     non-empty. An unusable link removes the LINK, not the entry:
 *     the project is still real, only the way to reach it is unknown;
 *   - at most `MAX_CURRENT_PROJECTS` entries are published.
 *
 * The function is pure: no fetch, no clock, no environment. That is
 * what makes the same list render identically on the server, in a
 * test, and in a Storybook preview.
 */

/** A way to reach a project. Optional — most entries have none. */
export interface CurrentProjectLink {
	/** The visible label of the link. Never empty in a published link. */
	label: string;
	/**
	 * The target. Published only when it is an internal path
	 * (`/…`, but not `//…`) or an `https://` URL.
	 */
	href: string;
}

/** One project the owner is working on right now. */
export interface CurrentProject {
	/** Stable identifier. The first entry with an id wins. */
	id: string;
	/** The display name (product / project name). */
	name: string;
	/** One Japanese line describing the current state of the work. */
	statusJa: string;
	/** Optional way to reach the project. Absent when unpublished. */
	link?: CurrentProjectLink;
}

/**
 * How many projects the section publishes at most.
 *
 * Issue #316 asks for "2〜4件". Four is the ceiling: the section is a
 * snapshot, not an index, and a longer list would push the sections
 * below it below the fold.
 */
export const MAX_CURRENT_PROJECTS = 4;

/**
 * The projects currently in progress — the owner's editable snapshot.
 *
 * OWNER: edit ONLY this array. Everything else in this file is the
 * publication contract and must not be edited to make an entry
 * appear.
 *
 * OWNER CONFIRMATION: PENDING. The entries are the four projects the
 * `/about` "current" narrative already publishes. No `link` is set:
 * the owner has not confirmed a public destination for any of them,
 * so the section publishes the projects without links rather than
 * inventing one.
 */
export const CURRENT_PROJECTS: readonly CurrentProject[] = [
	{
		id: 'my-web-2026',
		name: 'my-web-2026',
		statusJa: '個人 Web Platform の再構築。0.8.1 sprint で現在地の表示を追加中。',
	},
	{
		id: 'tastile',
		name: 'Tastile',
		statusJa:
			'scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。',
	},
	{
		id: 'after-effects',
		name: 'After Effects',
		statusJa: 'script / plugin / extension の継続開発。配布と運用まで含む product として扱う。',
	},
	{
		id: 'ai-coding-agent',
		name: 'AI coding agent',
		statusJa:
			'agent workflow の実運用と形式知化。project-init / design-skills として実験と文書を並行。',
	},
] as const;

/**
 * Whether a href may be published.
 *
 * Fail-closed: only an internal path (`/…`, but not the
 * protocol-relative `//…`) or an `https://` URL passes. `http:`,
 * `javascript:`, `data:` and a relative path are all refused. A
 * backslash is refused too, because a browser normalises `/\host` into
 * a protocol-relative URL — the same hazard as `//host`, written
 * differently.
 */
export function isPublishableHref(href: string): boolean {
	const value = href.trim();
	if (value.includes('\\')) return false;
	if (value.startsWith('https://')) return true;
	if (!value.startsWith('/')) return false;
	return !value.startsWith('//');
}

/**
 * The link of an entry, or `undefined` when it may not be published.
 *
 * A missing / unusable label and an unusable href both remove the
 * LINK. The entry itself survives: the project is real even when the
 * way to reach it is unknown.
 */
export function selectPublishableLink(
	link: CurrentProjectLink | undefined,
): CurrentProjectLink | undefined {
	if (!link) return undefined;
	const label = link.label.trim();
	if (label.length === 0) return undefined;
	if (!isPublishableHref(link.href)) return undefined;
	return { label, href: link.href.trim() };
}

/**
 * The entries that may be published, in the order the owner wrote
 * them.
 *
 * Pure, and therefore the same on the server, in a test and in a
 * preview. See the module docstring for the rules.
 */
export function selectPublicProjects(entries: readonly CurrentProject[]): CurrentProject[] {
	const seen = new Set<string>();
	const published: CurrentProject[] = [];
	for (const entry of entries) {
		if (published.length >= MAX_CURRENT_PROJECTS) break;
		const id = entry.id.trim();
		const name = entry.name.trim();
		const statusJa = entry.statusJa.trim();
		if (id.length === 0 || name.length === 0 || statusJa.length === 0) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		const link = selectPublishableLink(entry.link);
		published.push(link ? { id, name, statusJa, link } : { id, name, statusJa });
	}
	return published;
}
