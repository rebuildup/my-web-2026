import rawSnapshot from './snapshots/dotfiles.json' with { type: 'json' };
import {
	type FreshnessState,
	type IntroductionSection,
	MAX_AGE_HOURS,
	type ProjectIntroduction,
	type ProjectIntroductionSnapshot,
	type ProjectIntroductionView,
	type ProjectSourceProvenance,
	type RelatedRepository,
	type RichTextNode,
	SUPPORTED_SNAPSHOT_SCHEMA_VERSION,
} from './types';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_HREF_PATTERN = /^(?:https?:\/\/|mailto:)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isIsoDate(value: unknown): value is string {
	return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSafeHref(value: unknown): value is string {
	return typeof value === 'string' && SAFE_HREF_PATTERN.test(value);
}

function isRichTextNode(value: unknown): value is RichTextNode {
	if (!isRecord(value) || !isString(value.text)) return false;
	if (value.href !== undefined && !isSafeHref(value.href)) return false;
	return value.image === undefined || typeof value.image === 'boolean';
}

function isRichText(value: unknown): value is readonly RichTextNode[] {
	return Array.isArray(value) && value.every(isRichTextNode);
}

function isSource(value: unknown): value is ProjectSourceProvenance {
	if (!isRecord(value)) return false;
	if (value.id !== 'dotfiles' || value.owner !== 'rebuildup' || value.repo !== 'dotfiles') {
		return false;
	}
	if (!isString(value.ref) || !isString(value.readmePath)) return false;
	if (!isString(value.commitSha) || !COMMIT_SHA_PATTERN.test(value.commitSha)) return false;
	if (!isIsoDate(value.committedAt)) return false;
	if (!isString(value.readmeBlobSha) || !COMMIT_SHA_PATTERN.test(value.readmeBlobSha)) return false;
	if (!isSafeHref(value.canonicalUrl) || !isSafeHref(value.readmeUrl)) return false;
	return value.readmeUrl.includes(`/blob/${value.commitSha}/`);
}

function isSection(value: unknown): value is IntroductionSection {
	if (!isRecord(value)) return false;
	if (!isString(value.id) || !isString(value.heading) || !isString(value.anchor)) return false;
	if (!isSafeHref(value.sourceUrl)) return false;
	if (value.summary !== null && !isRichText(value.summary)) return false;
	if (!Array.isArray(value.points) || !value.points.every(isRichText)) return false;
	if (!Array.isArray(value.structure) || !value.structure.every(isString)) return false;
	return true;
}

function isIntroduction(value: unknown): value is ProjectIntroduction {
	if (!isRecord(value)) return false;
	if (!isString(value.title) || !isRichText(value.lead)) return false;
	if (!Array.isArray(value.sections) || !value.sections.every(isSection)) return false;
	if (!Array.isArray(value.relatedRepositories)) return false;
	return value.relatedRepositories.every(
		(entry: unknown): entry is RelatedRepository =>
			isRecord(entry) && isString(entry.repo) && isSafeHref(entry.url) && isString(entry.label),
	);
}

/**
 * Structural guard for a committed snapshot.
 *
 * This is deliberately a SHAPE check, not a digest check. The digest is
 * verified offline by `scripts/check-project-introductions.mjs`, where
 * `node:crypto` is available; duplicating SHA-256 verification in the
 * Worker would make the page depend on an async gate merely to render.
 * A hand-edited snapshot still cannot pass `validate:fast`.
 */
export function isSnapshot(value: unknown): value is ProjectIntroductionSnapshot {
	if (!isRecord(value)) return false;
	if (value.schemaVersion !== SUPPORTED_SNAPSHOT_SCHEMA_VERSION) return false;
	if (!isSource(value.source)) return false;
	if (value.availability !== 'public' && value.availability !== 'unavailable') return false;
	if (value.availability === 'unavailable') {
		if (!isRecord(value.unavailable) || !isString(value.unavailable.reason)) return false;
		if (!isIsoDate(value.unavailable.observedAt)) return false;
	} else if (value.unavailable !== null) {
		return false;
	}
	if (!isIsoDate(value.verifiedAt) || !isIsoDate(value.appliedAt)) return false;
	if (!isString(value.contentDigest) || !DIGEST_PATTERN.test(value.contentDigest)) return false;
	return isIntroduction(value.introduction);
}

/** How a snapshot's verification age presents to a visitor. */
export function evaluateFreshness(
	snapshot: ProjectIntroductionSnapshot | null,
	nowMs: number,
): FreshnessState {
	if (!snapshot) return 'unknown';
	if (snapshot.availability !== 'public') return 'unavailable';
	const verifiedAt = Date.parse(snapshot.verifiedAt);
	if (!Number.isFinite(verifiedAt)) return 'unknown';
	return nowMs - verifiedAt > MAX_AGE_HOURS * 3_600_000 ? 'stale' : 'current';
}

/**
 * The validated dotfiles introduction for the current request.
 *
 * `rawSnapshot` is a compile-time JSON import, so the page makes no
 * outbound request and reads no binding. An invalid or unsupported
 * snapshot degrades to an explicit `unknown` state rather than throwing
 * a stack trace into the document.
 */
export function getDotfilesIntroduction(nowMs: number = Date.now()): ProjectIntroductionView {
	// The JSON import is a compile-time value whose inferred literal type is
	// wider than the contract (e.g. `availability: string`). Widening the
	// input to `unknown` makes the guard a real narrowing step instead of an
	// intersection with a type the value can never satisfy.
	const candidate: unknown = rawSnapshot;
	if (!isSnapshot(candidate)) {
		return { snapshot: null, freshness: 'unknown', reason: 'snapshot-invalid' };
	}
	const freshness = evaluateFreshness(candidate, nowMs);
	const reason =
		candidate.availability === 'unavailable'
			? (candidate.unavailable?.reason ?? 'unavailable')
			: null;
	return { snapshot: candidate, freshness, reason };
}
