import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ToolConsentNotice } from './embed-consent-notice';
import { evaluateEmbedPrivacy, toPrivacySubject } from './embed-privacy';

/**
 * Consent notice preview (Issue #498).
 *
 * The states shown here are the ones the real route can produce, built
 * from the same `evaluateEmbedPrivacy` verdict the `/tools/<slug>`
 * loader uses — the Storybook args are fixture manifest entries, not
 * hand-written markup, so a preview can never show a notice the policy
 * module would not produce.
 *
 *   - `clickToLoad` — a same-origin Tool that declares third-party
 *     contacts (the ProtoType shape).
 *   - `externalFrame` — an `external_exception` Tool: the frame
 *     document itself is third-party.
 *   - `noPurpose` — a declaration with contacts and no purpose, i.e. the
 *     shape `privacy.purpose.missing` refuses. Kept visible so the copy
 *     gap is reviewable; the live route would render the blocked
 *     placeholder instead.
 *
 * `Activated` in the play area shows the other half of the contract:
 * the visitor's activation swaps the notice for the frame. The frame src
 * is `about:blank` on purpose — a preview must not contact a real Tool
 * artefact (or anything else) to show a layout.
 */
const PROTOTYPE_FIXTURE = {
	kind: 'same_origin_static',
	entry_html: '/tools/fixture/app/index.html',
	privacy: {
		third_party_origins: [
			'https://fonts.googleapis.com',
			'https://fonts.gstatic.com',
			'https://script.google.com',
			'https://use.typekit.net',
		],
		purpose: {
			ja: '読み込みを開始すると、埋め込み中の ProtoType が Google Fonts / Adobe Typekit から web フォントを取得し、ログイン用 gameset が Google Apps Script のエンドポイントへ通信します（その実装は id / password をクエリ文字列に載せます）。',
			en: 'Once the load starts, the embedded ProtoType document fetches web fonts from Google Fonts and Adobe Typekit, and its login gameset calls a Google Apps Script endpoint (that implementation puts id / password in the query string).',
		},
	},
} as const;

const EXTERNAL_FIXTURE = {
	kind: 'external_exception',
	external_url: 'https://embed.example.invalid/app',
	privacy: {
		third_party_origins: ['https://embed.example.invalid'],
		purpose: {
			ja: '埋め込み先の文書が、それ自身のオリジンから配信されます。',
			en: 'The embedded document is served from its own origin.',
		},
	},
} as const;

const NO_PURPOSE_FIXTURE = {
	kind: 'same_origin_static',
	entry_html: '/tools/fixture/app/index.html',
	privacy: {
		third_party_origins: ['https://analytics.example.invalid'],
	},
} as const;

const meta = {
	title: 'Tools/Embed consent notice',
	component: ToolConsentNotice,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'Pre-activation surface for an embedded Tool (Issue #498). No iframe, no request-bearing attribute, one explicit activation control.',
			},
		},
	},
} satisfies Meta<typeof ToolConsentNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The stories below omit `onActivate` on purpose: the component's only
 * behaviour is the click handler the route owns, so a story supplies
 * its own when it renders the activation transition.
 */
const noop = () => {};

/** Same-origin artefact that loads web fonts from third parties. */
export const ClickToLoad: Story = {
	args: {
		displayName: 'ProtoType',
		contacts: evaluateEmbedPrivacy(toPrivacySubject('prototype', PROTOTYPE_FIXTURE))
			.contacts_after_activation,
		frameIsThirdParty: false,
		purpose: PROTOTYPE_FIXTURE.privacy.purpose,
		onActivate: noop,
	},
};

/** `external_exception`: the frame document itself is third-party. */
export const ExternalFrame: Story = {
	args: {
		displayName: 'External Frame Fixture',
		contacts: evaluateEmbedPrivacy(toPrivacySubject('external', EXTERNAL_FIXTURE))
			.contacts_after_activation,
		frameIsThirdParty: true,
		purpose: EXTERNAL_FIXTURE.privacy.purpose,
		onActivate: noop,
	},
};

/** The shape `privacy.purpose.missing` refuses — reviewable, never shipped. */
export const MissingPurpose: Story = {
	args: {
		displayName: 'Missing Purpose Fixture',
		contacts: evaluateEmbedPrivacy(toPrivacySubject('gap', NO_PURPOSE_FIXTURE))
			.contacts_after_activation,
		frameIsThirdParty: false,
		purpose: undefined,
		onActivate: noop,
	},
};

/**
 * The activation transition, in one frame.
 *
 * Rendered here rather than in the production route so the preview can
 * show both halves of the contract without a Worker.
 */
export const Activated: Story = {
	render: function ActivatedRender(args) {
		const [activated, setActivated] = useState(false);
		if (!activated) {
			return <ToolConsentNotice {...args} onActivate={() => setActivated(true)} />;
		}
		return (
			<div
				data-testid="tool-embed-consent-activated"
				style={{
					font: '13px/1.5 ui-monospace, Menlo, monospace',
					border: '1px dashed currentColor',
					padding: '12px 16px',
				}}
			>
				activated: the host mounts one iframe with the declared sandbox / referrer policy.
				<br />
				(Storybook renders <code>about:blank</code> here on purpose — a preview contacts nothing.)
			</div>
		);
	},
	args: ClickToLoad.args,
};
