#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
	throw new Error(`package.json version is not semantic: ${version}`);
}

const refs = [process.env.GITHUB_HEAD_REF, process.env.GITHUB_REF_NAME].filter(Boolean);
for (const ref of refs) {
	const match = /^release-(\d+)-(\d+)-(\d+)$/.exec(ref);
	if (!match) continue;
	const branchVersion = `${match[1]}.${match[2]}.${match[3]}`;
	if (branchVersion !== version) {
		throw new Error(
			`release branch ${ref} requires package.json version ${branchVersion}, got ${version}`,
		);
	}
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

const currentFacing = [
	'README.md',
	'src/home/hero.tsx',
	'src/home/brief.md',
	'src/home/capabilities/grid.tsx',
	'src/admin/composer.tsx',
	'src/admin/invitations/accept-view.tsx',
];
for (const path of currentFacing) {
	const text = readFileSync(path, 'utf8');
	if (/\bv0\.\d+\.\d+\b/.test(text)) {
		throw new Error(
			`${path} contains a duplicated current-style v0.x.y literal; derive or remove it.`,
		);
	}
}

console.log(`release version source OK: ${version}`);
