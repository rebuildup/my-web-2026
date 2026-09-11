#!/usr/bin/env node
// Local driver for actionlint. This script is the single source of
// truth for workflow YAML lint — both local `pnpm run validate:*` and
// CI's `validate` job invoke it. It downloads the actionlint binary
// to `node_modules/.bin/actionlint` if missing, then exec's it with
// the caller-supplied arguments. Once cached, subsequent runs are
// instant.
//
// The version pin below is intentionally specific so local behaviour
// is reproducible. Bump it when upgrading the lint toolchain.

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { chmod, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const VERSION = '1.7.12';
const REPO = 'rhysd/actionlint';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const binDir = join(root, 'node_modules', '.bin');
const binPath = join(binDir, 'actionlint');

// Explicit {platform}/{arch} → release asset mapping. Each entry must
// match an actual asset name published at
// https://github.com/rhysd/actionlint/releases/tag/v${VERSION}.
const platformMap = {
	'linux/x64': { asset: `actionlint_${VERSION}_linux_amd64`, suffix: '.tar.gz', exe: 'actionlint' },
	'linux/arm64': {
		asset: `actionlint_${VERSION}_linux_arm64`,
		suffix: '.tar.gz',
		exe: 'actionlint',
	},
	'darwin/x64': {
		asset: `actionlint_${VERSION}_darwin_amd64`,
		suffix: '.tar.gz',
		exe: 'actionlint',
	},
	'darwin/arm64': {
		asset: `actionlint_${VERSION}_darwin_arm64`,
		suffix: '.tar.gz',
		exe: 'actionlint',
	},
	'win32/x64': {
		asset: `actionlint_${VERSION}_windows_amd64`,
		suffix: '.zip',
		exe: 'actionlint.exe',
	},
	'win32/arm64': {
		asset: `actionlint_${VERSION}_windows_arm64`,
		suffix: '.zip',
		exe: 'actionlint.exe',
	},
};

function assetFor() {
	const key = `${process.platform}/${process.arch}`;
	const entry = platformMap[key];
	if (!entry) {
		throw new Error(`actionlint unsupported platform/arch: ${key}`);
	}
	const file = `${entry.asset}${entry.suffix}`;
	return {
		file,
		url: `https://github.com/${REPO}/releases/download/v${VERSION}/${file}`,
		exe: entry.exe,
	};
}

async function download(url, dest) {
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`failed to download ${url}: HTTP ${res.status}`);
	await pipeline(res.body, createWriteStream(dest));
}

async function ensure() {
	// If a cached binary already exists, verify it matches the pinned
	// VERSION. A previous run with a different pin (or a corrupted
	// download) must trigger a re-fetch instead of being silently
	// reused.
	if (existsSync(binPath)) {
		try {
			const cachedVersion = execFileSync(binPath, ['--version'], {
				encoding: 'utf8',
			}).trim();
			if (cachedVersion.startsWith(VERSION)) return;
			console.error(
				`[lint:ci] cached actionlint ${cachedVersion.split(' ')[0]} != requested ${VERSION}; re-downloading`,
			);
		} catch {
			console.error('[lint:ci] cached actionlint unreadable; re-downloading');
		}
	}
	mkdirSync(binDir, { recursive: true });
	const { file, url, exe } = assetFor();
	const archivePath = join(binDir, file);
	console.error(
		`[lint:ci] downloading actionlint v${VERSION} (${process.platform}/${process.arch})`,
	);
	await download(url, archivePath);
	// Extract the `actionlint` binary from the archive. tar -C with
	// an absolute path was unreliable across tar versions on linux, so
	// run tar from the binDir with a relative path instead.
	const isZip = file.endsWith('.zip');
	execFileSync(
		process.platform === 'win32' ? 'tar.exe' : 'tar',
		[isZip ? '-xf' : '-xf', file, exe],
		{ cwd: binDir, stdio: 'inherit' },
	);
	// The archive extracts the platform-native name (actionlint.exe on
	// Windows). Copy / rename it to the stable `binPath` name so the
	// final `execFileSync(binPath, …)` line is platform-agnostic.
	await copyFile(join(binDir, exe), binPath);
	await chmod(binPath, 0o755);
}

try {
	await ensure();
	execFileSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
} catch (err) {
	console.error(`[lint:ci] failed: ${err.message}`);
	process.exit(1);
}
