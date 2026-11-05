import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { AnalyticsConsentPanel } from './AnalyticsConsent';
import type { AnalyticsConsentPanelProps } from './AnalyticsConsent';

/**
 * Consent panel states (Issue #495).
 *
 * The panel is the only visitor-facing record of the analytics
 * decision, and every state has a distinct claim: undecided (nothing
 * is sent), granted (the grant covers analytics storage only), denied
 * (measurement stops), browser off-switch (the site does not override
 * the browser), and a refused write (nothing was recorded, so nothing
 * is measured). Reading them side by side is how the copy is reviewed
 * without a live grant or a private window.
 *
 * `AllStates` is also what `scripts/capture-analytics-consent.mjs`
 * screenshots for `docs/verification/privacy/analytics-disabled.webp`,
 * so the committed artefact and the Storybook gallery cannot diverge.
 *
 * Layout note: the production panel is `position: fixed`. Each gallery
 * row wraps it in a transformed container, which makes that container
 * the containing block for the fixed child — otherwise every panel
 * would stack on the viewport bottom and the gallery would show one.
 */

const baseArgs = {
	offSwitch: null,
	storageUnavailable: false,
	writeFailed: false,
	onDecide: () => {},
} satisfies Partial<AnalyticsConsentPanelProps>;

const STATES: ReadonlyArray<{
	id: string;
	label: string;
	note: string;
	props: Partial<AnalyticsConsentPanelProps>;
}> = [
	{
		id: 'unset',
		label: '未選択（初回訪問）',
		note: '何も読み込まれず、何も送信されない。拒否しても画面と操作は変わらない。',
		props: { state: 'unset' },
	},
	{
		id: 'granted',
		label: '許可',
		note: '解析ストレージのみ許可。広告・個人化ストレージは拒否のまま。',
		props: { state: 'granted' },
	},
	{
		id: 'denied',
		label: '拒否',
		note: '保存済みの拒否。読み込み済みのタグも停止する（ga-disable + Consent Mode update）。',
		props: { state: 'denied' },
	},
	{
		id: 'off-switch',
		label: 'ブラウザのオプトアウト（DNT / GPC）',
		note: 'ブラウザ指定が保存値より優先される。許可ボタンは提示しない。',
		props: { state: 'denied', offSwitch: 'do-not-track' },
	},
	{
		id: 'write-failed',
		label: '保存の拒否',
		note: '保存領域が書き込みを拒否。記録がないので計測もしない。',
		props: { state: 'unset', writeFailed: true },
	},
];

const galleryClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '10',
	paddingBlock: '10',
	paddingInline: { base: '4', lg: '6' },
	backgroundColor: 'bg.canvas',
	color: 'text.default',
});

const rowClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const labelClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const noteClassName = css({
	margin: '0',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

/**
 * The containing block for one fixed panel, so the gallery can show
 * every state at once instead of stacking them on the viewport bottom.
 *
 * The stage is tall enough for the tallest state as a full-width band
 * (Issue #783): the band spans the stage instead of being a centred
 * 560px card, so its own height follows the stage width and the
 * longest description needs the room.
 */
const stageClassName = css({
	position: 'relative',
	height: '280px',
	transform: 'translateZ(0)',
	borderWidth: '1px',
	borderStyle: 'dashed',
	borderColor: 'border.subtle',
	borderRadius: 'lg',
});

const meta = {
	title: 'Editorial/AnalyticsConsent',
	component: AnalyticsConsentPanel,
	parameters: { layout: 'fullscreen' },
	args: { ...baseArgs, state: 'unset' },
} satisfies Meta<typeof AnalyticsConsentPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Undecided: Story = { args: { state: 'unset' } };
export const Granted: Story = { args: { state: 'granted' } };
export const Denied: Story = { args: { state: 'denied' } };
export const BrowserOffSwitch: Story = { args: { state: 'denied', offSwitch: 'do-not-track' } };
export const StorageRefused: Story = { args: { state: 'unset', writeFailed: true } };

/**
 * Every state in one surface — the review and capture gallery.
 */
export const AllStates: Story = {
	render: () => (
		<div data-testid="analytics-consent-gallery" className={galleryClassName}>
			{STATES.map((state) => (
				<div key={state.id} className={rowClassName}>
					<p className={labelClassName}>
						{state.id} / {state.label}
					</p>
					<p className={noteClassName}>{state.note}</p>
					<div className={stageClassName}>
						<AnalyticsConsentPanel {...baseArgs} state="unset" {...state.props} />
					</div>
				</div>
			))}
		</div>
	),
};
