/**
 * Audited Storybook stories for the axe-core scan (Issue #392).
 *
 * Why this file exists
 * --------------------
 * Issue #393 audits the RENDERED public ROUTES: it opens a route in a
 * browser and asks axe-core whether the document a visitor receives
 * violates WCAG 2.2 A / AA. This file is the other half — the
 * **independent component** a designer actually iterates on. A story is
 * a component rendered on its own, without the page around it, so a
 * defect in the component is visible here long before it reaches a
 * route.
 *
 * The list is written out BY HAND on purpose
 * ------------------------------------------
 * It is the record of "which stories were audited", so it must not be
 * derived at run time from the story files. A generated list would make
 * the audit trail unfalsifiable: adding a story would silently add it
 * to the audit, and removing one would silently drop a measurement
 * nobody noticed was gone.
 *
 * The list is per FILE, and every export of the file is named
 * --------------------------------------------------------------
 * A story file is one component with several states, and the states
 * differ in what they render — a form's error state is not the form's
 * default state. Auditing one state and calling the file audited
 * would leave the other states unmeasured, so every export of an
 * audited file is named explicitly here.
 *
 * STAGED REGISTRATION
 * -------------------
 * Registering every story at once would make the gate permanently red:
 * the existing stories were written before this audit existed, and a
 * story that has never been audited is not evidence of a defect. So the
 * manifest registers the stories that HAVE been audited, and the gate
 * lists every story that has not been registered yet as an OPEN ITEM —
 * visible, counted, and never silently green. A new story is therefore
 * never a red gate: it is an open item somebody has to look at.
 *
 * The manifest CANNOT declare that a story is allowed to fail
 * -----------------------------------------------------------
 * `expect` has no `fail` member, and the audit refuses a declaration
 * outside `{pass}` at run time as well. If the manifest could say "this
 * story is expected to fail", then editing one word here would turn a
 * newly-introduced violation into a green run. The place where a known
 * violation is ALLOWED to exist is the ledger,
 * `e2e/a11y/axe-storybook-baseline.json`: one record per story × rule,
 * with the reason it is tolerated. That is a separate, visible artefact
 * with its own diff, so tolerating a violation is a decision somebody
 * can read — not a word in a declaration.
 *
 * What is NOT decided here
 * -------------------------
 * Whether a recorded violation may stay recorded, whether the wording
 * of an accessible name is good, and whether the rendered result is
 * acceptable to a reader. The audit decides whether a rule fires; a
 * person decides the rest. `docs/verification/a11y/axe-storybook.md`
 * records the human evaluation.
 */

import { AXE_TAGS } from './axe-manifest.ts';

export { AXE_TAGS };

/**
 * The verdict an audited file may declare.
 *
 * There is deliberately no `fail` member: the manifest may not say
 * "this story is allowed to fail". A story whose known violations are
 * tolerated is recorded in the ledger, with a reason.
 */
export type StoryVerdict = 'pass';

/** One audited story file, with every story export the audit measures. */
export interface AuditedStoryFile {
	/** The story file, relative to the repository root. */
	readonly file: string;
	/** The Storybook component title the file's stories are published under. */
	readonly title: string;
	/**
	 * Every story export in the file that the audit measures.
	 *
	 * The exports are named explicitly, so a story added to an audited
	 * file later shows up as an OPEN ITEM (visible, not red) until
	 * somebody registers it here.
	 */
	readonly exports: readonly string[];
	/** The verdict this file's stories are expected to produce. */
	readonly expect: StoryVerdict;
	/** What this file is, in one line — the audit record's prose. */
	readonly note: string;
}

/**
 * The audited stories.
 *
 * Every story file in the repository is registered, with every export
 * it publishes. Order is by file path, so the list reads like the
 * source tree.
 */
export const AUDITED_STORY_FILES: readonly AuditedStoryFile[] = [
	{
		file: 'src/admin/emoji-catalog/catalog.stories.tsx',
		title: 'admin/EmojiCatalog',
		exports: ['Populated', 'Empty', 'DisabledOnly'],
		expect: 'pass',
		note: 'Emoji catalog — the admin catalogue table with its populated state.',
	},
	{
		file: 'src/editorial/analytics/AnalyticsConsent.stories.tsx',
		title: 'Editorial/AnalyticsConsent',
		exports: ['Undecided', 'Granted', 'Denied', 'BrowserOffSwitch', 'StorageRefused', 'AllStates'],
		expect: 'pass',
		note: 'Analytics consent — the consent states a first-time visitor meets.',
	},
	{
		file: 'src/editorial/cjk-line-break.stories.tsx',
		title: 'editorial/CJK line-break',
		exports: ['Default', 'LocaleOptIn', 'LocaleOptInWithCjkTypography'],
		expect: 'pass',
		note: 'CJK line breaking — the mixed-script typography proof.',
	},
	{
		file: 'src/editorial/error-states/error-states.stories.tsx',
		title: 'Editorial/ErrorStates',
		exports: ['Gallery', 'NotFound', 'ServiceUnavailable', 'DependencyFailure'],
		expect: 'pass',
		note: 'Error state — the documents a reader can land on.',
	},
	{
		file: 'src/editorial/forms/form-errors.stories.tsx',
		title: 'Editorial/Forms',
		exports: ['Gallery', 'Default', 'RequiredUntouched', 'WithError', 'WithSummary'],
		expect: 'pass',
		note: 'Form error — the field-level error, the summary and the untouched state.',
	},
	{
		file: 'src/editorial/glyph-headings.stories.tsx',
		title: 'editorial/Glyph headings',
		exports: ['Default'],
		expect: 'pass',
		note: 'Heading glyphs — the fr / de / pt / ru heading fixture.',
	},
	{
		file: 'src/editorial/language-of-parts.stories.tsx',
		title: 'Editorial/LanguageOfParts',
		exports: ['Gallery'],
		expect: 'pass',
		note: 'Language of parts — the `lang` attribute gallery.',
	},
	{
		file: 'src/editorial/primitives/Badge.stories.tsx',
		title: 'Editorial/Badge',
		exports: ['Neutral', 'Accent', 'AllTones'],
		expect: 'pass',
		note: 'Badge — the smallest editorial primitive.',
	},
	{
		file: 'src/editorial/primitives/Container.stories.tsx',
		title: 'editorial/Container',
		exports: ['Default', 'AsSection'],
		expect: 'pass',
		note: 'Container — the layout primitive every surface is built on.',
	},
	{
		file: 'src/editorial/primitives/SectionHeading.stories.tsx',
		title: 'editorial/SectionHeading',
		exports: ['Default', 'TitleOnly', 'WithIdForAria', 'WithChildren'],
		expect: 'pass',
		note: 'Section heading — the heading primitive with its id contract.',
	},
	{
		file: 'src/editorial/primitives/StateMark.stories.tsx',
		title: 'Editorial/StateMark',
		exports: ['Vocabulary', 'SmallSize', 'DefaultSize'],
		expect: 'pass',
		note: 'State mark — the vocabulary of the state symbols.',
	},
	{
		file: 'src/editorial/pseudo-locale-stress.stories.tsx',
		title: 'editorial/Pseudo locale stress',
		exports: ['Default'],
		expect: 'pass',
		note: 'Pseudo locale — the text-expansion stress surface.',
	},
	{
		file: 'src/editorial/table-code.stories.tsx',
		title: 'editorial/Table & code readability',
		exports: ['Normal', 'MobileWidth'],
		expect: 'pass',
		note: 'Table / code readability — the table and code-block primitives.',
	},
	{
		file: 'src/editorial/tokens.stories.tsx',
		title: 'Editorial/Tokens',
		exports: ['RawPalette', 'SemanticLayer'],
		expect: 'pass',
		note: 'Tokens — the raw palette the semantic tokens are derived from.',
	},
	{
		file: 'src/external-api/ExternalReadCard.stories.tsx',
		title: 'external-api/ExternalReadCard',
		exports: [
			'Fresh',
			'Stale',
			'TimeoutFallback',
			'Blocked',
			'FirstFailure',
			'Loading',
			'ApiTimeoutFallbackGallery',
			'Gallery',
		],
		expect: 'pass',
		note: 'External read card — the third-party read surface (Issue #499).',
	},
	{
		file: 'src/home/access/reduced-motion.stories.tsx',
		title: 'home/ReducedMotion',
		exports: ['MotionOn', 'MotionOff'],
		expect: 'pass',
		note: 'Reduced motion — the motion pair a reader can switch off.',
	},
	{
		file: 'src/home/access/tiles.stories.tsx',
		title: 'home/CounterTile',
		exports: [
			'Zero',
			'Small',
			'Mid',
			'Full',
			'Overflow',
			'Fresh',
			'Stale',
			'Disconnected',
			'LocaleEn',
			'LocaleJa',
			'LocaleKo',
		],
		expect: 'pass',
		note: 'Counter tile — the digit-strip access counter.',
	},
	{
		file: 'src/home/capabilities/grid.stories.tsx',
		title: 'home/CapabilitiesGrid',
		exports: ['AllPlanned', 'OneLive', 'Single'],
		expect: 'pass',
		note: 'Capabilities grid — the capability list with one live entry.',
	},
	{
		file: 'src/home/composer.stories.tsx',
		title: 'home/HomePage',
		exports: ['AllReachable', 'Degraded'],
		expect: 'baseline',
		note: 'Home composition — the whole home surface composed. The home status list breaks the `<dl>` content model (SC 1.3.1); the ledger records it per story.',
	},
	{
		file: 'src/home/format.stories.tsx',
		title: 'home/LocaleComparison',
		exports: ['Comparison'],
		expect: 'pass',
		note: 'Locale comparison — the same instant in several locales.',
	},
	{
		file: 'src/home/hero.stories.tsx',
		title: 'home/Hero',
		exports: ['Default', 'StackAtMd', 'Narrow'],
		expect: 'pass',
		note: 'Hero — the entry surface every visitor meets first.',
	},
	{
		file: 'src/home/reactions/widget.stories.tsx',
		title: 'home/ReactionsWidget',
		exports: ['Disabled', 'Empty', 'Populated'],
		expect: 'pass',
		note: 'Reactions widget — the emoji reaction strip.',
	},
	{
		file: 'src/home/status/tiles.stories.tsx',
		title: 'home/StatusTiles',
		exports: [
			'AllOk',
			'MixedHealth',
			'EmptyStatuses',
			'LocaleJa',
			'LocaleKo',
			'LocaleTokyo',
			'Monochrome',
			'IncidentContext',
			'NarrowViewport',
		],
		expect: 'baseline',
		note: 'Status tiles — the service-health states. The status list breaks the `<dl>` content model (SC 1.3.1); the ledger records it per story.',
	},
	{
		file: 'src/http/api-directory/catalog.stories.tsx',
		title: 'http/api-directory/PublicApiDirectory',
		exports: ['Catalog', 'EmptyState'],
		expect: 'pass',
		note: 'Public API directory — the published endpoint catalogue.',
	},
	{
		file: 'src/legal/AssetLicenseReview.stories.tsx',
		title: 'Asset license review (#497)',
		exports: [
			'AssetLicenseReviewGallery',
			'FeaturedAsset',
			'BundledFont',
			'HeldAsset',
			'ReferencedFont',
			'Gallery',
		],
		expect: 'pass',
		note: 'Asset licence review — the publication-rights surface.',
	},
	{
		file: 'src/portfolio/components/Markdown.stories.tsx',
		title: 'portfolio/Markdown',
		exports: ['SupportedSyntax', 'HostileInput', 'EmptyBody'],
		expect: 'pass',
		note: 'Portfolio markdown — the supported syntax gallery.',
	},
	{
		file: 'src/portfolio/components/ProjectCard.stories.tsx',
		title: 'portfolio/ProjectCard',
		exports: ['AllCategories', 'Monochrome', 'NoFacets'],
		expect: 'pass',
		note: 'Project card — the published project index entry.',
	},
	{
		file: 'src/tools/embed-consent-notice.stories.tsx',
		title: 'Tools/Embed consent notice',
		exports: ['ClickToLoad', 'ExternalFrame', 'MissingPurpose', 'Activated'],
		expect: 'pass',
		note: 'Embed consent notice — the third-party frame consent surface.',
	},
];

/** One story that is deliberately not audited yet, with the reason. */
export interface PendingStory {
	/** The story file, relative to the repository root. */
	readonly file: string;
	/** The exported story name inside that file. */
	readonly export: string;
	/** Why this story is not audited yet — never empty. */
	readonly reason: string;
}

/**
 * The stories that are known and deliberately not audited yet.
 *
 * Every entry states a reason. A story that is merely "not registered
 * yet" needs no entry — the gate lists those as open items — so an
 * entry here means the story was looked at and the decision to defer
 * it was made on purpose.
 */
export const PENDING_STORIES: readonly PendingStory[] = [
	{
		file: 'src/home/access/reduced-motion.stories.tsx',
		export: 'Fixture',
		reason: 'the fixture story renders the comparison harness itself, not a shipped surface',
	},
];

/**
 * One audited story, flattened out of the file entries.
 *
 * The browser audit measures one story at a time, and the ledger keys
 * on one story at a time, so the file entries are flattened once here
 * rather than at every use site.
 */
export interface AuditedStory {
	/** The story file, relative to the repository root. */
	readonly file: string;
	/** The exported story name inside that file. */
	readonly export: string;
	/** The Storybook component title the story is published under. */
	readonly title: string;
	/** The verdict this story is expected to produce. */
	readonly expect: StoryVerdict;
	/** What this file is, in one line — the audit record's prose. */
	readonly note: string;
}

/** Every audited story, flattened out of the audited file entries. */
export const AUDITED_STORIES: readonly AuditedStory[] = AUDITED_STORY_FILES.flatMap((entry) =>
	entry.exports.map((exportName) => ({
		file: entry.file,
		export: exportName,
		title: entry.title,
		expect: entry.expect,
		note: entry.note,
	})),
);
