import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';

/**
 * Pre-activation consent notice for an embedded Tool (Issue #498).
 *
 * This is the point of the Issue made visible: until the visitor
 * presses the control, the host renders no iframe and names no
 * third-party origin anywhere in the document. Everything the notice
 * shows is derived from the manifest declaration through
 * `src/tools/embed-privacy.ts`, so the copy cannot claim "no external
 * service" while the declaration lists one.
 *
 * Copy is bilingual in the shape the rest of the Tools surfaces use
 * (Japanese first, English second). No visitor fact appears here — no
 * analytics id, no account, no personal data — because the notice is
 * rendered by the host for every visitor of `/tools/<slug>`, crawlers
 * included.
 *
 * Kept free of router / loader / binding imports so the same component
 * is previewable in Storybook (`embed-consent-notice.stories.tsx`) and
 * renderable from a plain `renderToStaticMarkup` unit test, with no
 * Worker and no browser.
 */
export interface ToolConsentNoticeProps {
	/** Tool display name, straight from the manifest. */
	readonly displayName: string;
	/**
	 * Origins the framed document may contact once activated, already
	 * normalised / de-duplicated / sorted by `evaluateEmbedPrivacy`.
	 */
	readonly contacts: readonly string[];
	/** Declared purpose (both locales). Rendered verbatim when present. */
	readonly purpose?: { readonly ja: string; readonly en: string } | undefined;
	/** `true` when the frame document itself is served by a third party. */
	readonly frameIsThirdParty: boolean;
	/** Activation handler. The route owns the state; this owns the markup. */
	readonly onActivate: () => void;
}

export function ToolConsentNotice({
	displayName,
	contacts,
	purpose,
	frameIsThirdParty,
	onActivate,
}: ToolConsentNoticeProps) {
	return (
		<Container as="section">
			<div
				data-route="tools/$slug"
				data-tool-state="consent-pending"
				data-testid="tool-embed-consent"
				data-tool-consent="pending"
				className={css({
					paddingBlock: { base: '16', lg: '32' },
					maxWidth: '720px',
				})}
			>
				<SectionHeading
					eyebrow="Before it loads"
					title={displayName}
					description={
						<>
							読み込みを開始するまでは、このツールは埋め込まれません。外部サービスへの通信も行われません。
							<br />
							Until you start the load, this tool is not embedded and contacts no external service.
						</>
					}
				/>
				<p
					data-tool-consent-contacts-lead
					className={css({
						marginBlockStart: '4',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
					})}
				>
					読み込みを開始すると、以下の外部サービスへ接続します。
					<br />
					Starting the load contacts the following external services.
				</p>
				<ul
					data-tool-consent-contacts
					className={css({
						marginBlockStart: '8',
						paddingInlineStart: '20',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
						listStyleType: 'disc',
					})}
				>
					{contacts.map((origin) => (
						<li key={origin} data-contact-origin={origin}>
							<code>{origin}</code>
						</li>
					))}
				</ul>
				{/* The frame document's own origin is a contact like any
				    other, so the notice says which case this is instead of
				    leaving the visitor to infer it from the iframe URL after
				    activation. */}
				<p
					data-tool-consent-frame-origin={frameIsThirdParty ? 'third-party' : 'host'}
					className={css({
						marginBlockStart: '8',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{frameIsThirdParty
						? '埋め込み先の文書自体も、上記の外部サービスが配信します。'
						: '埋め込み先の文書は、このサイトのオリジンから配信されます。'}
					<br />
					{frameIsThirdParty
						? 'The embedded document itself is served by one of the external services listed above.'
						: "The embedded document is served from this site's own origin."}
				</p>
				{purpose ? (
					<>
						<p
							data-tool-consent-purpose
							className={css({
								marginBlockStart: '12',
								fontFamily: 'sans',
								fontSize: 'md',
								color: 'text.default',
							})}
						>
							{purpose.ja}
						</p>
						<p
							data-tool-consent-purpose-en
							className={css({
								marginBlockStart: '4',
								fontFamily: 'sans',
								fontSize: 'md',
								color: 'text.muted',
							})}
						>
							{purpose.en}
						</p>
					</>
				) : null}
				<p
					data-tool-consent-no-record
					className={css({
						marginBlockStart: '12',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					同意の記録は保存されません。読み込みは、ページを開き直すたびに再度必要です。
					<br />
					No consent record is stored: the load has to be started again on every visit.
				</p>
				<button
					type="button"
					onClick={onActivate}
					data-testid="tool-embed-consent-activate"
					className={css({
						marginBlockStart: '16',
						fontFamily: 'sans',
						fontSize: 'md',
						fontWeight: '600',
						color: 'text.inverse',
						background: 'bg.accent',
						border: 'none',
						borderRadius: '4',
						paddingBlock: '3',
						paddingInline: '6',
						cursor: 'pointer',
						_hover: { opacity: '0.9' },
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '2px',
						},
					})}
				>
					読み込みを開始する / Load the tool
				</button>
			</div>
		</Container>
	);
}
