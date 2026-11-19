import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
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

const sectionStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

const groupStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
});

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

const itemListStyle = css({
	listStyle: 'none',
	margin: '0',
	padding: '0',
	display: 'flex',
	flexDirection: 'column',
});

const itemStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	paddingBlock: '4',
	borderTop: '1px solid {colors.border.subtle}',
});

const itemHeaderStyle = css({
	display: 'flex',
	alignItems: 'baseline',
	flexWrap: 'wrap',
	gap: '3',
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
	display: 'flex',
	flexWrap: 'wrap',
	gap: '4',
	margin: '0',
	padding: '0',
	listStyle: 'none',
	fontFamily: 'sans',
	fontSize: 'sm',
});

const linkStyle = css({
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	_hover: { textDecorationThickness: '2px' },
});

const emptyStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	paddingBlock: '8',
	color: 'text.muted',
});

function SkillGroup({ usage, skills }: { usage: SkillUsage; skills: readonly SkillEntry[] }) {
	if (skills.length === 0) return null;
	return (
		<section className={groupStyle} aria-label={SKILL_USAGE_LABELS[usage]}>
			<h3 className={groupLabelStyle}>{SKILL_USAGE_LABELS[usage]}</h3>
			<ul className={itemListStyle}>
				{skills.map((skill) => (
					<li key={skill.id} className={itemStyle}>
						<header className={itemHeaderStyle}>
							<h4 className={nameStyle}>{skill.name}</h4>
							<Badge tone={CATEGORY_TONES[skill.category]}>
								{SKILL_CATEGORY_LABELS[skill.category]}
							</Badge>
						</header>
						{skill.summary ? <p className={summaryStyle}>{skill.summary}</p> : null}
						{skill.evidence.length > 0 ? (
							<ul className={evidenceListStyle} aria-label={`${skill.name} の根拠`}>
								{skill.evidence.map((evidence) => (
									<li key={evidence.href}>
										<a
											href={evidence.href}
											className={linkStyle}
											rel={evidence.href.startsWith('http') ? 'noreferrer' : undefined}
										>
											{evidence.label}
										</a>
									</li>
								))}
							</ul>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

export function SkillsList({ skills }: SkillsListProps) {
	const current = selectCurrentSkills(skills);
	const past = selectPastSkills(skills);
	if (current.length === 0 && past.length === 0) {
		return (
			<output className={emptyStyle}>
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
			</output>
		);
	}
	return (
		<div className={sectionStyle}>
			<SkillGroup usage="current" skills={current} />
			<SkillGroup usage="past" skills={past} />
		</div>
	);
}
