import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CurrentProjects } from './CurrentProjects';
import type { CurrentProjectRecord, ProjectFact, ProjectWeightLevel } from './types';

/**
 * The rendered "現在地 / Where I am now" section (Issue #316).
 *
 * `renderToStaticMarkup` is the shipped rendering path — the same call the
 * SSR document is built from — so what is asserted here is the markup a
 * browser receives, not an internal string.
 *
 * Two families of assertion matter:
 *
 *   - what the document SAYS: three dimensions per row (start, last update,
 *     weight/activity), each measured value followed by its source, and a
 *     summary line that names the base date and the counting window;
 *   - what the document does NOT say: no "未記入", no dash, no zero standing
 *     in for "not measured", and no motion markup in a document that cannot
 *     know what this browser saw last (the change marker is client-only).
 */
const TODAY = '2026-11-01';

function fact<T>(value: T, source: ProjectFact<T>['source'] = 'handwritten'): ProjectFact<T> {
	return { value, source, observedOn: TODAY };
}

function render(projects: readonly CurrentProjectRecord[]): string {
	return renderToStaticMarkup(<CurrentProjects projects={projects} today={TODAY} />);
}

const FULL: CurrentProjectRecord = {
	id: 'my-web-2026',
	name: 'my-web-2026',
	statusJa: '個人 Web Platform の再構築。',
	startedOn: fact('2026-09-11', 'git'),
	updatedOn: fact('2026-10-20', 'git'),
	weight: {
		activity: fact({ commits: 2424, windowDays: 30, commitsTotal: 2910 }, 'git'),
	},
};

const BARE: CurrentProjectRecord = {
	id: 'tastile',
	name: 'Tastile',
	statusJa: 'scheduling を扱う product。',
};

describe('CurrentProjects — the section', () => {
	it('names the section with its own heading', () => {
		const html = render([FULL]);
		expect(html).toContain('aria-labelledby="current-projects-heading"');
		expect(html).toContain('id="current-projects-heading"');
		expect(html).toContain('現在地 / Where I am now');
	});

	it('states the total, the base date and the counting window', () => {
		const html = render([FULL, BARE]);
		expect(html).toContain('全 2 件。2026-11-01 時点・直近 30 日の更新は 1 件です。');
	});

	it('says so when nothing was updated inside the window', () => {
		const html = render([BARE]);
		expect(html).toContain('直近 30 日の更新はありません。');
	});

	it('publishes one row per project', () => {
		const html = render([FULL, BARE]);
		expect(html.match(/data-testid="home-current-project"/g)).toHaveLength(2);
		expect(html).toContain('my-web-2026');
		expect(html).toContain('個人 Web Platform の再構築。');
		expect(html).toContain('Tastile');
	});
});

describe('CurrentProjects — the three dimensions', () => {
	it('prints the start date with its derived duration', () => {
		const html = render([FULL]);
		expect(html).toContain('開始');
		expect(html).toContain('2026-09-11（1 か月）');
	});

	it('prints the last update with its relative day', () => {
		const html = render([FULL]);
		expect(html).toContain('最終更新');
		expect(html).toContain('2026-10-20（12 日前）');
	});

	it('prints the activity with its window, the total as context, and the day it was measured', () => {
		const html = render([FULL]);
		expect(html).toContain('直近 30 日');
		// The window ends on the day the source measured it, never on
		// "today" — a snapshot that has aged must say so.
		expect(html).toContain('2,424 commits / 累計 2,910（2026-11-01 時点）');
	});

	it('says where every measured value came from', () => {
		const html = render([FULL]);
		const sources = html.match(/data-testid="home-current-project-source"/g) ?? [];
		expect(sources).toHaveLength(3);
		expect(html.match(/>git</g)).toHaveLength(3);
	});

	it('shows 手書き for a hand-written value next to a git one', () => {
		const html = render([{ ...FULL, updatedOn: fact('2026-10-20', 'handwritten') }]);
		expect(html).toContain('>手書き<');
		expect(html).toContain('>git<');
	});
});

describe('CurrentProjects — absent facts are omitted, not filled', () => {
	it('renders no meta list for a project with no measured fact', () => {
		const html = render([BARE]);
		expect(html).not.toContain('data-testid="home-current-project-meta"');
		expect(html).not.toContain('未記入');
		// No label/value pair exists at all — the arrow of the section eyebrow
		// is not a placeholder, so the assertion is on the list, not on any
		// em dash in the page.
		expect(html).not.toContain('<dt');
	});

	it('renders no activity row for a project that cannot be measured', () => {
		const html = render([{ ...FULL, weight: undefined }]);
		// The summary line always names the counting window, so the assertion
		// is on the row's label, not on the sentence.
		expect(html.match(/<dt[^>]*>直近 30 日<\/dt>/g)).toBeNull();
		expect(html.match(/data-testid="home-current-project-source"/g)).toHaveLength(2);
		expect(html).toContain('2026-09-11（1 か月）');
	});

	it('drops a record whose structure does not hold up', () => {
		const broken: CurrentProjectRecord = {
			...FULL,
			id: 'broken',
			name: '壊れた記録',
			startedOn: fact('2026-10-20', 'git'),
			updatedOn: fact('2026-09-11', 'git'),
		};
		const html = render([FULL, broken]);
		expect(html).not.toContain('壊れた記録');
	});
});

describe('CurrentProjects — weight as structure', () => {
	const LEVELLED: readonly CurrentProjectRecord[] = [
		{
			...FULL,
			weight: { ...FULL.weight, level: fact<ProjectWeightLevel>('primary', 'handwritten') },
		},
		{
			...BARE,
			weight: { level: fact<ProjectWeightLevel>('active', 'handwritten') },
		},
	];

	it('groups by level when every project has one', () => {
		const html = render(LEVELLED);
		expect(html).toContain('data-testid="home-current-project-group"');
		expect(html).toContain('>主軸<');
		expect(html).toContain('>並行<');
		expect(html).toContain('>1 件<');
		// Group heading is h3, each project name is one level below it.
		expect(html.match(/<h4/g)).toHaveLength(2);
	});

	it('stays flat with a per-row tag when only some projects have a level', () => {
		const html = render([LEVELLED[0], BARE]);
		expect(html).not.toContain('data-testid="home-current-project-group"');
		expect(html).toContain('data-testid="home-current-project-level"');
		expect(html.match(/<h3/g)).toHaveLength(2);
	});
});

describe('CurrentProjects — empty and links', () => {
	it('publishes one meaningful sentence instead of an empty list', () => {
		const html = render([]);
		expect(html).toContain('現在、公開している進行中のプロジェクトはありません。');
		expect(html).not.toContain('<ul');
		expect(html).not.toContain('<li');
		expect(html).not.toContain('data-testid="home-current-projects-summary"');
	});

	it('renders no link when a project has none', () => {
		expect(render([BARE])).not.toContain('<a');
	});

	it('renders a link with a visible label and an aria-hidden arrow', () => {
		const html = render([{ ...BARE, link: { label: '詳しく見る', href: '/about' } }]);
		expect(html).toContain('href="/about"');
		expect(html).toContain('詳しく見る');
		expect(html).toContain('<span aria-hidden="true">→</span>');
	});

	it('drops an unpublishable link but keeps the project', () => {
		const html = render([{ ...BARE, link: { label: '開く', href: 'javascript:alert(1)' } }]);
		expect(html).toContain('Tastile');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('<a');
	});
});

describe('CurrentProjects — no motion in the server document', () => {
	it('carries no change marker and no animation declaration', () => {
		const html = render([FULL, BARE]);
		// The marker compares against what THIS browser saw last, which the
		// server cannot know; rendering it would animate on every first paint.
		expect(html).not.toContain('data-motion');
		expect(html).not.toContain('animation');
		expect(html).not.toContain('前回の表示から更新');
	});
});
