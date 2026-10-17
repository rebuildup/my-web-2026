/**
 * Error-state contract (Issue #501).
 *
 * This module owns the PUBLIC contract of the three failure surfaces
 * the platform renders when a request cannot be answered with a
 * page: `not_found` (404), `service_unavailable` (503) and
 * `dependency_failure` (an upstream data source could not be read).
 *
 * Why a contract module and not three inline components
 * -----------------------------------------------------
 * Each surface answers the same three questions — what the visitor is
 * told, what they can do next, and what is deliberately NOT published.
 * Those answers are an operational and privacy decision, not a styling
 * decision: they change when the published-information policy changes
 * (see Issue #457's redaction rules for the same reasoning on the HTTP
 * boundary), not when the palette changes. `ErrorState.tsx` renders
 * whatever this contract says, and the three per-kind components
 * (`NotFoundState`, `ServiceUnavailableState`,
 * `DependencyFailureState`) are thin named bindings of it — one
 * component per failure kind, exactly as Issue #501 asks.
 *
 * Published vs withheld (the whole point of the module)
 * ------------------------------------------------------
 * Every error state publishes ONLY:
 *   - the failure kind and its HTTP status label,
 *   - repo-controlled Japanese / English explanatory copy,
 *   - the recovery affordances that kind offers, and
 *   - the href + label of public surfaces that exist.
 *
 * No error state ever publishes a thrown value. The components do not
 * accept an `error` / `stack` / `cause` prop at all — there is no
 * parameter through which runtime detail could leak.
 * `ERROR_STATE_WITHHELD_INFO` records the classes of information that
 * stay out, and `withheldDetailNeedles()` turns the supplied throwable
 * into the probe strings the test-suite asserts are absent from the
 * rendered markup.
 *
 * Personal-data rule
 * ------------------
 * Nothing here is invented per request. The copy is a fixed constant
 * in this file, and a failure surface publishes no identity, contact
 * address, account or traffic information (Issue #501 completion
 * condition: actual facts only, no guessed personal data).
 *
 * External communication rule
 * --------------------------
 * An error state initiates NO network request of its own. The only
 * outbound traffic a failing document makes is what the shared
 * document shell already makes (async Google Fonts stylesheet, GA4
 * measurement script), and neither is required for the message to be
 * readable — see `ERROR_STATE_EXTERNAL_COMMUNICATIONS`, which records
 * the parties, the channel and the evidence file for each.
 */

/** Bilingual labels for the canonical public roster. Keyed by href. */
export const PUBLIC_SURFACE_LABELS: Readonly<Record<string, string>> = {
	'/': 'ホーム / Home',
	'/portfolio': 'ポートフォリオ / Portfolio',
	'/tools': 'ツール / Tools',
	'/about': 'プロフィール / About',
	'/contact': '連絡先 / Contact',
};

/** Closed set of failure kinds. Adding one is a published-contract change. */
export const ERROR_STATE_KINDS = [
	'not_found',
	'service_unavailable',
	'dependency_failure',
] as const;

export type ErrorStateKind = (typeof ERROR_STATE_KINDS)[number];

/**
 * Recovery affordances a state may offer.
 *
 *   - `back`        return to the previous document, or the site home.
 *   - `retry`       run the failed request again.
 *   - `alternative` open a public surface that still answers.
 */
export type ErrorStateRecoveryAction = 'back' | 'retry' | 'alternative';

export interface ErrorStateAlternative {
	/** Internal href. Always a site route — never an absolute URL. */
	href: string;
	/** Bilingual label shown to the visitor. */
	label: string;
}

/** A page-level dependency of a public surface, read at render time. */
export type ErrorStateDependency = 'd1' | 'r2';

/**
 * Canonical public surfaces (Issue #501).
 *
 * These are the five routes `src/editorial/nav/PublicNav.tsx#PUBLIC_NAV_ITEMS`
 * already publishes. Every alternative an error state offers is a
 * member of this roster, so a visitor can never be sent to a page that
 * does not exist — the exact failure this surface exists to fix.
 *
 * The dependency column is maintained by hand from each surface's
 * loader, and it is the reason a D1 / R2 outage still leaves the
 * visitor somewhere to go:
 *
 *   - `/`          reads D1 (access counter, reactions) and R2 (media).
 *   - `/portfolio` reads D1 through `src/portfolio/public.ts`.
 *   - `/about`     reads D1 for its experience subset through
 *                  `src/about/public.ts` -> `src/portfolio/load.ts`.
 *   - `/tools`     reads `src/tools/registry.ts`, which imports
 *                  `src/tools/manifest.json` at build time.
 *   - `/contact`   reads `src/contact/public.ts`, which imports
 *                  `src/contact/channels.json` at build time.
 *
 * A reviewer changing a loader MUST update this table in the same
 * commit: it is what makes the 503 / dependency-failure alternative
 * list an honest claim instead of a guess.
 */
export const PUBLIC_SURFACE_DEPENDENCIES: Readonly<
	Record<string, readonly ErrorStateDependency[]>
> = {
	'/': ['d1', 'r2'],
	'/portfolio': ['d1'],
	'/about': ['d1'],
	'/tools': [],
	'/contact': [],
};

/** Surfaces rendered without reading any platform binding at render time. */
export const DEPENDENCY_FREE_SURFACES: readonly string[] = Object.freeze(
	Object.entries(PUBLIC_SURFACE_DEPENDENCIES)
		.filter(([, dependencies]) => dependencies.length === 0)
		.map(([href]) => href),
);

export interface ErrorStateDefinition {
	kind: ErrorStateKind;
	/**
	 * The status this state REPRESENTS. See the honest caveat recorded in
	 * `docs/verification/ops/error-state-gallery.md`: TanStack Router
	 * answers an unmatched route with 404 and a thrown loader error with
	 * 500, so the `503` label on `service_unavailable` names the
	 * CONDITION. Mapping the response status is a follow-up decision.
	 */
	status: number;
	/** Short label rendered next to the headline. */
	statusLabel: string;
	/** One-word category above the headline. */
	eyebrow: string;
	/**
	 * Bilingual one-line condition, rendered under the status label.
	 * Describes the CONDITION in the visitor's terms ("a system
	 * dependency did not respond") rather than repeating the headline.
	 */
	condition: string;
	/** Bilingual headline (the `<h1>` of a failure surface). */
	headline: string;
	/** Bilingual explanation. States the condition, never the internals. */
	description: string;
	/** Recovery affordances, in render order. */
	recovery: readonly ErrorStateRecoveryAction[];
	/**
	 * Note rendered above the alternative list. Explains WHY these
	 * surfaces are expected to answer; `null` when the list is simply the
	 * whole roster.
	 */
	alternativesNote: string | null;
	/**
	 * Severity tone. `not_found` is neutral (nothing is broken),
	 * `service_unavailable` warns (a retry may succeed),
	 * `dependency_failure` is negative (a dependency rejected the read).
	 */
	tone: 'neutral' | 'warning' | 'negative';
	/**
	 * Whether the public copy may name a specific platform binding.
	 * Always `false`: the public surface cannot know WHICH binding
	 * failed, so naming one would be a guess.
	 */
	namesBinding: false;
}

const ALL_SURFACES: readonly ErrorStateAlternative[] = Object.freeze(
	Object.keys(PUBLIC_SURFACE_DEPENDENCIES).map((href) => ({
		href,
		label: PUBLIC_SURFACE_LABELS[href] ?? href,
	})),
);

const DEPENDENCY_FREE: readonly ErrorStateAlternative[] = Object.freeze(
	DEPENDENCY_FREE_SURFACES.map((href) => ({ href, label: PUBLIC_SURFACE_LABELS[href] ?? href })),
);

/**
 * The canonical contract for each failure kind.
 *
 * Copy rules applied to every entry:
 *   - Japanese first, ` / `, English — the editorial voice used by the
 *     shipped surfaces (`src/routes/tools.$slug.tsx`).
 *   - No apology theatre, no ETA the platform cannot know, no blame.
 *   - No personal data, no account state, no upstream detail.
 */
export const ERROR_STATE_DEFINITIONS: Readonly<Record<ErrorStateKind, ErrorStateDefinition>> = {
	not_found: {
		kind: 'not_found',
		status: 404,
		statusLabel: '404',
		eyebrow: 'Not found',
		condition: 'この URL にページはありません / No page exists at this URL',
		headline: 'ページが見つかりません / Page not found',
		description:
			'指定された URL に対応するページはこのサイトにはありません。古いリンク、入力の誤り、ページの移動が考えられます。下のリンクから他の公開面へ移動できます。 / No page exists at this URL. The link may be old, mistyped, or the page may have moved; the links below open the other public surfaces.',
		recovery: ['back', 'alternative'],
		// A 404 is a resolved answer, not a transient fault: re-requesting
		// the same missing URL cannot succeed, so the state offers no
		// retry button. A control that cannot work teaches visitors to
		// ignore controls.
		alternativesNote: null,
		tone: 'neutral',
		namesBinding: false,
	},
	service_unavailable: {
		kind: 'service_unavailable',
		status: 503,
		statusLabel: '503',
		eyebrow: 'Temporarily unavailable',
		condition: 'システムの一部が応答していません / Part of the system did not respond',
		headline: 'ページを一時的に表示できません / Temporarily unavailable',
		description:
			'このページの応答を準備しているシステムの一部が、今は応答していないため内容を表示できません。しばらくしてから再試行してください。 / Part of the system that prepares this page is not responding right now, so its contents cannot be shown. Please try again shortly.',
		recovery: ['retry', 'back', 'alternative'],
		alternativesNote:
			'下の面はビルド時に取り込んだリポジトリ内の内容だけで描画されるため、この状態の影響を受けずに開けます。',
		tone: 'warning',
		namesBinding: false,
	},
	dependency_failure: {
		kind: 'dependency_failure',
		status: 503,
		statusLabel: 'Dependency',
		eyebrow: 'Dependency failure',
		condition: 'データの取得に失敗しました / A data read did not succeed',
		headline: '必要なデータを取得できませんでした / Could not load the data for this page',
		description:
			'このページが前提とするデータの取得に失敗したため、内容を表示できません。通信環境を確認したうえで再試行してください。 / Reading the data this page depends on did not succeed, so its contents cannot be shown. Check your connection and try again.',
		recovery: ['retry', 'back', 'alternative'],
		alternativesNote:
			'下の面はビルド時に取り込んだリポジトリ内の内容だけで描画されるため、この取得失敗の影響を受けずに開けます。',
		tone: 'negative',
		namesBinding: false,
	},
};

/** Alternatives a state offers, derived from the roster + dependencies. */
export function alternativesFor(kind: ErrorStateKind): readonly ErrorStateAlternative[] {
	return kind === 'not_found' ? ALL_SURFACES : DEPENDENCY_FREE;
}

/** Typed accessor. An unknown kind is a programming error, not a fallback. */
export function errorStateDefinition(kind: ErrorStateKind): ErrorStateDefinition {
	return ERROR_STATE_DEFINITIONS[kind];
}

/**
 * What a failure surface publishes. Kept next to the definitions so a
 * reviewer editing the copy reads the disclosure in the same file.
 */
export const ERROR_STATE_PUBLISHED_INFO: readonly string[] = [
	'the failure kind and its HTTP status label (404 / 503 / Dependency)',
	'repo-controlled Japanese + English explanatory copy',
	'the recovery affordances the kind offers (back / retry / alternative surfaces)',
	'the href and label of each offered public surface',
];

/**
 * What a failure surface never publishes. Each entry is a class of
 * information, not an implementation note.
 */
export const ERROR_STATE_WITHHELD_INFO: readonly string[] = [
	'the thrown value, its message, its stack, and any nested `cause`',
	'binding-level detail (SQL text, row counts, D1 database id, R2 bucket or object keys)',
	'runtime identifiers (request id, colo, Worker version pins, env var names or values)',
	'visitor identity (session, account, IP address, user agent, referrer)',
	'third-party service identity or SLA detail — no third-party integration is promoted (docs/domain/integrations.md)',
];

/**
 * Measured exception to the withheld list.
 *
 * Kept as its own declaration because it is a fact about the RESPONSE, not
 * about the components: TanStack Start serialises a failed match's
 * `error.message` into the `$_TSR` hydration payload. Its
 * `ShallowErrorPlugin` serialises `{ message }` and nothing else, so neither
 * a stack nor a nested `cause` ships — but the message does appear in the
 * page source of a failure document, and no component can remove it (the only
 * lever is a custom `startInstance`, which AGENTS.md §2 forbids without an
 * ADR).
 *
 * `test/integration/error-states.test.ts` pins both halves of this: the
 * rendered document publishes none of it, and the payload still carries the
 * message. The rendering half is what this Issue owns; the payload half is
 * recorded in `docs/verification/ops/error-state-gallery.md` as a follow-up.
 */
export const ERROR_STATE_PUBLICATION_EXCEPTIONS: readonly string[] = [
	"the SSR hydration payload `$_TSR` carries the failed match's `error.message` (framework `ShallowErrorPlugin`); the rendered document carries none of it",
];

/**
 * Outbound communication a failing document can still make.
 *
 * The audit target for Issue #501: an error state itself initiates
 * nothing, and neither of these two requests is required for the
 * failure message to render — the fonts stylesheet is loaded
 * asynchronously (`media="print"` + inline flip) and the measurement
 * script is best-effort. A reader with a blocked third party still
 * gets the message in the platform font stack.
 */
export const ERROR_STATE_EXTERNAL_COMMUNICATIONS: readonly {
	party: string;
	channel: string;
	initiatedBy: 'browser' | 'server' | 'none';
	requiredForMessage: boolean;
	evidence: string;
}[] = [
	{
		party: 'Google Fonts',
		channel: 'stylesheet + font files (Noto Sans JP / Zen Kaku Gothic New)',
		initiatedBy: 'browser',
		requiredForMessage: false,
		evidence: 'src/routes/__root.tsx (async stylesheet, media="print" + inline flip script)',
	},
	{
		party: 'Google Analytics 4',
		channel: 'measurement script + page_view beacon',
		initiatedBy: 'browser',
		requiredForMessage: false,
		evidence: 'src/editorial/analytics/GoogleAnalytics.tsx (measurement id is optional)',
	},
	{
		party: 'third-party API',
		channel: 'none — no server-side outbound integration is promoted',
		initiatedBy: 'none',
		requiredForMessage: false,
		evidence: 'docs/domain/integrations.md (Current state: none promoted)',
	},
];

/**
 * Probe strings derived from the withheld-information list, plus the
 * supplied throwable.
 *
 * The rendered markup is asserted to contain NONE of these. Passing a
 * real `Error` is the point: it proves a surface does not publish a
 * throwable even when one is available in scope.
 */
export function withheldDetailNeedles(error?: unknown): readonly string[] {
	const probes: string[] = [
		// Stack-frame marker. Spelled with the newline + indent a real stack
		// frame has, so ordinary prose ("exists at this URL") is not a hit.
		'\n    at ',
		'Error:',
		'SELECT ',
		'select ',
		'SQLITE_',
		'workers.dev',
		'Bearer ',
		'api_key',
	];
	if (error instanceof Error) {
		if (error.message) probes.push(error.message);
		if (error.stack) probes.push(error.stack);
		const cause = (error as { cause?: unknown }).cause;
		if (cause instanceof Error && cause.message) probes.push(cause.message);
	}
	return probes;
}
