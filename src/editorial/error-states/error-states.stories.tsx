import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Container } from '../primitives/Container';
import { DependencyFailureState } from './DependencyFailureState';
import { NotFoundState } from './NotFoundState';
import { ServiceUnavailableState } from './ServiceUnavailableState';

/**
 * Error-state stories (Issue #501).
 *
 * The gallery is the verification surface for the failure contract: it
 * renders the three shipped components in the props the root route wires,
 * so a reviewer can read the published copy, the recovery affordances
 * and the alternative list of every kind side by side.
 *
 * It is also what `scripts/capture-error-state-gallery.mjs` screenshots
 * for `docs/verification/ops/error-state-gallery.webp`. The capture is a
 * REPORT of these states, not a page of the site: no route mounts the
 * gallery (that would be page composition this Issue does not own).
 *
 * The gallery labels each panel with the condition it represents and the
 * fact the copy deliberately withholds, so the screenshot is
 * self-explaining when read on its own.
 */

const meta = {
	title: 'Editorial/ErrorStates',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof NotFoundState>;

export default meta;
type Story = StoryObj<typeof meta>;

const panelClassName = css({
	borderTop: '1px solid {colors.border.subtle}',
	paddingBlock: { base: '10', lg: '16' },
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
	marginBlockStart: '2',
	maxWidth: '720px',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

function Panel({
	condition,
	withheld,
	children,
}: {
	condition: string;
	withheld: string;
	children: React.ReactNode;
}) {
	return (
		<section className={panelClassName}>
			<Container>
				<p className={labelClassName}>{condition}</p>
				<p className={noteClassName}>{withheld}</p>
				{children}
			</Container>
		</section>
	);
}

function GalleryStory() {
	return (
		<div data-testid="error-state-gallery" data-surface="error-states-gallery">
			<Panel
				condition="not_found — HTTP 404 — unmatched route, or loader notFound()"
				withheld="The thrown value, its stack, the visitor identity and the request id stay unpublished; the alternatives are the five canonical public surfaces."
			>
				<NotFoundState backHref="/" />
			</Panel>
			<Panel
				condition="service_unavailable — HTTP 503 condition — loader / SSR render threw"
				withheld="The failure is never attributed to a named binding; the retry anchor re-requests the failed URL and still works before hydration."
			>
				<ServiceUnavailableState retryHref="/portfolio" backHref="/" />
			</Panel>
			<Panel
				condition="dependency_failure — upstream data read failed"
				withheld="No upstream identity, payload or SLA is published; the alternatives are the two surfaces that read no binding at render time (/tools, /contact)."
			>
				<DependencyFailureState retryHref="/portfolio" backHref="/" />
			</Panel>
		</div>
	);
}

export const Gallery: Story = { render: () => <GalleryStory /> };

export const NotFound: Story = { render: () => <NotFoundState backHref="/" /> };

export const ServiceUnavailable: Story = {
	render: () => <ServiceUnavailableState retryHref="/portfolio" backHref="/" />,
};

export const DependencyFailure: Story = {
	render: () => <DependencyFailureState retryHref="/portfolio" backHref="/" />,
};
