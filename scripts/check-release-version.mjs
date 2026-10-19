#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
	throw new Error(`package.json version is not semantic: ${version}`);
}

const headRefs = [process.env.GITHUB_HEAD_REF, process.env.GITHUB_REF_NAME].filter(Boolean);
let enforced = false;
for (const ref of headRefs) {
	const match = /^release-(\d+)-(\d+)-(\d+)$/.exec(ref);
	if (!match) continue;
	enforced = true;
	const branchVersion = `${match[1]}.${match[2]}.${match[3]}`;
	if (branchVersion !== version) {
		throw new Error(
			`release branch ${ref} requires package.json version ${branchVersion}, got ${version}`,
		);
	}
}

// On pull_request events GITHUB_HEAD_REF is the ticket branch and
// GITHUB_REF_NAME is "<pr>/merge", so no release name matches above.
// Independent ticket PRs always target the release trunk, so fall back
// to GITHUB_BASE_REF before giving up enforcement.
if (!enforced) {
	const baseRef = process.env.GITHUB_BASE_REF;
	const baseMatch = baseRef ? /^release-(\d+)-(\d+)-(\d+)$/.exec(baseRef) : null;
	if (baseMatch) {
		enforced = true;
		const baseVersion = `${baseMatch[1]}.${baseMatch[2]}.${baseMatch[3]}`;
		if (baseVersion !== version) {
			throw new Error(
				`pull request base ${baseRef} requires package.json version ${baseVersion}, got ${version}`,
			);
		}
	}
}

// Never a silent no-op: when no release name is derivable from any ref,
// say so on stdout so silence is never mistaken for verification.
if (!enforced) {
	console.log(
		'version:check note: no release-x-y-z ref in GITHUB_HEAD_REF/GITHUB_REF_NAME/GITHUB_BASE_REF, skipping release-name enforcement (push to a non-release branch, or a pull request whose base is not a release branch; stacked PRs and main-targeted PRs are intentionally unenforced).',
	);
}

const versionModule = readFileSync('src/home/version.ts', 'utf8');
if (
	!versionModule.includes("from '../../package.json'") ||
	/['"]\d+\.\d+\.\d+['"]/.test(versionModule)
) {
	throw new Error(
		'src/home/version.ts must derive the current version from package.json without a literal.',
	);
}

const health = readFileSync('src/http/hono.ts', 'utf8');
if (/version:\s*['"]\d+\.\d+\.\d+['"]/.test(health)) {
	throw new Error('/api/v1/health must derive its version instead of hard-coding a release.');
}

function collectFiles(path) {
	const entries = readdirSync(path, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const child = join(path, entry.name);
		return entry.isDirectory() ? collectFiles(child) : [child];
	});
}

const activePaths = [
	'README.md',
	'.dev.vars.example',
	...collectFiles('src'),
	...collectFiles('test'),
	...collectFiles('e2e'),
	...collectFiles('scripts'),
];
const releaseLiteral = /(?<![\d.])v?0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?![\d.])/;
const offenders = activePaths.filter((path) => releaseLiteral.test(readFileSync(path, 'utf8')));
if (offenders.length > 0) {
	throw new Error(
		[
			'Project release literals are forbidden in active source/test/script surfaces.',
			'Derive the current version from package.json; keep historical release numbers only in ADRs, migrations, release history, or other explicitly historical records.',
			...offenders.map((path) => `- ${path}`),
		].join('\n'),
	);
}

console.log(`release version source OK: ${version}`);
