import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	HEARTBEAT_HOURS,
	LIMITS,
	PROJECT_SOURCES,
	ProjectSourceUnavailable,
	ageHours,
	assertAllowedApiUrl,
	buildPublicSnapshot,
	buildUnavailableSnapshot,
	contentDigestOf,
	extractIntroduction,
	fetchPublicSnapshot,
	planSnapshotWrite,
	resolveSourceHref,
	resolveSourceImage,
	richTextToPlainText,
	serializeSnapshot,
	validateSnapshot,
} from './_project-introduction.mjs';

const SOURCE = PROJECT_SOURCES.dotfiles;
const SHA = '237af590cca2afe48ccd47ff3f81538d2297899c';
const BLOB = '61b16651099890ee38bb6c28b76471c689acde7c';
const NOW = new Date('2026-10-20T12:00:00.000Z');

const README = `# dotfiles

Personal user-level configuration for my development machines.

Machine/package provisioning belongs in [\`rebuildup/pc-setup\`](https://github.com/rebuildup/pc-setup).
This repository owns the user configuration that is linked into \`$HOME\`.

## Setup

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/rebuildup/pc-setup/main/bootstrap.sh | bash
\`\`\`

Do not publish this setup paragraph.

### NixOS

Nested setup detail must not become a top-level section.

## Principles

- Keep only configuration that I actually use.
- Linking is [idempotent](docs/adr/ADR-0001.md) and non-destructive.
- <script>alert('from-bullet')</script>Secret values are not Git state.
- Secret values live at https://secrets.example.invalid; identity stays in \`~/.gitconfig.local\`.

## Layout

\`\`\`text
.
├── .infisical.json       # tracked binding
├── config/
│   ├── infisical.sh      # non-secret metadata
│   └── agent-init.bash
├── agents/
├── home/
├── script/
│   └── bootstrap
├── docs/
└── AGENTS.md
\`\`\`

Layout commentary is not a published paragraph.

## Agent launcher (\`agent\`)

The native \`claude\` command keeps the official login. See [launcher](docs/agent-launcher.md) and [the layout](#layout).

## Agent configuration

Global agent repositories are pinned as sibling submodules under \`agents/\`.

\`\`\`text
agents/
├── common/
├── claude/
├── codex/
└── opencode/
\`\`\`

## Secret model

\`\`\`bash
infisical login --domain=https://secrets.example.invalid
\`\`\`

The project id must never reach the page: d4c2fc09-a923-4a38-9cf4-b51769aadb76

## Decisions and research

- [\`ADR-0001\`](docs/adr/ADR-0001.md) — plain symlink deployment
- [\`ADR-0002\`](docs/adr/ADR-0002.md) — pc-setup boundary
- [unsafe](javascript:alert(1)) — must be plain text
`;

function contentsPayload(text, sha = BLOB) {
	return {
		type: 'file',
		path: 'README.md',
		encoding: 'base64',
		content: Buffer.from(text, 'utf8')
			.toString('base64')
			.replace(/(.{60})/g, '$1\n'),
		sha,
	};
}

function repositoryPayload() {
	return {
		full_name: 'rebuildup/dotfiles',
		private: false,
		visibility: 'public',
		archived: false,
		disabled: false,
		default_branch: 'main',
		html_url: 'https://github.com/rebuildup/dotfiles',
	};
}

function commitPayload(sha = SHA) {
	return { sha, commit: { committer: { date: '2026-10-19T14:24:36Z' } } };
}

/** A fake fetch that records every request and answers the allowlist. */
function fakeFetch({ readme = README, repo = repositoryPayload(), commit = commitPayload() } = {}) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init });
		if (url.endsWith('/repos/rebuildup/dotfiles')) {
			return new Response(JSON.stringify(repo), { status: 200 });
		}
		if (url.endsWith('/repos/rebuildup/dotfiles/commits/main')) {
			return new Response(JSON.stringify(commit), { status: 200 });
		}
		if (url.includes('/contents/README.md')) {
			return new Response(JSON.stringify(contentsPayload(readme)), { status: 200 });
		}
		return new Response('{}', { status: 500 });
	};
	return { fetchImpl, calls };
}

describe('source allowlist', () => {
	it('accepts exactly the three declared reads', () => {
		const base = 'https://api.github.com/repos/rebuildup/dotfiles';
		assert.doesNotThrow(() => assertAllowedApiUrl(base, SOURCE));
		assert.doesNotThrow(() => assertAllowedApiUrl(`${base}/commits/main`, SOURCE));
		assert.doesNotThrow(() =>
			assertAllowedApiUrl(`${base}/contents/README.md?ref=${SHA}`, SOURCE, { commitSha: SHA }),
		);
	});

	it('rejects another host, owner, path, query or fragment', () => {
		for (const url of [
			'https://api.example.com/repos/rebuildup/dotfiles',
			'https://api.github.com/repos/rebuildup/pc-setup',
			'https://api.github.com/repos/rebuildup/dotfiles/contents/.infisical.json',
			'https://api.github.com/repos/rebuildup/dotfiles/contents/README.md',
			`https://api.github.com/repos/rebuildup/dotfiles/contents/README.md?ref=${SHA}&x=1`,
			`https://api.github.com/repos/rebuildup/dotfiles/contents/README.md?ref=${'a'.repeat(40)}`,
			'https://api.github.com/repos/rebuildup/dotfiles/commits/main?per_page=100',
			'https://api.github.com/repos/rebuildup/dotfiles#fragment',
			'https://user:pass@api.github.com/repos/rebuildup/dotfiles',
			'http://api.github.com/repos/rebuildup/dotfiles',
		]) {
			assert.throws(
				() => assertAllowedApiUrl(url, SOURCE, { commitSha: SHA }),
				/reject|allowlist/,
				url,
			);
		}
	});

	it('reads only the README pinned to the resolved commit, with no credential', async () => {
		const { fetchImpl, calls } = fakeFetch();
		await fetchPublicSnapshot({ now: NOW, fetchImpl });
		assert.equal(calls.length, 3);
		assert.ok(calls[2].url.includes(`?ref=${SHA}`));
		for (const call of calls) {
			assert.equal(call.init.redirect, 'error');
			assert.equal(call.init.headers.authorization, undefined);
			assert.equal(call.init.headers.Authorization, undefined);
		}
	});
});

describe('extraction and sanitization', () => {
	const introduction = extractIntroduction(README, { source: SOURCE, commitSha: SHA });

	it('keeps the title and the lead that names the dotfiles / pc-setup boundary', () => {
		assert.equal(introduction.title, 'dotfiles');
		const lead = richTextToPlainText(introduction.lead);
		assert.match(lead, /user-level configuration/);
		assert.match(lead, /pc-setup/);
		assert.doesNotMatch(lead, /<a|<\/|\$HOME bootstrap/);
		assert.deepEqual(introduction.relatedRepositories, [
			{
				repo: 'pc-setup',
				url: 'https://github.com/rebuildup/pc-setup',
				label: 'rebuildup/pc-setup',
			},
		]);
	});

	it('publishes only the allowlisted sections', () => {
		assert.deepEqual(
			introduction.sections.map((section) => section.id),
			['principles', 'layout', 'agent-launcher', 'agent-configuration', 'decisions-and-research'],
		);
		const headings = introduction.sections.map((section) => section.heading);
		assert.ok(!headings.includes('Setup'));
		assert.ok(!headings.includes('Secret model'));
	});

	it('does not carry any text from a script/style block or the secret model', () => {
		const serialized = serializeSnapshot({
			introduction,
			source: { commitSha: SHA },
		});
		assert.doesNotMatch(serialized, /from-bullet/);
		assert.doesNotMatch(serialized, /d4c2fc09/);
		assert.doesNotMatch(serialized, /<script|javascript:/);
	});

	it('generalizes operator endpoints and machine-local config paths', () => {
		const serialized = serializeSnapshot({
			introduction,
			source: { commitSha: SHA },
		});
		assert.doesNotMatch(serialized, /secrets\.example\.invalid/);
		assert.doesNotMatch(serialized, /\.gitconfig/);
		assert.match(serialized, /a private endpoint/);
		assert.match(serialized, /machine-local Git config file/);
	});

	it('resolves relative links, anchors and images against the pinned commit', () => {
		const href = resolveSourceHref('docs/adr/ADR-0001.md', { source: SOURCE, commitSha: SHA });
		assert.equal(href, `${SOURCE.canonicalUrl}/blob/${SHA}/docs/adr/ADR-0001.md`);
		assert.equal(
			resolveSourceHref('#layout', { source: SOURCE, commitSha: SHA }),
			`${SOURCE.canonicalUrl}/blob/${SHA}/README.md#layout`,
		);
		assert.equal(
			resolveSourceImage('assets/arch.png', { source: SOURCE, commitSha: SHA }),
			`https://raw.githubusercontent.com/rebuildup/dotfiles/${SHA}/assets/arch.png`,
		);
		assert.equal(
			resolveSourceHref('javascript:alert(1)', { source: SOURCE, commitSha: SHA }),
			null,
		);
		assert.equal(resolveSourceHref('data:text/html,x', { source: SOURCE, commitSha: SHA }), null);
		assert.equal(resolveSourceHref('../../escape.md', { source: SOURCE, commitSha: SHA }), null);
	});

	it('keeps an unsafe link as plain text rather than an href', () => {
		const last = introduction.sections.at(-1);
		const unsafe = last.points.at(-1);
		assert.match(richTextToPlainText(unsafe), /^unsafe/);
		assert.equal(
			unsafe.some((node) => node.href),
			false,
		);
	});

	it('uses GitHub-shaped heading anchors and pins each section URL', () => {
		const layout = introduction.sections.find((section) => section.id === 'layout');
		assert.equal(layout.anchor, 'layout');
		assert.equal(layout.sourceUrl, `${SOURCE.canonicalUrl}/blob/${SHA}/README.md#layout`);
		assert.deepEqual(layout.structure, [
			'.infisical.json',
			'config',
			'agents',
			'home',
			'script',
			'docs',
			'AGENTS.md',
		]);
		assert.ok(layout.structure.length <= LIMITS.structureEntries);
	});
});

describe('snapshot identity and no-op behaviour', () => {
	function snapshotAt(now = NOW, readme = README, previous = null) {
		return buildPublicSnapshot({
			source: SOURCE,
			commitSha: SHA,
			committedAt: '2026-10-19T14:24:36.000Z',
			readmeBlobSha: BLOB,
			readmeText: readme,
			now,
			previous,
		});
	}

	it('is deterministic for the same source and content', () => {
		assert.deepEqual(snapshotAt(), snapshotAt());
	});

	it('changes the content digest when the README fixture changes', () => {
		const changed = README.replace(
			'Keep only configuration that I actually use.',
			'Keep only configuration that I actually need.',
		);
		const before = snapshotAt();
		const after = snapshotAt(NOW, changed);
		assert.notEqual(before.contentDigest, after.contentDigest);
		assert.notEqual(
			richTextToPlainText(before.introduction.sections[0].points[0]),
			richTextToPlainText(after.introduction.sections[0].points[0]),
		);
	});

	it('does not rewrite an unchanged snapshot before the heartbeat', () => {
		const previous = snapshotAt(NOW);
		const next = snapshotAt(new Date(NOW.getTime() + 60 * 60 * 1000), README, previous);
		assert.equal(next.appliedAt, previous.appliedAt);
		assert.deepEqual(planSnapshotWrite(previous, next, new Date(NOW.getTime() + 60 * 60 * 1000)), {
			write: false,
			reason: 'unchanged',
		});
	});

	it('writes a heartbeat after the declared interval', () => {
		const previous = snapshotAt(NOW);
		const later = new Date(NOW.getTime() + (HEARTBEAT_HOURS + 1) * 3_600_000);
		const next = snapshotAt(later, README, previous);
		assert.equal(next.appliedAt, previous.appliedAt);
		assert.deepEqual(planSnapshotWrite(previous, next, later), {
			write: true,
			reason: 'heartbeat',
		});
		assert.ok((ageHours(previous.verifiedAt, later) ?? 0) > HEARTBEAT_HOURS);
	});

	it('writes immediately when content changes', () => {
		const previous = snapshotAt(NOW);
		const later = new Date(NOW.getTime() + 60 * 60 * 1000);
		const next = snapshotAt(later, README.replace('idempotent', 'repeatable'), previous);
		assert.deepEqual(planSnapshotWrite(previous, next, later), {
			write: true,
			reason: 'content-changed',
		});
		assert.equal(next.appliedAt, later.toISOString());
	});

	it('preserves the last known introduction when the source becomes unavailable', () => {
		const previous = snapshotAt(NOW);
		const unavailable = buildUnavailableSnapshot(previous, 'not-public', NOW);
		assert.equal(unavailable.availability, 'unavailable');
		assert.equal(unavailable.unavailable.reason, 'not-public');
		assert.equal(unavailable.verifiedAt, previous.verifiedAt);
		assert.deepEqual(unavailable.introduction, previous.introduction);
		assert.deepEqual(planSnapshotWrite(previous, unavailable, NOW), {
			write: true,
			reason: 'availability-changed',
		});
	});
});

describe('fetch orchestration', () => {
	it('records a deleted repository as not-found and writes nothing itself', async () => {
		const fetchImpl = async () => new Response('{}', { status: 404 });
		await assert.rejects(
			() => fetchPublicSnapshot({ now: NOW, fetchImpl }),
			(error) => error instanceof ProjectSourceUnavailable && error.reason === 'not-found',
		);
	});

	it('records a private repository as not-public', async () => {
		const { fetchImpl } = fakeFetch({
			repo: { ...repositoryPayload(), private: true, visibility: 'private' },
		});
		await assert.rejects(
			() => fetchPublicSnapshot({ now: NOW, fetchImpl }),
			(error) => error instanceof ProjectSourceUnavailable && error.reason === 'not-public',
		);
	});

	it('records an archived repository as archived', async () => {
		const { fetchImpl } = fakeFetch({ repo: { ...repositoryPayload(), archived: true } });
		await assert.rejects(
			() => fetchPublicSnapshot({ now: NOW, fetchImpl }),
			(error) => error instanceof ProjectSourceUnavailable && error.reason === 'archived',
		);
	});

	it('a changed fixture produces a changed page snapshot', async () => {
		const before = await fetchPublicSnapshot({ now: NOW, fetchImpl: fakeFetch().fetchImpl });
		const changedReadme = README.replace(
			'Keep only configuration that I actually use.',
			'Keep only configuration that I actually need.',
		);
		const after = await fetchPublicSnapshot({
			now: NOW,
			fetchImpl: fakeFetch({ readme: changedReadme }).fetchImpl,
		});
		assert.notEqual(before.contentDigest, after.contentDigest);
		assert.notEqual(
			richTextToPlainText(before.introduction.sections[0].points[0]),
			richTextToPlainText(after.introduction.sections[0].points[0]),
		);
	});
});

describe('snapshot validation', () => {
	function valid() {
		return buildPublicSnapshot({
			source: SOURCE,
			commitSha: SHA,
			committedAt: '2026-10-19T14:24:36.000Z',
			readmeBlobSha: BLOB,
			readmeText: README,
			now: NOW,
		});
	}

	it('accepts what the builder produces', () => {
		assert.deepEqual(validateSnapshot(valid()), []);
	});

	it('rejects a hand-edited introduction', () => {
		const snapshot = valid();
		snapshot.introduction.title = 'tampered';
		assert.match(validateSnapshot(snapshot).join('\n'), /contentDigest/);
	});

	it('rejects an unsafe href even when the digest is recomputed', () => {
		const snapshot = valid();
		snapshot.introduction.lead.push({ text: 'x', href: 'javascript:alert(1)' });
		snapshot.contentDigest = contentDigestOf(SOURCE, SHA, BLOB, snapshot.introduction);
		assert.match(validateSnapshot(snapshot).join('\n'), /scheme is not publishable/);
	});

	it('rejects a snapshot for an unallowlisted source', () => {
		const snapshot = valid();
		snapshot.source.id = 'pc-setup';
		assert.match(validateSnapshot(snapshot).join('\n'), /allowlisted source/);
	});

	it('rejects a README URL that is not pinned to the recorded commit', () => {
		const snapshot = valid();
		snapshot.source.readmeUrl = `${SOURCE.canonicalUrl}/blob/main/README.md`;
		assert.match(validateSnapshot(snapshot).join('\n'), /pinned README URL/);
	});
});
