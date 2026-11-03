import { css, cx } from '../../../../styled-system/css';
import { StateMark } from '../../../editorial/primitives/StateMark';
import type {
	DesignSystemContentFamily,
	DesignSystemRoleToken,
	DesignSystemTokenData,
} from '../tokens';

/**
 * ColorSwatches — the colour section of `/design-system` under
 * direction B (Issue #764).
 *
 * What the previous build did and why it changed
 * ----------------------------------------------
 * Issue #812 rebuilt this section as three large colour fields (one
 * per content classification) plus a borrowed-colour status row. The
 * composition was honest about colour, but measured 24% of the screen
 * at 1440 and 71% at 390 — twenty times the direction B limit. A
 * colour field that large is a surface colour, which is exactly what
 * direction B forbids.
 *
 * The composition this file owns instead:
 *
 *   1. The MONOCHROME role table — every `surface.*` / `text.*` /
 *      `border.*` role, with what it decides and its light / dark
 *      hex. No swatch: these are neutral steps, and the page itself
 *      is the swatch.
 *   2. The SIGNAL table — the one operation hue, its pressed step, and
 *      the three status signals. The operation hue is shown as a
 *      single pill; a status is an 8px `StateMark` plus a word.
 *   3. The CONTENT table — six hue families, each shown as a 2px
 *      line in both appearances. The family a seed receives is
 *      decided by `src/editorial/content-signal.ts` (FNV-1a), not by
 *      this page and not by a random number.
 *
 * The rules this file keeps:
 *
 *   - A surface is never painted with a signal hue. The only colour
 *     marks are a pill, a line, a word or an 8px shape.
 *   - Colour is never the only cue: every status carries a word and a
 *     `StateMark` silhouette, and every content family carries its
 *     name.
 *   - The colour area of a screen stays under 5%. The section prints
 *     the rule, and `docs/verification/design/764-direction-b.md`
 *     records the measurement of this page.
 *
 * Where the hex values come from
 * ------------------------------
 * The token paths are resolved on the SERVER (`../tokens.ts`): the
 * section renders resolved hex pairs, and resolving them in the
 * browser meant shipping the whole raw palette plus the whole semantic
 * layer in the route chunk. The route loader passes the resolved pairs
 * in as props.
 */

const ruleClassName = css({
	margin: '0',
	marginBlockEnd: '10',
	maxWidth: '72ch',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const groupClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	marginBlockStart: '10',
	_first: { marginBlockStart: '0' },
});

const groupHeadingClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.2',
	letterSpacing: '-0.01em',
	color: 'text.default',
});

const groupBodyClassName = css({
	margin: '0',
	maxWidth: '72ch',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.muted',
});

const listResetClassName = css({ margin: '0', padding: '0', listStyle: 'none' });

const roleRowClassName = css({
	display: 'grid',
	gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'minmax(10rem, 14rem) minmax(0, 1fr) auto' },
	columnGap: '4',
	rowGap: '1',
	alignItems: 'baseline',
	paddingBlock: '2',
	borderTop: '1px solid {colors.border.divider}',
	_first: { borderTopWidth: '0' },
});

const pathClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.default',
	whiteSpace: 'nowrap',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
});

const purposeClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

const hexClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.muted',
	whiteSpace: 'nowrap',
});

const actionPillStyle = {
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	alignSelf: 'flex-start',
	paddingBlock: '1',
	paddingInline: '4',
	borderRadius: 'md',
	backgroundColor: 'signal.action',
	color: 'text.inverse',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
} as const;

const actionPillClassName = css(actionPillStyle);

const actionActivePillClassName = css({
	...actionPillStyle,
	backgroundColor: 'signal.actionActive',
});

const STATUS_MARK = {
	'signal.positive': { mark: 'ok', label: '正常' },
	'signal.negative': { mark: 'unreachable', label: '異常' },
	'signal.warning': { mark: 'degraded', label: '注意' },
} as const;

const STATUS_COLOR = {
	'signal.positive': css({ color: 'signal.positive' }),
	'signal.negative': css({ color: 'signal.negative' }),
	'signal.warning': css({ color: 'signal.warning' }),
} as const;

const statusRowClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.default',
});

const contentRowClassName = css({
	display: 'grid',
	gridTemplateColumns: {
		base: 'minmax(0, 1fr)',
		md: 'minmax(6rem, 8rem) minmax(0, 1fr) auto',
	},
	columnGap: '4',
	rowGap: '1',
	alignItems: 'center',
	paddingBlock: '2',
	borderTop: '1px solid {colors.border.divider}',
	_first: { borderTopWidth: '0' },
});

const contentLineGroupClassName = css({
	display: 'flex',
	alignItems: 'center',
	gap: '1',
});

const contentLineClassName = css({
	display: 'inline-block',
	width: '10',
	height: '2px',
});

const contentNameClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.default',
});

export function ColorSwatches({ tokenData }: { tokenData: DesignSystemTokenData }) {
	return (
		<>
			<p className={ruleClassName}>
				面は無彩色の階層で組み、色は signal にだけ使います。色は 1 行・1 語・1
				ピルまで。画面ごとの彩色面積は 5%
				以下を上限とし、超えたら色を減らします。状態は語と形（StateMark）を必ず併用し、色だけで意味を伝えません。
			</p>

			<section aria-labelledby="design-system-colour-monochrome" className={groupClassName}>
				<h3 id="design-system-colour-monochrome" className={groupHeadingClassName}>
					無彩色の役割 — 面・文字・罫線
				</h3>
				<p className={groupBodyClassName}>
					surface は地からの段差、text は文字の階層、border
					は構造の罫線です。面の分離は塗りの差で行い、罫線は装飾には使いません。
				</p>
				<ul className={listResetClassName}>
					{tokenData.monochrome.map((role) => (
						<RoleRow key={role.path} role={role} />
					))}
				</ul>
			</section>

			<section aria-labelledby="design-system-colour-signal" className={groupClassName}>
				<h3 id="design-system-colour-signal" className={groupHeadingClassName}>
					signal — 操作と状態
				</h3>
				<p className={groupBodyClassName}>
					操作の色は 1 画面に 1 系統だけ。状態は正常・異常・注意の 3
					つで、いずれも語と形を併用します。
				</p>
				<ul className={listResetClassName}>
					{tokenData.signals.map((role) => (
						<SignalRow key={role.path} role={role} />
					))}
				</ul>
			</section>

			<section aria-labelledby="design-system-colour-content" className={groupClassName}>
				<h3 id="design-system-colour-content" className={groupHeadingClassName}>
					content — 内容から導く色
				</h3>
				<p className={groupBodyClassName}>
					内容の色は分類 id や slug から決定的に導きます（FNV-1a、乱数ではない）。design →
					rose、code → cyan、writing → amber、tool → indigo。未知の seed は 6
					系統のいずれかへ割り当てます。
				</p>
				<ul className={listResetClassName}>
					{tokenData.content.map((family) => (
						<ContentRow key={family.id} family={family} />
					))}
				</ul>
			</section>
		</>
	);
}

function RoleRow({ role }: { role: DesignSystemRoleToken }) {
	return (
		<li className={roleRowClassName} data-token-path={role.path}>
			<code className={pathClassName}>{role.path}</code>
			<p className={purposeClassName}>{role.purpose}</p>
			<code className={hexClassName}>
				{role.lightHex} / {role.darkHex}
			</code>
		</li>
	);
}

function SignalRow({ role }: { role: DesignSystemRoleToken }) {
	const status = STATUS_MARK[role.path as keyof typeof STATUS_MARK];
	return (
		<li className={roleRowClassName} data-token-path={role.path}>
			<code className={pathClassName}>{role.path}</code>
			<div>
				{role.path === 'signal.action' ? (
					<span className={actionPillClassName}>Continue</span>
				) : role.path === 'signal.actionActive' ? (
					<span className={actionActivePillClassName}>Continue</span>
				) : status ? (
					<span className={statusRowClassName}>
						<span className={STATUS_COLOR[role.path as keyof typeof STATUS_COLOR]}>
							<StateMark kind={status.mark} size="sm" />
						</span>
						{status.label}
					</span>
				) : (
					<span className={purposeClassName}>{role.purpose}</span>
				)}
			</div>
			<code className={hexClassName}>
				{role.lightHex} / {role.darkHex}
			</code>
		</li>
	);
}

function ContentRow({ family }: { family: DesignSystemContentFamily }) {
	return (
		<li className={contentRowClassName} data-content-family={family.id}>
			<span className={contentLineGroupClassName} aria-hidden="true">
				<span className={contentLineClassName} style={{ backgroundColor: family.lightHex }} />
				<span className={contentLineClassName} style={{ backgroundColor: family.darkHex }} />
			</span>
			<div className={cx(contentNameClassName, css({ display: 'flex', gap: '3' }))}>
				<span>{family.id}</span>
				<span className={css({ color: 'text.muted' })}>{family.token}</span>
			</div>
			<code className={hexClassName}>
				{family.lightHex} / {family.darkHex}
			</code>
		</li>
	);
}
