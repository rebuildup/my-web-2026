#!/usr/bin/env node
/**
 * publish-github-activity — operator-side auto-update for the
 * committed GitHub activity snapshot (Issues #316 / #319 / #932).
 *
 * Why this exists instead of a GitHub Actions workflow
 * -----------------------------------------------------
 * The snapshot's private-repo half needs `GITHUB_TOKEN` (a PAT that
 * can read the owner's private repositories) and
 * `GITHUB_ACTIVITY_SALT` (the HMAC salt behind the stable
 * `private-<hmac12>` ids). `quality/actions-pins.json` approves ZERO
 * repository-secret references by policy — runtime credentials are
 * Infisical-owned and must not become a CI credential path. The
 * honest auto-update is therefore an operator-side scheduled job:
 * this script does exactly what the (rejected) workflow would have
 * done, in a throwaway git worktree, with secrets injected by
 * `infisical run` into THIS process only.
 *
 * What it does
 * ------------
 *   1. Creates a temporary git worktree on `github-activity-sync`
 *      from `origin/<base>` (default `release-0-9-0`, override with
 *      `--base <ref>`).
 *   2. Runs `sync-github-activity.mjs` INSIDE that worktree — the
 *      script resolves its output path from its own location, so
 *      the snapshot lands in the temp tree, never in the caller's
 *      checkout.
 *   3. Runs `check-github-activity.mjs` (the privacy/shape gate).
 *   4. Commits + pushes only when the snapshot changed, using the
 *      remote-resolved lease from `_projects-sync-push.mjs`
 *      (Issue #739 — never the naive `--force-with-lease`).
 *   5. Opens or updates the review PR against `<base>` via `gh`.
 *      It never merges, tags or deploys.
 *
 * Environment (inherited; inject via `infisical run --env=dev --`):
 *   GITHUB_TOKEN            PAT with `repo` scope (private repos)
 *   GITHUB_ACTIVITY_SALT    HMAC salt — MUST be the same value every
 *                           run or private-anon ids would change
 *   GH_TOKEN                gh CLI auth for the PR step (defaults to
 *                           the gh keyring when unset)
 *
 * Exit 0 = published or nothing-to-publish; 1 = failure (nothing is
 * pushed on failure — the temp worktree is always removed).
 * `--dry-run` performs steps 1–3 and prints the diff summary only.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishBranch } from './_projects-sync-push.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_BRANCH = 'github-activity-sync';
const SNAPSHOT_PATH = 'src/home/activity/github-activity.json';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const baseIdx = argv.indexOf('--base');
const BASE = baseIdx >= 0 ? argv[baseIdx + 1] : (process.env.ACTIVITY_SYNC_BASE ?? 'release-0-9-0');
if (!BASE) {
	console.error('publish-github-activity: --base requires a ref');
	process.exit(2);
}

const log = (msg) => console.log(`[activity-sync] ${msg}`);
const git = (args, cwd = REPO_ROOT) =>
	spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function run(cmd, args, cwd) {
	const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'inherit' });
	if (res.status !== 0) {
		throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}`);
	}
}

function main() {
	// Resolve the remote base BEFORE touching anything local.
	const lsRemote = git(['ls-remote', 'origin', `refs/heads/${BASE}`]);
	if (lsRemote.status !== 0 || !lsRemote.stdout.trim()) {
		throw new Error(`origin/${BASE} not found — pass --base <active release ref>`);
	}
	git(['fetch', 'origin', BASE]);

	const tmp = mkdtempSync(join(tmpdir(), 'activity-sync-'));
	try {
		// Temp worktree ON the sync branch, rooted at the release base.
		run('git', ['worktree', 'add', tmp, '-B', SYNC_BRANCH, `origin/${BASE}`]);

		// The base branch may predate this tooling (the publish job is
		// operator-side and runs from the caller's checkout). Copy the
		// two self-contained scripts in so the temp tree always runs
		// THIS checkout's sync/check logic, never a stale base copy.
		for (const name of ['sync-github-activity.mjs', 'check-github-activity.mjs']) {
			copyFileSync(join(REPO_ROOT, 'scripts', name), join(tmp, 'scripts', name));
		}

		// Refresh + validate INSIDE the temp tree.
		run('node', [join(tmp, 'scripts/sync-github-activity.mjs')], tmp);
		run('node', [join(tmp, 'scripts/check-github-activity.mjs')], tmp);

		const diff = git(['diff', '--stat', 'HEAD', '--', SNAPSHOT_PATH], tmp);
		if (!diff.stdout.trim()) {
			log('snapshot unchanged — nothing to publish');
			return;
		}
		log(`snapshot changed:\n${diff.stdout.trim()}`);
		if (dryRun) {
			log('dry-run: stopping before commit/push');
			return;
		}

		git(['config', 'user.name', 'github-actions[bot]'], tmp);
		git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], tmp);
		git(['add', SNAPSHOT_PATH], tmp);
		git(['commit', '-m', 'chore(home): refresh the GitHub activity snapshot'], tmp);

		const push = publishBranch({ remote: 'origin', branch: SYNC_BRANCH, cwd: tmp });
		if (push.status !== 0) {
			throw new Error(`publish push exited ${push.status}`);
		}
		log(`pushed ${SYNC_BRANCH}`);

		// Open or update the review PR (never merge).
		const existing = execFileSync(
			'gh',
			[
				'pr',
				'list',
				'--head',
				SYNC_BRANCH,
				'--base',
				BASE,
				'--state',
				'open',
				'--json',
				'number',
				'--jq',
				'.[0].number // empty',
			],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		).trim();
		if (existing) {
			log(`updated existing pull request #${existing}`);
			return;
		}
		const body = [
			'## 概要',
			'',
			'GitHub API から `src/home/activity/github-activity.json` を再生成しました。',
			'この PR は operator 側の `publish-github-activity` job が自動で作成・更新しています。',
			'',
			'## 確認',
			'',
			'- `check-github-activity` が snapshot の shape と公開境界',
			'  （非公開リポジトリの匿名化）を検証済み',
			'- 非公開リポジトリは `private-<hmac>` の安定匿名 ID のみで、',
			'  名前・URL・owner・ブランチ・コミットメッセージを含みません',
			'',
			'## マージ',
			'',
			'release へ取り込むタイミングは人間が判断します。job は merge / tag / deploy を行いません。',
			'',
			'Refs #316 #319 #932',
		].join('\n');
		const pr = execFileSync(
			'gh',
			[
				'pr',
				'create',
				'--base',
				BASE,
				'--head',
				SYNC_BRANCH,
				'--title',
				'chore(home): GitHub アクティビティ snapshot を更新',
				'--body',
				body,
			],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		).trim();
		log(`opened ${pr}`);
	} finally {
		git(['worktree', 'remove', '--force', tmp]);
		rmSync(tmp, { recursive: true, force: true });
	}
}

try {
	main();
} catch (err) {
	console.error(`publish-github-activity failed: ${err.message}`);
	process.exit(1);
}
