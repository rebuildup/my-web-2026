#!/usr/bin/env node
/**
 * Verification report for the artifact attestation gate (Issue #476).
 *
 *   node scripts/artifact-attestation-report.mjs
 *
 * Renders `docs/verification/supply-chain/artifact-sha-attestation.webp`
 * from the SAME functions `pnpm run artifact:attestation:check` uses,
 * so the picture cannot claim an agreement the gate would reject.
 *
 * The report is built from a deterministic fixture Build Output under
 * `.tmp/` (no real deployment, no production credential, no network
 * call) plus the repository's real `package.json` / `pnpm-lock.yaml`.
 * It shows:
 *
 *   1. normal observation — a fixture artifact whose digest, source
 *      commit, lockfile and version all agree; signature is stated as
 *      `unsigned`, and the deploy id is `not provided`;
 *   2. abnormal observation — four real mutations (tampered artifact,
 *      wrong source commit, changed lockfile, unsigned document that
 *      carries signature fields), each failing with its own code;
 *   3. the repair procedure, so the image is not the proof.
 *
 * The Issue names `artifact-sha-attestation.png`; the committed
 * artefact is the same image as **WebP** (≤1480 px wide, quality 80,
 * <300 KB) because a full-resolution PNG of a text report is roughly
 * an order of magnitude larger and is never read as anything but an
 * image. No PNG is written or committed.
 *
 * This is a documentation tool, not a gate: it never runs inside
 * `validate:*`. Re-run it when the gate, its fixture or its rules
 * change, and commit the regenerated image in the same change.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import {
	artifactDigest,
	buildManifest,
	readDependencyFacts,
	verifyManifest,
} from './_artifact-attestation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(root, 'docs/verification/supply-chain');
const PORT = 4603;

const MAX_WIDTH = 1480;
const WEBP_QUALITY = 80;
const MAX_BYTES = 300 * 1024;

/** Clearly synthetic, but a valid 40-character commit shape. */
const FIXTURE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OTHER_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

const escapeHtml = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * A deterministic mini Build Output. It mirrors the directory names the
 * real artifact uses (`workers/default/bundle`, `assets`) so the
 * digest describes a recognisable shape, without copying production
 * bytes, asset hashes or any environment value.
 */
function writeFixtureArtifact(dir) {
	mkdirSync(join(dir, 'workers', 'default', 'bundle'), { recursive: true });
	mkdirSync(join(dir, 'workers', 'default', 'assets', 'app'), { recursive: true });
	writeFileSync(
		join(dir, 'config.json'),
		'{"accountId":"fixture-account","buildContext":{"mode":"production","isPreview":false}}\n',
	);
	writeFileSync(
		join(dir, 'workers', 'default', 'worker.config.json'),
		'{"name":"my-web-2026","compatibilityDate":"fixture"}\n',
	);
	writeFileSync(
		join(dir, 'workers', 'default', 'bundle', 'worker.js'),
		'// fixture worker bundle\nexport default { fetch() { return new Response("ok"); } };\n',
	);
	writeFileSync(
		join(dir, 'workers', 'default', 'assets', 'app', 'index.html'),
		'<!doctype html><title>fixture</title>\n',
	);
	return dir;
}

const workDir = mkdtempSync(join(tmpdir(), 'artifact-attestation-report-'));
const fixtureDir = writeFixtureArtifact(join(workDir, 'build-output'));

try {
	const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const manifest = buildManifest({
		artifactDir: fixtureDir,
		artifactRoot: 'fixture/build-output',
		root,
		sourceCommit: FIXTURE_COMMIT,
		sourceBranch: 'fixture',
		treeState: 'clean',
	});

	// Normal observation.
	const normal = verifyManifest({
		manifest,
		artifactDir: fixtureDir,
		root,
		expectedSourceCommit: FIXTURE_COMMIT,
		requireClean: false,
	});

	// Abnormal 1: one byte changed in the shipped bundle.
	const bundlePath = join(fixtureDir, 'workers', 'default', 'bundle', 'worker.js');
	const pristineBundle = readFileSync(bundlePath);
	writeFileSync(
		bundlePath,
		'// fixture worker bundle — MUTATED after the manifest was produced\nexport default { fetch() { return new Response("ok"); } };\n',
	);
	const tampered = verifyManifest({
		manifest,
		artifactDir: fixtureDir,
		root,
		expectedSourceCommit: FIXTURE_COMMIT,
		requireClean: false,
	});
	// Restore, so the next scenarios fail for their own reason only.
	writeFileSync(bundlePath, pristineBundle);

	// Abnormal 2: the expected release / workflow commit is different.
	const wrongSource = verifyManifest({
		manifest,
		artifactDir: fixtureDir,
		root,
		expectedSourceCommit: OTHER_COMMIT,
		requireClean: false,
	});

	// Abnormal 3: the lockfile changed after the manifest was produced.
	const shadowRoot = join(workDir, 'shadow-root');
	mkdirSync(shadowRoot, { recursive: true });
	cpSync(join(root, 'package.json'), join(shadowRoot, 'package.json'));
	writeFileSync(
		join(shadowRoot, 'pnpm-lock.yaml'),
		`${readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')}\n# fixture: dependency resolution changed after the manifest\n`,
	);
	const lockDrift = verifyManifest({
		manifest,
		artifactDir: fixtureDir,
		root: shadowRoot,
		expectedSourceCommit: FIXTURE_COMMIT,
		requireClean: false,
	});

	// Abnormal 4: an "unsigned" document that carries signature fields.
	const fakeSignature = structuredClone(manifest);
	fakeSignature.signature.value = 'deadbeef'.repeat(8);
	fakeSignature.signature.algorithm = 'ed25519';
	const signatureClaim = verifyManifest({
		manifest: fakeSignature,
		artifactDir: fixtureDir,
		root,
		expectedSourceCommit: FIXTURE_COMMIT,
		requireClean: false,
	});

	const scenarios = [
		{
			id: 'tampered-artifact',
			mutation: 'one byte appended to workers/default/bundle/worker.js',
			result: tampered,
			expected: 'ARTIFACT_DIGEST_MISMATCH',
		},
		{
			id: 'wrong-source-commit',
			mutation: `expected commit ${OTHER_COMMIT.slice(0, 12)}… instead of the recorded one`,
			result: wrongSource,
			expected: 'SOURCE_COMMIT_MISMATCH',
		},
		{
			id: 'lockfile-drift',
			mutation: 'pnpm-lock.yaml changed after the manifest was produced',
			result: lockDrift,
			expected: 'LOCKFILE_DIGEST_MISMATCH',
		},
		{
			id: 'fabricated-signature',
			mutation: 'signature.status="unsigned" but algorithm/value are populated',
			result: signatureClaim,
			expected: 'SIGNATURE_INCONSISTENT',
		},
	];

	for (const scenario of scenarios) {
		if (!scenario.result.findings.some((item) => item.code === scenario.expected)) {
			throw new Error(
				`fixture "${scenario.id}" did not produce ${scenario.expected}: ${scenario.result.findings
					.map((item) => item.code)
					.join(', ')}`,
			);
		}
	}
	if (normal.status !== 'PASS') {
		throw new Error(
			`normal fixture did not pass: ${normal.findings.map((item) => item.code).join(', ')}`,
		);
	}

	const facts = readDependencyFacts({ root });
	const artifact = artifactDigest({ dir: fixtureDir });

	const checkRows = normal.checks
		.map(
			(check) => `<tr>
				<td>${escapeHtml(check.id)}</td>
				<td class="${check.status === 'PASS' ? 'ok' : 'no'}">${check.status}</td>
				<td>${escapeHtml(check.detail)}</td>
			</tr>`,
		)
		.join('');

	const scenarioRows = scenarios
		.map(
			(scenario) => `<tr>
				<td><code>${escapeHtml(scenario.id)}</code></td>
				<td>${escapeHtml(scenario.mutation)}</td>
				<td class="no">${escapeHtml(scenario.expected)}</td>
				<td class="no">FAIL</td>
			</tr>`,
		)
		.join('');

	const findingRows = scenarios
		.flatMap((scenario) =>
			scenario.result.findings
				.filter((item) => item.code === scenario.expected)
				.map(
					(item) => `<tr>
						<td><code>${escapeHtml(item.code)}</code></td>
						<td>${escapeHtml(item.message)}</td>
						<td>${escapeHtml(item.remedy)}</td>
					</tr>`,
				),
		)
		.join('');

	const metadataRows = [
		['subject', `${escapeHtml(manifest.subject.root)} (fixture Build Output)`],
		['artifact digest', `<code>${escapeHtml(artifact.digest)}</code>`],
		['artifact files / bytes', `${artifact.file_count} / ${artifact.total_bytes}`],
		['source commit', `<code>${escapeHtml(FIXTURE_COMMIT)}</code> (fixture)`],
		['source tree', 'clean (fixture)'],
		['project', `${escapeHtml(facts.project.name)}@${escapeHtml(facts.project.version)}`],
		['package manager', escapeHtml(facts.package_manager ?? '(not declared)')],
		[
			'lockfile',
			`<code>${escapeHtml(facts.lockfile.sha256)}</code> · ${facts.lockfile.packages} resolved package version(s)`,
		],
		['signature', '<strong>unsigned</strong> — no signature is claimed'],
		['Cloudflare deploy id', 'not provided — no id is invented'],
		['Cloudflare build uuid', 'not provided'],
	]
		.map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
		.join('');

	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Artifact attestation — normal and abnormal observation</title>
<style>
	:root { color-scheme: light; }
	body { margin: 0; padding: 26px 30px; background: #fbfbfa; color: #16150f;
		font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
	h1 { font-size: 18px; margin: 0 0 4px; }
	h2 { font-size: 15px; margin: 0 0 2px; }
	h3 { font-size: 13px; margin: 14px 0 4px; }
	p { margin: 2px 0 10px; }
	.muted { color: #5d5b52; }
	section { margin-top: 20px; padding-top: 13px; border-top: 1px solid #dcd9d0; }
	table { border-collapse: collapse; margin: 6px 0 10px; font-size: 12px; }
	th, td { border: 1px solid #dcd9d0; padding: 3px 8px; text-align: left; vertical-align: top; }
	th { background: #f0eee7; font-weight: 600; }
	th:first-child { white-space: nowrap; }
	.ok { color: #0a6b3d; }
	.no { color: #9b1c1c; font-weight: 600; }
	.badge { display: inline-block; padding: 1px 8px; border-radius: 3px; color: #fff; font-size: 11px; }
	.badge.pass { background: #0a6b3d; }
	.badge.fail { background: #9b1c1c; }
	code { background: #ecebe4; padding: 0 3px; border-radius: 3px; }
	pre { background: #16150f; color: #f2f1e7; padding: 8px 10px; border-radius: 4px;
		overflow-x: auto; font-size: 12px; }
	footer { margin-top: 22px; color: #5d5b52; font-size: 12px; }
</style></head>
<body>
	<h1>Deployment artifact attestation — normal and abnormal observation</h1>
	<p class="muted">my-web-2026 · Issue #476 · generated by <code>node scripts/artifact-attestation-report.mjs</code></p>
	<p class="muted">Fixture data only. No production credential is read, no Cloudflare API is called, and no secret value can appear here: the input is a synthetic Build Output plus the repository's public <code>package.json</code> / <code>pnpm-lock.yaml</code>.</p>

	<section id="normal">
		<h2>Normal observation — fixture Build Output <span class="badge pass">PASS</span></h2>
		<p class="muted">The same <code>verifyManifest()</code> the gate calls. Artifact digest, expected source commit, lockfile digest and project version agree; the document is explicitly unsigned and the absent deploy id stays null.</p>
		<table>${metadataRows}</table>
		<h3>Verification checks</h3>
		<table>
			<thead><tr><th>check</th><th>status</th><th>observed</th></tr></thead>
			<tbody>${checkRows}</tbody>
		</table>
	</section>

	<section id="abnormal">
		<h2>Abnormal observation — the gate failing <span class="badge fail">FAIL</span></h2>
		<p class="muted">Each row is a real mutation of the input, not a mocked verdict. The gate fails closed with a stable code and a repair action.</p>
		<table>
			<thead><tr><th>scenario</th><th>mutation</th><th>finding</th><th>verdict</th></tr></thead>
			<tbody>${scenarioRows}</tbody>
		</table>
		<h3>Findings and repair</h3>
		<table>
			<thead><tr><th>code</th><th>observed</th><th>repair</th></tr></thead>
			<tbody>${findingRows}</tbody>
		</table>
	</section>

	<section id="repair">
		<h2>What is claimed, and what is not</h2>
		<table>
			<tr><th>claimed</th><td>The listed bytes are the artifact that was hashed; the recorded commit, lockfile and dependency ranges are the inputs that produced them; a mismatched release commit or drifted artifact fails the gate.</td></tr>
			<tr><th>not claimed</th><td>No signature. No signing key exists in this repository, so <code>signature.status</code> is <code>unsigned</code> and every signature field is <code>null</code>. A document claiming a signature this tool cannot verify fails with <code>SIGNATURE_UNSUPPORTED</code>.</td></tr>
			<tr><th>deploy id</th><td>Recorded only when the caller supplied one. It is a status record, not an authenticated Cloudflare fact: obtaining or checking it never uses a production credential in this tool.</td></tr>
			<tr><th>production artifact</th><td>The CI manifest describes the exact Build Output CI built at the workflow commit. Attaching the manifest to the GitHub Release is a human-gated release step; see <code>docs/release.md</code>.</td></tr>
		</table>
	</section>

	<footer>
		Reproduce: <code>pnpm run artifact:attestation:report</code> ·
		<code>pnpm run artifact:attestation:check</code><br>
		Schema and repair procedure: docs/security/supply-chain-artifact-attestation.md — status-only output, no secret value is read or rendered.
	</footer>
</body></html>`;

	const server = createServer((_req, res) => {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(html);
	});
	await new Promise((resolveListen) => server.listen(PORT, '127.0.0.1', resolveListen));

	mkdirSync(OUT_DIR, { recursive: true });
	const browser = await chromium.launch();
	try {
		const pageHandle = await browser.newPage({
			viewport: { width: 1240, height: 900 },
			deviceScaleFactor: 2,
		});
		await pageHandle.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

		// Chromium captures PNG in memory; only the WebP encode is written.
		const png = await pageHandle.screenshot({ fullPage: true });
		const { data, info } = await sharp(png)
			.resize({ width: MAX_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY, effort: 6, smartSubsample: true })
			.toBuffer({ resolveWithObject: true });

		const painted = (await pageHandle.locator('body').innerText()).trim();
		if (!painted.includes('PASS') || !painted.includes('FAIL')) {
			throw new Error(`rendered report is missing its verdicts:\n${painted.slice(0, 400)}`);
		}
		if (info.width > MAX_WIDTH || data.byteLength > MAX_BYTES) {
			throw new Error(
				`artifact-sha-attestation.webp is ${info.width}x${info.height} / ${data.byteLength} bytes, ` +
					`over the ${MAX_WIDTH}px / ${MAX_BYTES} byte verification-image budget`,
			);
		}

		writeFileSync(resolve(OUT_DIR, 'artifact-sha-attestation.webp'), data);
		writeFileSync(
			resolve(OUT_DIR, 'artifact-attestation-summary.json'),
			`${JSON.stringify(
				{
					normal: {
						status: normal.status,
						source_commit: manifest.source.commit,
						artifact_digest: artifact.digest,
						artifact_files: artifact.file_count,
						artifact_bytes: artifact.total_bytes,
						lockfile_packages: facts.lockfile.packages,
						signature_status: manifest.signature.status,
						deploy_id: manifest.cloudflare.deploy_id,
					},
					abnormal: scenarios.map((scenario) => ({
						id: scenario.id,
						expected_finding: scenario.expected,
						status: scenario.result.status,
						findings: scenario.result.findings.map((item) => item.code),
					})),
				},
				null,
				'\t',
			)}\n`,
		);
		await pageHandle.close();
	} finally {
		await browser.close();
		server.close();
	}
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

console.log(
	'[artifact-attestation-report] wrote docs/verification/supply-chain/artifact-sha-attestation.webp and artifact-attestation-summary.json',
);
