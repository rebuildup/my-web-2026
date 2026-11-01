/**
 * Current projects — the shared vocabulary of the "現在地 / Where I am now"
 * data model (Issue #316).
 *
 * Three questions, three dimensions
 * --------------------------------
 * The section answers "is this person still working?" — which is not one
 * question but three:
 *
 *   - 続いているか — how long has this been going on → `startedOn`
 *   - 動いているか — did anything move recently → `updatedOn`
 *   - どれだけ入れているか — where is the effort going → `weight`
 *
 * A flat list of names answers none of them, and a list sorted only by
 * "last updated" answers the first two by accident. The record below
 * carries all three, and each one is a FACT with a source, not a bare
 * value.
 *
 * Why every measured value carries its source
 * -------------------------------------------
 * The owner writes some values by hand today; the start date of this
 * repository is read from git; a GitHub integration is planned. Those
 * three are not the same kind of claim — one is reproducible from a
 * commit, one is a person's memory — so the type keeps them apart and
 * the rendered document says which is which (`source.ts` →
 * `SOURCE_LABELS`). Merging them into one undifferentiated column would
 * make the memory look as verifiable as the commit.
 *
 * Optional ≠ zero
 * ---------------
 * Every fact here is optional. A missing `startedOn` means "no date is
 * published for this project", never "it started today"; a missing
 * `activity` means "this cannot be measured", never "0 commits". The
 * renderer omits a fact it does not have and never substitutes a
 * placeholder (see `CurrentProjects.tsx`).
 */

/**
 * Where a value came from.
 *
 * Three values, fixed:
 *
 *   - `handwritten` — the owner wrote it in `roster.ts`. Not reproducible.
 *   - `git`         — derived from this repository's history. Reproducible
 *                     from the commit named in `ProjectFact#evidence`.
 *   - `github`      — reserved for the planned GitHub source. Nothing
 *                     produces it today; the vocabulary exists so a future
 *                     provider does not have to invent one.
 */
export type ProjectFactSource = 'handwritten' | 'git' | 'github';

/** One measured value and the record of where it came from. */
export interface ProjectFact<T> {
	/** The value itself. Its shape is the fact's business, not this type's. */
	readonly value: T;
	readonly source: ProjectFactSource;
	/** The day this value was observed or produced (`YYYY-MM-DD`). */
	readonly observedOn: string;
	/**
	 * What a reviewer can re-derive the value from: a commit sha, a
	 * generator script, a record file. Absent for a handwritten value,
	 * because a memory has no evidence — which is exactly why the source
	 * is displayed next to the value.
	 */
	readonly evidence?: string;
}

/**
 * How much of the owner's attention a project is getting.
 *
 * The four levels are the owner's judgement, not a measurement:
 * `primary` = 主軸, `active` = 並行, `side` = 副次, `paused` = 休止.
 * The judgement is stored as a fact so that a future source (GitHub
 * proposing a level, the owner confirming it) can supply it the same way
 * a git snapshot supplies a date.
 */
export type ProjectWeightLevel = 'primary' | 'active' | 'side' | 'paused';

/**
 * A measured activity window.
 *
 * `commits` counts commits inside `windowDays`, so a bare number can
 * never be read without its window: "2,424" is meaningless, "2,424
 * commits in 30 days" is a claim. `commitsTotal` is optional context
 * (the whole history), not a second metric.
 */
export interface ProjectActivity {
	readonly commits: number;
	/** The window `commits` was counted over. At least 1. */
	readonly windowDays: number;
	/** Commits in the project's whole history, when the source knows it. */
	readonly commitsTotal?: number;
}

/** A project's place in the owner's attention. */
export interface ProjectWeight {
	/** The level. Absent means the owner has not written one yet. */
	readonly level?: ProjectFact<ProjectWeightLevel>;
	/**
	 * The measurable half. Absent means "cannot be measured from a
	 * source this platform has", NOT "zero activity".
	 */
	readonly activity?: ProjectFact<ProjectActivity>;
}

/** A way to reach a project. Optional — most entries have none. */
export interface CurrentProjectLink {
	/** The visible label of the link. Never empty in a published link. */
	readonly label: string;
	/**
	 * The target. Published only when it is an internal path (`/…`, but
	 * not `//…`) or an `https://` URL.
	 */
	readonly href: string;
}

/**
 * One published project.
 *
 * `name` and `statusJa` are the author's own words, not measured facts:
 * they carry no `source`, and the section as a whole is the author's
 * surface. The three measured facts (`startedOn`, `updatedOn`,
 * `weight.activity`) each carry one.
 */
export interface CurrentProjectRecord {
	/** Stable identifier. The roster owns it; a source cannot invent one. */
	readonly id: string;
	readonly name: string;
	/** One Japanese line describing the current state of the work. */
	readonly statusJa: string;
	readonly startedOn?: ProjectFact<string>;
	readonly updatedOn?: ProjectFact<string>;
	readonly weight?: ProjectWeight;
	readonly link?: CurrentProjectLink;
}

/**
 * What a source may supply for one project id.
 *
 * A source supplies FACTS. It cannot supply a name, a status line or an
 * id — those stay owned by the roster — so a future GitHub integration
 * cannot grow the section by listing every repository it can see.
 */
export interface CurrentProjectFacts {
	readonly startedOn?: ProjectFact<string>;
	readonly updatedOn?: ProjectFact<string>;
	readonly weight?: ProjectWeight;
}

/**
 * One entry of the owner's roster — the file the owner edits.
 *
 * The roster owns WHICH projects are published and every word about them
 * (`name`, `statusJa`). It also holds the two things only the owner can
 * supply today: a weight level and, for a project whose history is not in
 * this repository, its dates. A source supplies facts; it can never add a
 * project to this list.
 */
export interface RosterEntry {
	readonly id: string;
	readonly name: string;
	readonly statusJa: string;
	/**
	 * The values only the owner can write: the weight level and, for a
	 * project whose history is not in this repository, its dates.
	 *
	 * One block, one `recordedOn`: that is the day the owner wrote these
	 * values, and it is the `observedOn` of every fact below. It is
	 * required — a hand-written date has no other evidence, so the record
	 * has to say at least when it was written down. An entry without this
	 * block publishes its name and one-liner and nothing measured.
	 */
	readonly handwritten?: {
		/** The day these values were written down (`YYYY-MM-DD`). */
		readonly recordedOn: string;
		readonly startedOn?: string;
		readonly updatedOn?: string;
		/** 主軸 / 並行 / 副次 / 休止. */
		readonly weightLevel?: ProjectWeightLevel;
	};
	readonly link?: CurrentProjectLink;
}

/**
 * A swappable provider of facts (the DI seam, same shape as
 * `PortfolioLoader` in `src/portfolio/**`).
 *
 * Today there are two implementations, both offline: the owner's
 * handwritten file and this repository's git snapshot. A GitHub source
 * would implement the same interface and read an offline-produced
 * committed snapshot — no provider may fetch at request time without its
 * own Issue and ADR (AGENTS.md §4).
 *
 * `load` is async because a future implementation will be; the two
 * shipped providers resolve immediately.
 */
export interface CurrentProjectsSource {
	/** Which of the three provenances this source stamps on its facts. */
	readonly source: ProjectFactSource;
	/**
	 * project id → the facts this source can supply.
	 *
	 * A source returns only ids it knows. An unknown id is not an error:
	 * the roster decides what exists, and a source that has nothing to say
	 * about a project simply omits it.
	 */
	load(ids: readonly string[]): Promise<ReadonlyMap<string, CurrentProjectFacts>>;
}

/**
 * The loader the routes depend on.
 *
 * `today` is an explicit parameter rather than a clock read, so the
 * structure gate and every derived value are pure functions of the record
 * set and one named base date — which is what makes "same records, next
 * day" a testable state instead of a difference a test cannot reproduce.
 */
export interface CurrentProjectsLoader {
	loadCurrentProjects(today: string): Promise<readonly CurrentProjectRecord[]>;
}
