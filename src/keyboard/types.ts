/**
 * Keyboard layout — safe intermediate display model (Issue #620).
 *
 * The page renders three PUBLIC sources:
 *
 *   - `rebuildup/key-map-kanata` — the Windows and macOS Kanata
 *     configurations.
 *   - `rebuildup/pc-setup` — the macOS `hidutil` Onishi mapping and
 *     the installer that pins the adopted Kanata config ref.
 *
 * Nothing here is fetched at request time. The sources are committed
 * verbatim under `src/keyboard/sources/` by
 * `scripts/sync-keyboard-layout.mjs`; this module is the shape the
 * page reads after parsing them, so a source that cannot be parsed
 * becomes an explicit `unavailable` platform instead of a plausible
 * looking diagram.
 *
 * The action model deliberately preserves structure:
 *
 *   - a tap-hold is `{ tap, hold, timing }`, never one character;
 *   - an alias keeps both the `@reference` the layer wrote and the
 *     form it resolved to;
 *   - an unsupported Kanata form keeps its raw text and is rendered
 *     as `unknown` with a description, never silently dropped.
 *
 * Labels and descriptions are NOT stored in the model. `format.ts`
 * derives them from the structure, so the source snapshot stays small
 * and a rendering rule change never rewrites the data.
 */

/** The public platforms the page compares. */
export type KeyboardPlatformId = 'macos' | 'windows';

/** Kanata layer groups used for the page's layer selector. */
export type KeyboardLayerGroup = 'base' | 'hub' | 'symbols' | 'automation' | 'mouse' | 'extra';

/** Base family a layer belongs to (`null` for a platform-only layer). */
export type KeyboardFamily = 'onishi' | 'qwerty' | null;

/**
 * One action a key can emit.
 *
 * `raw` always carries the source form (or the atom) that produced
 * the action, so a future Kanata construct the parser does not know
 * is still visible to the reader.
 */
export type KeyboardActionKind =
	| 'key'
	| 'chord'
	| 'tap-hold'
	| 'layer-switch'
	| 'layer-while-held'
	| 'layer-toggle'
	| 'one-shot'
	| 'macro'
	| 'dynamic-macro'
	| 'mouse'
	| 'transparent'
	| 'blocked'
	| 'unknown';

/** One step inside a `(macro …)` form: an action or a delay. */
export type KeyboardStep =
	| { readonly kind: 'action'; readonly action: KeyboardAction }
	| { readonly kind: 'delay'; readonly ms: number };

export interface KeyboardAction {
	/** Source form: the atom, alias reference, or serialized s-expression. */
	readonly raw: string;
	readonly kind: KeyboardActionKind;
	/**
	 * The `@alias` the layer wrote, when the action came through one.
	 * Kept so the detail panel can show `@spco` beside the resolved
	 * tap-hold form instead of collapsing the two.
	 */
	readonly reference?: string;
	/** Base key atom for `key` / `chord` (`z` in `M-S-z`, `-` in `S--`). */
	readonly key?: string;
	/** Kanata modifier prefixes, in source order (`M`, `S`, …). */
	readonly modifiers?: readonly string[];
	/** Target layer id for a layer action. */
	readonly layer?: string;
	/** Tap branch of a tap-hold. */
	readonly tap?: KeyboardAction;
	/** Hold branch of a tap-hold. */
	readonly hold?: KeyboardAction;
	/** Tap / hold thresholds in milliseconds, when the form declares them. */
	readonly timing?: {
		readonly tapMs: number | null;
		readonly holdMs: number | null;
	};
	/** Inner action of `one-shot`. */
	readonly action?: KeyboardAction;
	/** `one-shot` timeout in milliseconds. */
	readonly timeoutMs?: number | null;
	/** `macro` steps, including explicit delays. */
	readonly steps?: readonly KeyboardStep[];
	/** `macro-repeat` interval in milliseconds. */
	readonly repeatMs?: number | null;
	/** Original form head for mouse / dynamic-macro actions. */
	readonly operation?: string;
	/** Fixed note for a construct that is displayed but not interpreted. */
	readonly note?: string;
}

/** Physical / input geometry for one platform's diagram. */
export interface KeyboardGeometry {
	readonly platform: KeyboardPlatformId;
	readonly layout: string;
	readonly capSource: 'physical' | 'defsrc';
	/** Number of keys per visual row. */
	readonly rowWidths: readonly number[];
	/** Width units per key, in `defsrc` order. */
	readonly widths: readonly number[];
	/** Cap label per key, in `defsrc` order. */
	readonly caps: readonly string[];
	readonly note: string;
}

/** One layer of one platform, aligned to the platform's `defsrc`. */
export interface KeyboardLayer {
	/** Kanata layer name, e.g. `hub-o`. */
	readonly id: string;
	/** Display label, e.g. `HUB（大西）`. */
	readonly label: string;
	readonly group: KeyboardLayerGroup;
	readonly family: KeyboardFamily;
	/** One action per `defsrc` key, in the same order. */
	readonly keys: readonly KeyboardAction[];
}

/** A decoded `hidutil` mapping (macOS Onishi base). */
export interface KeyboardHidMapping {
	/** HID usage id, as written in `onishi.json`. */
	readonly fromUsage: number;
	readonly toUsage: number;
	/** Friendly key name for the physical key, or the raw usage id. */
	readonly fromKey: string;
	readonly toKey: string;
}

/**
 * Platform status is part of the public contract:
 *
 *   - `ready` — parsed and rendered;
 *   - `unavailable` — the source or its parse failed; `reason` is a
 *     fixed public sentence, never a parser exception.
 */
export type KeyboardPlatformStatus = 'ready' | 'unavailable';

export interface KeyboardPlatform {
	readonly id: KeyboardPlatformId;
	readonly label: string;
	readonly layout: string;
	readonly status: KeyboardPlatformStatus;
	/** Fixed public reason, present when `status === 'unavailable'`. */
	readonly reason?: string;
	/** Provenance: which manifest source ids feed this platform. */
	readonly sourceIds: readonly string[];
	/** Presentation notes that apply to the whole platform. */
	readonly notes: readonly string[];
	/** Kanata `defsrc`, in source order. */
	readonly defsrc: readonly string[];
	readonly layers: readonly KeyboardLayer[];
	/** macOS `hidutil` base remap, when the platform has one. */
	readonly hidutil?: {
		readonly mappings: readonly KeyboardHidMapping[];
		readonly note: string;
	};
	/**
	 * `true` when the diagram labels the keys Kanata receives rather
	 * than physical key positions. The Windows config says so itself:
	 * `defsrc` is the post-ChgKey input list, not a keyboard picture.
	 */
	readonly capSource: 'physical' | 'defsrc';
}

/** Where a source came from. */
export type KeyboardSourceRole = 'repository-latest' | 'pc-setup-adopted';

export interface KeyboardSourceRecord {
	/** Stable id used by `KeyboardPlatform.sourceIds`. */
	readonly id: string;
	readonly repository: string;
	/** Commit SHA the bytes were read at. Never a branch name. */
	readonly ref: string;
	readonly path: string;
	readonly role: KeyboardSourceRole;
	/** The exact allowlisted URL the sync step requested. */
	readonly url: string;
	/** SHA-256 of the committed bytes. */
	readonly sha256: string;
	readonly bytes: number;
	/** When this ref was fetched. */
	readonly fetchedAt: string;
	/** The platform that consumes the bytes; omitted for metadata-only sources. */
	readonly platform?: KeyboardPlatformId;
	/** Why a metadata-only source is listed. */
	readonly usedFor?: 'adoption-ref';
	readonly note?: string;
}

export interface KeyboardAdoption {
	/** Source record whose ref is adopted. */
	readonly sourceId: string;
	/** Installer source that declares the ref. */
	readonly declaredBySourceId: string;
	readonly declaredRef: string;
	readonly note: string;
}

/** Committed provenance manifest written by the sync script. */
export interface KeyboardManifest {
	readonly schemaVersion: 1;
	/** When the committed source set was last synchronised. */
	readonly syncedAt: string;
	readonly sources: readonly KeyboardSourceRecord[];
	readonly adoption: KeyboardAdoption;
}

/** The parsed platform set, before freshness is applied. */
export interface KeyboardCatalog {
	readonly platforms: readonly KeyboardPlatform[];
	/** Non-fatal parse notes (a layer with an unknown action, …). */
	readonly warnings: readonly string[];
}

/** Public safe states for the whole page. */
export type KeyboardPageData =
	| {
			readonly status: 'ready';
			readonly catalog: KeyboardCatalog;
			readonly manifest: KeyboardManifest;
			readonly syncedAt: string;
			readonly ageDays: number;
			readonly freshness: 'fresh' | 'stale';
			readonly staleAfterDays: number;
	  }
	| {
			readonly status: 'unavailable';
			readonly reason: 'invalid-manifest' | 'no-sources';
			readonly message: string;
			readonly detailCodes: readonly string[];
	  };

/** A source older than this is displayed, but labelled stale. */
export const KEYBOARD_STALE_AFTER_DAYS = 45;

/** The first layer selected when the page opens. */
export const KEYBOARD_DEFAULT_LAYER = 'onishi';
