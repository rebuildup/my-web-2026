/**
 * Tests for github-readme-stats-fast card renderers.
 */

import { describe, it, expect } from 'vitest';
import { renderStatsCard } from '../cards/stats.js';
import { renderTopLanguages } from '../cards/top-languages.js';
import { renderStreakCard } from '../cards/streak-card.js';
import { renderRepoCard } from '../cards/repo.js';
import { Card } from '../common/Card.js';

describe('Card', () => {
	it('renders basic SVG structure', () => {
		const card = new Card({
			width: 300,
			height: 100,
			colors: {
				titleColor: '#2f80ed',
				textColor: '#434d58',
				iconColor: '#4c71f2',
				bgColor: '#fffefe',
				borderColor: '#e4e2e2',
			},
			defaultTitle: 'Test Card',
		});
		const svg = card.render('<text>Content</text>');
		expect(svg).toContain('<svg');
		expect(svg).toContain('width="300"');
		expect(svg).toContain('height="100"');
		expect(svg).toContain('Test Card');
		expect(svg).toContain('Content');
	});

	it('hides border when set', () => {
		const card = new Card({
			width: 300,
			height: 100,
			colors: {
				titleColor: '#2f80ed',
				textColor: '#434d58',
				iconColor: '#4c71f2',
				bgColor: '#fffefe',
				borderColor: '#e4e2e2',
			},
			defaultTitle: 'Test',
		});
		card.setHideBorder(true);
		const svg = card.render('');
		expect(svg).toContain('stroke-opacity="0"');
	});

	it('hides title when set', () => {
		const card = new Card({
			width: 300,
			height: 100,
			colors: {
				titleColor: '#2f80ed',
				textColor: '#434d58',
				iconColor: '#4c71f2',
				bgColor: '#fffefe',
				borderColor: '#e4e2e2',
			},
			defaultTitle: 'Test',
		});
		card.setHideTitle(true);
		const svg = card.render('');
		expect(svg).not.toContain('Test');
	});
});

describe('renderStatsCard', () => {
	const mockStats = {
		name: 'Test User',
		totalStars: 100,
		totalCommits: 500,
		totalIssues: 50,
		totalPRs: 30,
		totalPRsMerged: 25,
		mergedPRsPercentage: 83.33,
		totalReviews: 20,
		totalDiscussionsStarted: 5,
		totalDiscussionsAnswered: 3,
		contributedTo: 10,
		rank: { level: 'A', percentile: 25 },
	};

	it('renders SVG with stats', () => {
		const svg = renderStatsCard(mockStats, { theme: 'default' });
		expect(svg).toContain('<svg');
		expect(svg).toContain('Test User');
		expect(svg).toContain('100'); // stars
		expect(svg).toContain('500'); // commits
	});

	it('hides specified stats', () => {
		const svg = renderStatsCard(mockStats, { hide: ['stars', 'commits'] });
		expect(svg).not.toContain('Total Stars');
		expect(svg).not.toContain('Commits');
	});

	it('shows icons when enabled', () => {
		const svg = renderStatsCard(mockStats, { show_icons: true, theme: 'default' });
		expect(svg).toContain('class="icon"');
	});

	it('uses custom title', () => {
		const svg = renderStatsCard(mockStats, { custom_title: 'My Custom Stats' });
		expect(svg).toContain('My Custom Stats');
	});

	it('applies theme colors', () => {
		const svg = renderStatsCard(mockStats, { theme: 'dark' });
		expect(svg).toContain('151515'); // dark theme bg
	});

	it('handles locale', () => {
		const svg = renderStatsCard(mockStats, { locale: 'ja' });
		expect(svg).toContain('<svg');
	});

	it('disables animations when requested', () => {
		const svg = renderStatsCard(mockStats, { disable_animations: true });
		expect(svg).toContain('animation-duration: 0s');
	});
});

describe('renderTopLanguages', () => {
	const mockTopLangs = {
		TypeScript: { name: 'TypeScript', color: '#3178c6', size: 10000, count: 5 },
		JavaScript: { name: 'JavaScript', color: '#f1e05a', size: 5000, count: 3 },
		Python: { name: 'Python', color: '#3572A5', size: 3000, count: 2 },
	};

	it('renders SVG with languages', () => {
		const svg = renderTopLanguages(mockTopLangs, { theme: 'default' });
		expect(svg).toContain('<svg');
		expect(svg).toContain('TypeScript');
		expect(svg).toContain('JavaScript');
	});

	it('limits languages count', () => {
		const svg = renderTopLanguages(mockTopLangs, { langs_count: 2 });
		expect(svg).toContain('TypeScript');
		expect(svg).toContain('JavaScript');
		expect(svg).not.toContain('Python');
	});

	it('supports compact layout', () => {
		const svg = renderTopLanguages(mockTopLangs, { layout: 'compact' });
		expect(svg).toContain('<svg');
	});

	it('hides specified languages', () => {
		const svg = renderTopLanguages(mockTopLangs, { hide: ['TypeScript'] });
		expect(svg).not.toContain('TypeScript');
		expect(svg).toContain('JavaScript');
	});

	it('shows no data message when empty', () => {
		const svg = renderTopLanguages({}, { theme: 'default' });
		expect(svg).toContain('No languages data');
	});
});

describe('renderStreakCard', () => {
	const mockStreak = {
		currentStreak: 10,
		longestStreak: 30,
		totalContributions: 500,
		firstContribution: 'Jan 1, 2023',
		currentStreakStart: 'Jan 10',
		currentStreakEnd: 'Jan 20',
		longestStreakStart: 'Mar 1, 2023',
		longestStreakEnd: 'Mar 30, 2023',
	};

	it('renders SVG with streak data', () => {
		const svg = renderStreakCard('testuser', mockStreak, { theme: 'default' });
		expect(svg).toContain('<svg');
		expect(svg).toContain('10'); // current streak
		expect(svg).toContain('30'); // longest streak
		expect(svg).toContain('500'); // total
	});

	it('applies theme', () => {
		const svg = renderStreakCard('testuser', mockStreak, { theme: 'dark' });
		expect(svg).toContain('151515');
	});
});

describe('renderRepoCard', () => {
	const mockRepo = {
		name: 'test-repo',
		nameWithOwner: 'testuser/test-repo',
		isPrivate: false,
		isArchived: false,
		isTemplate: false,
		stargazerCount: 42,
		description: 'A test repository for testing purposes',
		primaryLanguage: { color: '#3178c6', id: '1', name: 'TypeScript' },
		forkCount: 5,
		starCount: 42,
	};

	it('renders SVG with repo info', () => {
		const svg = renderRepoCard(mockRepo, { theme: 'default' });
		expect(svg).toContain('<svg');
		expect(svg).toContain('test-repo');
		expect(svg).toContain('TypeScript');
		expect(svg).toContain('A test repository');
	});

	it('shows owner when enabled', () => {
		const svg = renderRepoCard(mockRepo, { show_owner: true });
		expect(svg).toContain('testuser/test-repo');
	});

	it('hides border when enabled', () => {
		const svg = renderRepoCard(mockRepo, { hide_border: true });
		expect(svg).toContain('stroke-opacity="0"');
	});

	it('limits description lines', () => {
		const svg = renderRepoCard(mockRepo, { description_lines_count: 1 });
		expect(svg).toContain('<svg');
	});
});