#!/usr/bin/env node
// Local driver for actionlint. CI uses `rhysd/actionlint@v1` directly.
// This script is the local fallback: it downloads the actionlint binary
// to `node_modules/.bin/actionlint` if missing, then exec's it with the
// caller-supplied arguments. Once cached, subsequent runs are instant.
//
// The version pin below is intentionally specific so the local behavior
// matches the GitHub Action. Bump both together when upgrading.

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const VERSION = '1.7.7';
const REPO = 'rhysd/actionlint';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const binDir = join(root, 'node_modules', '.bin');
const binPath = join(binDir, 'actionlint');
const platformMap = {
	linux: { asset: 'linux_amd64', suffix: '.tar.gz' },
	darwin: { asset: 'macos_amd64', suffix: '.tar.gz' },
	win32: { asset: 'windows_amd64', suffix: '.zip' },
};

function assetFor() {
	const { platform, arch } = process;
	if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') {
		throw new Error(`actionlint unsupported platform: ${platform}`);
	}
	if (arch !== 'x64' && arch !== 'arm64') {
		throw new Error(`actionlint unsupported arch: ${arch}`);
	}
	const { asset, suffix } = platformMap[platform];
	const archSuffix = arch === 'arm64' && platform !== 'win32' ? '_arm64' : '';
	const file = `actionlint_${VERSION}_${asset}${archSuffix}${suffix}`;
	return {
		file,
		url: `https://github.com/${REPO}/releases/download/v${VERSION}/${file}`,
	};
}

async function download(url, dest) {
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`failed to download ${url}: HTTP ${res.status}`);
	await pipeline(res.body, createWriteStream(dest));
}

async function ensure() {
	if (existsSync(binPath)) return;
	mkdirSync(binDir, { recursive: true });
	const { file, url } = assetFor();
	const archivePath = join(binDir, file);
	console.error(
		`[lint:ci] downloading actionlint v${VERSION} (${process.platform}/${process.arch})`,
	);
	await download(url, archivePath);
	// Extract just the `actionlint` binary from the archive. tar -C with
	// an absolute path was unreliable across tar versions on linux, so
	// run tar from the binDir with a relative path instead.
	const isZip = file.endsWith('.zip');
	execFileSync(
		process.platform === 'win32' ? 'tar.exe' : 'tar',
		[isZip ? '-xf' : '-xf', file, 'actionlint'],
		{ cwd: binDir, stdio: 'inherit' },
	);
	await chmod(binPath, 0o755);
}

try {
	await ensure();
	execFileSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
} catch (err) {
	console.error(`[lint:ci] failed: ${err.message}`);
	process.exit(1);
}
