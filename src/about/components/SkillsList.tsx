import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Cluster, Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { TextLink } from '../../editorial/primitives/TextLink';
import {
	SKILL_CATEGORY_LABELS,
	SKILL_USAGE_LABELS,
	type SkillCategory,
	type SkillEntry,
	type SkillUsage,
	selectCurrentSkills,
	selectPastSkills,
} from '../skills';

/**
 * SkillsList — the standalone evidence-linked skills view
 * (Issue #391).
 *
 * Presentation only: it renders whatever `skills` it is given. The
 * data contract lives in `src/about/skills.ts` — every entry already
 * carries its evidence links, the current/past split, and (by
 * construction) no proficiency claim.
 *
 * The list is grouped by `usage` into 「現在使用」 and 「過去に使用」
 * so a finished toolchain is never presented as a current one. A
 * group with no entries is not rendered at all; when BOTH groups are
 * empty the component renders an honest empty message rather than an
 * empty frame.
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
	alignItems: 'center',
	gap: '3',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

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

const summaryStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

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

function SkillGroup({ usage, skills }: { usage: SkillUsage; skills: readonly SkillEntry[] }) {
	if (skills.length === 0) return null;
	return (
		<Stack as="section" gap="3" aria-label={SKILL_USAGE_LABELS[usage]}>
			<h3 className={groupLabelStyle}>{SKILL_USAGE_LABELS[usage]}</h3>
			<Stack as="ul" gap="0" className={listResetClassName}>
				{skills.map((skill) => (
					<li key={skill.id} className={itemStyle}>
						<Cluster as="header" align="baseline" gap="3">
							<h4 className={nameStyle}>{skill.name}</h4>
							<Badge tone={CATEGORY_TONES[skill.category]}>
								{SKILL_CATEGORY_LABELS[skill.category]}
							</Badge>
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
				))}
			</Stack>
		</Stack>
	);
}

export function SkillsList({ skills }: SkillsListProps) {
	const current = selectCurrentSkills(skills);
	const past = selectPastSkills(skills);
	if (current.length === 0 && past.length === 0) {
		return (
			<Stack as="output" gap="2" className={emptyStyle}>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.6',
					})}
				>
					根拠となる制作記録が確認できた技術はまだありません。
				</p>
			</Stack>
		);
	}
	return (
		<Stack gap="4">
			<SkillGroup usage="current" skills={current} />
			<SkillGroup usage="past" skills={past} />
		</Stack>
	);
}
