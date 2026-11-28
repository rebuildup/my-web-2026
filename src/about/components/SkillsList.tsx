import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Cluster, Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { TextLink } from '../../editorial/primitives/TextLink';
import { bodySansMd, noteSansSmBody } from '../../editorial/primitives/shared-styles';
import {
	SKILL_CATEGORY_LABELS,
	type SkillCategory,
	type SkillEntry,
	groupSkillsByContext,
} from '../skills';

/**
 * SkillsList — the evidence-linked skills view, grouped by the body
 * of work each technology primarily belongs to (Issue #391 data,
 * Issue #1296 presentation).
 *
 * Presentation only: it renders whatever `skills` it is given. The
 * data contract lives in `src/about/skills.ts` — every entry already
 * carries its evidence links, the current/past split, its primary
 * `context`, and (by construction) no proficiency claim.
 *
 * Why context groups (Issue #1296)
 * -------------------------------
 * The previous 「現在使用 / 過去に使用」 split was a toolchain
 * inventory: eighteen undifferentiated rows that never said WHICH
 * work a technology belonged to. The audit read that as momentum
 * loss. Grouping by `context` (the platform, Tastile, the After
 * Effects tools, past work) makes the project relationship visible;
 * the 「過去の制作」 group still keeps finished work visually
 * separate from the current toolchain, and each skill's evidence
 * row continues to name every work that demonstrates the use —
 * including the ones outside its primary group.
 *
 * Composes `Badge` and the Panda style layer only — no route, no
 * binding, no peer obligation — so the Storybook story stands alone.
 */

export interface SkillsListProps {
	readonly skills: readonly SkillEntry[];
}

const CATEGORY_TONES: Readonly<Record<SkillCategory, 'accent' | 'neutral'>> = {
	language: 'accent',
	framework: 'neutral',
	platform: 'neutral',
	sdk: 'neutral',
	tool: 'neutral',
	'design-tool': 'neutral',
};

const groupLabelStyle = css({
	margin: '0',
	display: 'flex',
	alignItems: 'baseline',
	gap: '3',
	fontFamily: 'mono',
	fontSize: 'sm',
	letterSpacing: '0.04em',
	color: 'text.default',
});

const groupDescriptionStyle = css(noteSansSmBody);

const itemStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	paddingBlock: '4',
	borderBlockStartWidth: '1px',
	borderBlockStartColor: 'border.subtle',
	borderBlockStartStyle: 'solid',
});

const nameStyle = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'md',
	fontWeight: '700',
	lineHeight: '1.4',
	color: 'text.default',
});

const summaryStyle = css(noteSansSmBody);

const evidenceListStyle = css({
	listStyle: 'none',
	margin: '0',
	padding: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
});

const emptyStyle = css({
	paddingBlock: '8',
	color: 'text.muted',
});

function SkillItem({ skill }: { skill: SkillEntry }) {
	return (
		<li className={itemStyle}>
			<Cluster as="header" align="baseline" gap="3">
				<h4 className={nameStyle}>{skill.name}</h4>
				<Badge tone={CATEGORY_TONES[skill.category]}>{SKILL_CATEGORY_LABELS[skill.category]}</Badge>
			</Cluster>
			{skill.summary ? <p className={summaryStyle}>{skill.summary}</p> : null}
			{skill.evidence.length > 0 ? (
				<Cluster
					as="ul"
					gap="4"
					align="start"
					aria-label={`${skill.name} の根拠`}
					className={evidenceListStyle}
				>
					{skill.evidence.map((evidence) => (
						<li key={evidence.href}>
							<TextLink
								href={evidence.href}
								rel={evidence.href.startsWith('http') ? 'noreferrer' : undefined}
							>
								{evidence.label}
							</TextLink>
						</li>
					))}
				</Cluster>
			) : null}
		</li>
	);
}

function ContextGroup({ bucket }: { bucket: ReturnType<typeof groupSkillsByContext>[number] }) {
	const { context, skills } = bucket;
	return (
		<Stack as="section" gap="3" aria-label={context.label}>
			<Stack gap="1">
				<h3 className={groupLabelStyle}>
					{context.href ? (
						<TextLink
							href={context.href}
							rel={context.href.startsWith('http') ? 'noreferrer' : undefined}
						>
							{context.label}
						</TextLink>
					) : (
						context.label
					)}
				</h3>
				{context.description ? (
					<p className={groupDescriptionStyle}>{context.description}</p>
				) : null}
			</Stack>
			<Stack as="ul" gap="0" className={listResetClassName}>
				{skills.map((skill) => (
					<SkillItem key={skill.id} skill={skill} />
				))}
			</Stack>
		</Stack>
	);
}

export function SkillsList({ skills }: SkillsListProps) {
	const groups = groupSkillsByContext(skills);
	if (groups.length === 0) {
		return (
			<Stack as="output" gap="2" className={emptyStyle}>
				<p className={css(bodySansMd)}>根拠となる制作記録が確認できた技術はまだありません。</p>
			</Stack>
		);
	}
	return (
		<Stack gap="10">
			{groups.map((bucket) => (
				<ContextGroup key={bucket.context.id} bucket={bucket} />
			))}
		</Stack>
	);
}
