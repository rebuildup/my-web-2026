#!/usr/bin/env node
/**
 * R2 key-set audit (Issue #577, owner option (a)).
 *
 * The claim it enforces
 * ---------------------
 * The `MEDIA` bucket is served by a **public R2 custom domain**
 * (`docs/portfolio/decisions.md` Decision 5). That path runs no Worker
 * code, so the namespace allowlist in
 * `src/cloudflare/media-visibility.ts` can only stop this repository
 * from *emitting* a URL for a non-public key — it cannot stop an object
 * that is already in the bucket from being fetched by anyone who guesses
 * its key. This gate closes that half: it reads the bucket's key set
 * and fails when a single key is outside `PUBLIC_MEDIA_PREFIXES`.
 *
 * Why the audit is a release gate rather than a CI step
 * -----------------------------------------------------
 * It needs the R2-scoped credential (`CLOUDFLARE_R2_API_TOKEN`) and a
 * remote read. **No GitHub Actions workflow in this repository holds a
 * Cloudflare credential** (that is the deliberate separation behind
 * `docs/runbook/cloudflare-workers-builds.md`), so there is nothing for
 * CI to authenticate with, and this gate is deliberately absent from
 * `validate:fast` / `validate:integration` / `validate:release`. It is
 * an operator step run against production with the R2 token before the
 * release; `quality/profile.yaml#r2_media_key_set_audit` records the
 * decision, and `docs/runbook/r2-media-key-set-audit.md` is the
 * procedure. The same reasoning as the dependency-advisory gate
 * (Issue #470), one step stricter: that one only needs a public
 * endpoint.
 *
 * Status-only output
 * ------------------
 * The verdict, the counts, and a reason CODE are printed. No object
 * key, no key fragment, no credential, and no raw CLI error text — the
 * output must be safe to paste into a PR, an issue, or a CI log, and
 * must not become a second enumeration surface for the bucket
 * (`docs/runbook/infisical-secrets.md` is the precedent). The report
 * is checked against the keys it audited before it is written, so the
 * rule is enforced by the tool rather than by reviewer discipline.
 *
 * Fail-closed
 * -----------
 * A missing credential, an API error, an unparseable page, an
 * incomplete pagination walk, and an empty production key set are all
 * `UNDECIDABLE` with a non-zero exit. Nothing about this gate can
 * report "unknown" as "fine".
 *
 * Usage:
 *   node scripts/check-r2-media-key-set.mjs --target=production
 *   node scripts/check-r2-media-key-set.mjs --target=local
 *   node scripts/check-r2-media-key-set.mjs --fixture=<path>   # demonstration only
 *
 * Exit codes: 0 = every key is inside the allowlist, 1 = at least one
 * key is outside it, 2 = undecidable (including a usage error).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUBLIC_MEDIA_PREFIXES, isPublicMediaKey } from '../src/cloudflare/media-visibility.ts';
import { R2_BUCKET_NAME } from './_cloudflare-identity.mjs';
import {
	DEFAULT_PER_PAGE,
	UNDECIDABLE_REASON,
	assertNoKeyInText,
	auditKeySet,
	collectBucketKeys,
	exitCodeFor,
	formatAuditReport,
	readPageKeys,
	undecidableAudit,
} from './_r2-media-key-set.mjs';
import { listObjectKeysPage } from './_r2.mjs';

const PREFIX_SOURCE = 'src/cloudflare/media-visibility.ts';

const USAGE = `Usage:
  node scripts/check-r2-media-key-set.mjs --target=production [--per-page=N]
  node scripts/check-r2-media-key-set.mjs --target=local
  node scripts/check-r2-media-key-set.mjs --fixture=<path>

--target       local (default) or production. Only "production" audits
               the real delivery surface; "local" proves the wiring
               against the ephemeral store and says nothing about it.
--per-page     page size for the read (default ${DEFAULT_PER_PAGE}, which is
               also the R2 maximum). A page that comes back full is
               reported as listing_incomplete, never as a whole bucket.
--fixture      audit a recorded listing instead of a live bucket. This
               is a demonstration and a test input, never a release
               verdict: the output says source=fixture, and combining
               it with --target=production is a usage error.`;

function parseArgs(argv) {
	const options = { target: 'local', perPage: DEFAULT_PER_PAGE, fixture: null, help: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
		else if (arg.startsWith('--per-page='))
			options.perPage = Number(arg.slice('--per-page='.length));
		else if (arg.startsWith('--fixture=')) options.fixture = arg.slice('--fixture='.length);
		else return { ...options, error: `unknown argument: ${arg}` };
	}
	if (options.target !== 'local' && options.target !== 'production') {
		return {
			...options,
			error: `--target must be local or production (got a third value; there is no "remote" target)`,
		};
	}
	if (
		!Number.isInteger(options.perPage) ||
		options.perPage < 1 ||
		options.perPage > DEFAULT_PER_PAGE
	) {
		return { ...options, error: `--per-page must be an integer between 1 and ${DEFAULT_PER_PAGE}` };
	}
	// A recorded listing must never be mistakable for the production
	// surface, so the combination is refused rather than silently
	// resolved in favour of the fixture.
	if (options.fixture && options.target === 'production') {
		return { ...options, error: '--fixture cannot be combined with --target=production' };
	}
	return options;
}

function emit(audit, meta, keys, stream = process.stdout) {
	const text = formatAuditReport(audit, meta);
	// Enforced, not promised: the formatter may never name a key.
	assertNoKeyInText(text, keys);
	stream.write(text);
}

/**
 * Turn an enumerated key set into a verdict.
 *
 * `emptyIsUndecidable` is the one target-dependent rule, and it is
 * deliberate. An empty *production* key set is indistinguishable from a
 * listing that silently returned nothing, so it fails closed; an empty
 * *local* store is the normal state of a fresh checkout and means
 * nothing is exposed, so it is a pass. A recorded fixture that holds no
 * keys is demonstrating the undecidable path, so it fails closed too.
 */
function finalizeAudit(keys, pagesWalked, { emptyIsUndecidable }) {
	if (keys.length === 0 && emptyIsUndecidable) {
		return { audit: undecidableAudit(UNDECIDABLE_REASON.listingEmpty, pagesWalked), keys };
	}
	return { audit: auditKeySet(keys, isPublicMediaKey, { pagesWalked }), keys };
}

/**
 * Run the audit against a live bucket.
 */
async function auditBucket({ target, perPage }) {
	if (target === 'production' && !process.env.CLOUDFLARE_R2_API_TOKEN) {
		return { audit: undecidableAudit(UNDECIDABLE_REASON.credentialMissing), keys: [] };
	}

	let keys;
	let pagesWalked = 0;
	try {
		const collected = await collectBucketKeys({
			listPage: ({ perPage: size }) => listObjectKeysPage({ target, perPage: size }),
			perPage,
		});
		if ('reason' in collected) {
			return { audit: undecidableAudit(collected.reason, collected.pagesWalked), keys: [] };
		}
		keys = collected.keys;
		pagesWalked = collected.pagesWalked;
	} catch {
		// A failed read is undecidable, never a violation of the
		// allowlist and never a pass. The raw error is deliberately not
		// echoed: it is the one string this tool cannot vouch for, and
		// the runbook tells the operator how to reproduce the read.
		return { audit: undecidableAudit(UNDECIDABLE_REASON.listingFailed), keys: [] };
	}

	return finalizeAudit(keys, pagesWalked, { emptyIsUndecidable: target === 'production' });
}

/**
 * Run the audit against a recorded listing (tests and demonstrations).
 *
 * A fixture is one CLI response and is read as one page, so the
 * completeness rule applies to it exactly as it does to a live read.
 */
function auditFixture(path) {
	let listing;
	try {
		const parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
		listing = typeof parsed?.listing === 'string' ? parsed.listing : null;
	} catch {
		return { audit: undecidableAudit(UNDECIDABLE_REASON.inputUnreadable), keys: [] };
	}
	if (listing === null)
		return { audit: undecidableAudit(UNDECIDABLE_REASON.inputUnreadable), keys: [] };

	const collected = readPageKeys(listing);
	if ('reason' in collected) return { audit: undecidableAudit(collected.reason), keys: [] };
	return finalizeAudit(collected.keys, 1, { emptyIsUndecidable: true });
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	if (options.error) {
		process.stderr.write(`${options.error}\n${USAGE}\n`);
		return 2;
	}

	const source = options.fixture ? 'fixture' : options.target;
	const { audit, keys } = options.fixture
		? auditFixture(options.fixture)
		: await auditBucket({ target: options.target, perPage: options.perPage });

	emit(
		audit,
		{
			source,
			target: options.fixture ? 'fixture' : options.target,
			bucket: R2_BUCKET_NAME,
			prefixCount: PUBLIC_MEDIA_PREFIXES.length,
			prefixSource: PREFIX_SOURCE,
		},
		keys,
	);

	// The verdict is not the only signal: a demonstration run must not
	// be mistakable for a release verdict in a pasted log.
	if (options.fixture) {
		process.stdout.write('[r2-key-set] note=fixture input; this is NOT a release verdict\n');
	}
	return exitCodeFor(audit);
}

process.exit(await main());
