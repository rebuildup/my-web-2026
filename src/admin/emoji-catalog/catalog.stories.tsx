import type { Meta, StoryObj } from '@storybook/react';
import { CatalogView } from './catalog';
import type { AdminCatalogEntry } from './load';

/**
 * Admin emoji-catalog stories — pure SSR shape (no create-form
 * interactions). The full surface needs a DOM; these stories render
 * the populated / empty / disabled-only variants so the visual
 * spread is reviewable without a real admin session.
 */

const meta = {
	title: 'admin/EmojiCatalog',
	component: CatalogView,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof CatalogView>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleEntries: readonly AdminCatalogEntry[] = [
	{
		slug: 'thumbs_up',
		codepoint: '👍',
		enabled: true,
		createdBy: 'admin-1',
		createdAt: '2026-09-15T10:00:00.000Z',
		updatedAt: '2026-09-15T10:00:00.000Z',
	},
	{
		slug: 'tada',
		codepoint: '🎉',
		enabled: true,
		createdBy: 'admin-1',
		createdAt: '2026-09-15T10:00:00.000Z',
		updatedAt: '2026-09-15T10:00:00.000Z',
	},
	{
		slug: 'bulb',
		codepoint: '💡',
		enabled: false,
		createdBy: null,
		createdAt: '2026-09-15T10:00:00.000Z',
		updatedAt: '2026-09-15T10:00:00.000Z',
	},
];

export const Populated: Story = {
	args: {
		entries: sampleEntries,
		createForm: null,
	},
};

export const Empty: Story = {
	args: {
		entries: [],
		createForm: null,
	},
};

export const DisabledOnly: Story = {
	args: {
		entries: sampleEntries.map((e) => ({ ...e, enabled: false })),
		createForm: null,
	},
};
