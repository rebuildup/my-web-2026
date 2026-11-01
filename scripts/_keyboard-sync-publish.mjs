#!/usr/bin/env node

/**
 * Publish a refreshed keyboard-layout snapshot as a review pull request
 * (Issue #719).
 *
 * What this module owns
 * ----------------------
 * The SHAPE of the publication, and the push that carries it:
 *
 *   1. the automation branch name and the base branch the review pull
 *      request targets;
 *   2. the changed-file list, normalised to repository-relative paths;
 *   3. the title and the body a reviewer reads;
 *   4. the push itself, which is delegated to the lease module
 *      `scripts/_projects-sync-push.mjs` (Issue #739) instead of being
 *      re-implemented. That module resolves the expectation from the
 *      REMOTE's current state and always passes an explicit lease, so
 *      a concurrent push is rejected instead of overwriting somebody
 *      else's snapshot.
 *
 * What this module deliberately does NOT do
 * ------------------------------------------
 * It never merges, never tags, never deploys and never approves. A
 * human merges the pull request (AGENTS.md §6). It reads no credential
 * and no repository secret: the upstream fetch is public and
 * unauthenticated, and the git push is authenticated by the workflow's
 * own `GITHUB_TOKEN`, which this module never sees.
 *
 * The base branch is never guessed. When the configured base is unset,
 * the caller is told so and stops; a wrong base would open a pull
 * request against a branch nobody reviews.
 *
 * Output is status-only: branch names, paths and counts. No source
 * content, no credential, no token.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishBranch } from './_projects-sync-push.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The automation branch the workflow publishes to. */
export const KEYBOARD_SYNC_BRANCH = 'keyboard-layout-sync';

/**
 * The repository variable that names the branch the review pull request
 * targets. It is set at sprint cut to the active release branch, the
 * same way `PROJECTS_SYNC_BASE_REF` names the project-introduction
 * sync's base.
 */
export const KEYBOARD_SYNC_BASE_REF_VARIABLE = 'KEYBOARD_SYNC_BASE_REF';

/** Where the committed snapshot lives, relative to the repository root. */
export const SOURCES_PREFIX = 'src/keyboard/sources';

/** The commit message the workflow uses. English, per AGENTS.md §1. */
export const COMMIT_MESSAGE = 'chore(keyboard): refresh the keyboard layout snapshot';

/** The review pull request title. Japanese, per AGENTS.md §1. */
export const PR_TITLE = 'chore(keyboard): キーボード配列のスナップショットを更新';

/** Raised when the publication cannot be planned at all. */
export class KeyboardPublishError extends Error {
	constructor(message) {
		super(message);
		this.name = 'KeyboardPublishError';
	}
}

/**
 * The configured base branch, or `null` when it is not configured.
 *
 * The workflow passes the repository variable in the environment; the
 * base is never derived from the current branch.
 */
export function resolveBaseRef(env = process.env) {
	const value = env[KEYBOARD_SYNC_BASE_REF_VARIABLE];
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}

/**
 * Normalise a changed-file list to repository-relative paths.
 *
 * The sync reports paths relative to the snapshot root; a reviewer and
 * `git add` need them relative to the repository root. Both forms are
 * accepted so the caller never has to know which one it holds.
 */
export function normalizeChangedFiles(changedFiles) {
	const normalized = [];
	for (const entry of changedFiles ?? []) {
		if (typeof entry !== 'string') continue;
		const trimmed = entry.trim();
		if (trimmed.length === 0) continue;
		const relative = trimmed.startsWith(`${SOURCES_PREFIX}/`)
			? trimmed.slice(SOURCES_PREFIX.length + 1)
			: trimmed;
		normalized.push(`${SOURCES_PREFIX}/${relative}`);
	}
	return [...new Set(normalized)].sort();
}

/**
 * The body a reviewer reads.
 *
 * It states what the workflow did, what it did NOT do, and who merges.
 */
export function publishBody({ base, branch, changedFiles }) {
	const fileList = changedFiles.map((file) => `- \`${file}\``).join('\n');
	return [
		'## 概要',
		'',
		'`/keyboard` が表示するキーボード配列のスナップショットを、公開 upstream から再取得しました。',
		'この PR は `Keyboard layout sync` workflow が自動で作成・更新しています。',
		'',
		'## 変更',
		'',
		fileList.length > 0 ? fileList : '- (変更なし)',
		'',
		'## 確認',
		'',
		'- 取得は allowlist された 4 path のみ（token なし・redirect 禁止・サイズ上限あり）',
		'- 書き込み前に bounded parser とキー数で検証しています',
		'- upstream が変化していないときは commit も PR を作りません',
		'- upstream が取得できないときは `unavailable` / `error` として記録し、',
		'  直近のスナップショットを current として扱いません',
		'',
		'## マージ',
		'',
		`base は \`${base}\`、head は \`${branch}\` です。`,
		'リリースへ取り込むタイミングは人間が判断します。',
		'workflow は merge / tag / deploy を行いません。',
		'',
		'Refs #620, #719',
	].join('\n');
}

/**
 * Plan the publication.
 *
 * - `no-change` when nothing changed: there is no commit and no pull
 *   request, and the caller must not create either;
 * - `publish` otherwise, with the branch, the base and the changed
 *   file list the reviewer will see.
 *
 * @param {{changedFiles: string[], baseRef?: string | null, branch?: string}} input
 */
export function planKeyboardPublish({ changedFiles, baseRef, branch = KEYBOARD_SYNC_BRANCH } = {}) {
	const files = normalizeChangedFiles(changedFiles);
	if (files.length === 0) {
		return {
			status: 'no-change',
			branch,
			base: null,
			changedFiles: [],
			title: PR_TITLE,
			body: '',
			commitMessage: COMMIT_MESSAGE,
		};
	}
	if (typeof baseRef !== 'string' || baseRef.trim().length === 0) {
		throw new KeyboardPublishError(
			`vars.${KEYBOARD_SYNC_BASE_REF_VARIABLE} is unset; set it to the active release-x-y-z branch.`,
		);
	}
	const base = baseRef.trim();
	return {
		status: 'publish',
		branch,
		base,
		changedFiles: files,
		title: PR_TITLE,
		body: publishBody({ base, branch, changedFiles: files }),
		commitMessage: COMMIT_MESSAGE,
	};
}

/**
 * Publish the automation branch with an explicit lease.
 *
 * The lease module (Issue #739) resolves the expectation from the
 * remote's current state, so a concurrent push is refused instead of
 * overwriting another run's snapshot.
 */
export function publishKeyboardBranch({ remote, branch, cwd = ROOT, run, dryRun = false } = {}) {
	if (!remote || !branch) {
		throw new KeyboardPublishError('both --remote and --branch are required');
	}
	return publishBranch({ remote, branch, cwd, ...(run ? { run } : {}), dryRun });
}

function parseArgs(argv) {
	const options = { command: argv[0] ?? '' };
	for (let index = 1; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === '--remote') {
			options.remote = next;
			index += 1;
			continue;
		}
		if (arg === '--branch') {
			options.branch = next;
			index += 1;
			continue;
		}
		if (arg === '--base') {
			options.base = next;
			index += 1;
			continue;
		}
		if (arg === '--changed-files') {
			options.changedFiles = (next ?? '')
				.split(',')
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);
			index += 1;
			continue;
		}
		if (arg === '--out') {
			options.out = next;
			index += 1;
			continue;
		}
		if (arg === '--dry-run') {
			options.dryRun = true;
			continue;
		}
		throw new KeyboardPublishError(`unknown argument: ${arg}`);
	}
	return options;
}

function main(argv) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 2;
	}

	if (options.command === 'plan') {
		let plan;
		try {
			plan = planKeyboardPublish({
				changedFiles: options.changedFiles ?? [],
				baseRef: options.base ?? resolveBaseRef(),
			});
		} catch (error) {
			process.stderr.write(`${error.message}\n`);
			return 2;
		}
		const json = `${JSON.stringify(plan, null, 2)}\n`;
		if (options.out) {
			writeFileSync(options.out, json);
			process.stdout.write(
				`keyboard-publish: plan ${plan.status} (${plan.changedFiles.length} file(s))\n`,
			);
			return 0;
		}
		process.stdout.write(json);
		return 0;
	}

	if (options.command === 'push') {
		let outcome;
		try {
			outcome = publishKeyboardBranch({
				remote: options.remote,
				branch: options.branch,
				dryRun: options.dryRun ?? false,
			});
		} catch (error) {
			process.stderr.write(`keyboard-publish: failed (${error.message})\n`);
			return 1;
		}
		if (options.dryRun) {
			process.stdout.write(
				`keyboard-publish: would push ${options.branch} with lease ${outcome.expectedSha ?? '<absent>'}\n`,
			);
			return 0;
		}
		if (!outcome.published) {
			process.stderr.write(
				'keyboard-publish: rejected (the remote moved under us). The snapshot was NOT published; the committed snapshot stays as it was until the next successful run.\n',
			);
			return 1;
		}
		process.stdout.write(
			`keyboard-publish: published ${options.branch} (lease ${outcome.expectedSha ?? '<absent>'})\n`,
		);
		return 0;
	}

	process.stderr.write(
		'usage: node scripts/_keyboard-sync-publish.mjs push --remote <remote> --branch <branch>\n' +
			'       node scripts/_keyboard-sync-publish.mjs plan --base <ref> --changed-files <a,b> [--out <file>]\n',
	);
	return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main(process.argv.slice(2)));
}
