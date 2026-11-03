import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Container } from '../primitives/Container';
import { ErrorSummary } from './ErrorSummary';
import { TextField } from './Field';

/**
 * Form-state gallery (Issue #404).
 *
 * The verification surface for the field-association contract: it
 * renders the shipped `TextField` / `ErrorSummary` in every state this
 * Issue is about — 正常 / 空欄 / 形式違反 / 失敗 / 縮小表示 — so a
 * reviewer can read what a form looks like in each one, and check that
 * the sentence a control repeats on focus is the sentence the summary
 * announces.
 *
 * The gallery is a fixture, not a page: no route mounts it, because
 * page composition is not this Issue's to decide. It is what
 * `scripts/capture-a11y-form-errors.mjs` screenshots for
 * `docs/verification/a11y/form-error-story.webp` — the capture imports
 * THIS module, so the image cannot drift from the component.
 *
 * Each panel states the WCAG 2.2 success criterion the state is there
 * for, and separates what a machine can check (ids, roles, attribute
 * values — asserted in `forms.test.tsx`) from what only a person can
 * judge (whether the wording is understandable).
 */

const meta = {
	title: 'Editorial/Forms',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

const panelClassName = css({
	borderTop: '1px solid {colors.border.subtle}',
	paddingBlock: { base: '10', lg: '14' },
});

const stateClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const criterionClassName = css({
	margin: '0',
	marginBlockStart: '2',
	maxWidth: '760px',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.muted',
});

const formClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
	maxWidth: '480px',
	marginBlockStart: '6',
});

const submitClassName = css({
	alignSelf: 'flex-start',
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
});

function Panel({
	state,
	criterion,
	children,
}: {
	state: string;
	criterion: string;
	children: React.ReactNode;
}) {
	return (
		<section className={panelClassName}>
			<Container>
				<p className={stateClassName}>{state}</p>
				<p className={criterionClassName}>{criterion}</p>
				{children}
			</Container>
		</section>
	);
}

function GalleryStory() {
	return (
		<div data-testid="a11y-form-error-gallery" data-surface="form-error-gallery">
			<Panel
				state="正常 — no submission yet"
				criterion="WCAG 2.2 1.3.1 / 3.3.2: each control has a visible label, and its description states what the field accepts. Machine-checkable: <label for> resolves to the control id, aria-describedby names an element the document declares."
			>
				<form className={formClassName} action="#">
					<TextField
						name="email"
						label="Email"
						type="email"
						autoComplete="username"
						description="招待された管理者のメールアドレス。"
						required
					/>
					<TextField
						name="password"
						label="Password"
						type="password"
						autoComplete="current-password"
						description="このアカウントのパスワード。"
						required
					/>
					<button type="submit" className={submitClassName} disabled>
						Sign in
					</button>
				</form>
			</Panel>

			<Panel
				state="空欄 — required, untouched"
				criterion="WCAG 2.2 3.3.2 (Labels or Instructions): the requirement is in text next to the label, not only implied by an asterisk. The required marker is aria-hidden, so the platform reads 「Email」 once and takes the requirement from the control itself."
			>
				<form className={formClassName} action="#">
					<TextField
						name="name"
						label="Name"
						type="text"
						autoComplete="name"
						description="アカウントに設定する表示名。"
						required
					/>
					<TextField
						name="invite-email"
						label="Email"
						type="email"
						autoComplete="email"
						description="招待するアドレス。"
						required
					/>
					<button type="submit" className={submitClassName}>
						Create invitation
					</button>
				</form>
			</Panel>

			<Panel
				state="形式違反 — aria-invalid on the control"
				criterion="WCAG 2.2 3.3.1 (Error Identification): the refusal is described in text and reachable from the control through aria-describedby, so focusing the field says why the value was refused. Machine-checkable: aria-describedby=「…-description …-error」, aria-invalid=「true」, and every id it names is declared."
			>
				<form className={formClassName} action="#">
					<TextField
						name="image"
						label="Image"
						description="PNG / JPEG / WebP / GIF の 1 つを、256 KiB 以下で選択してください。"
						required
						error="ファイルが大きすぎます。256 KiB 以下にしてください。"
					/>
					<button type="submit" className={submitClassName}>
						Upload image
					</button>
				</form>
			</Panel>

			<Panel
				state="失敗 — form-level summary plus per-field sentences"
				criterion="WCAG 2.2 3.3.1 + 4.1.3 (Status Messages): the refusal is announced ONCE, by a role=「alert」 summary at the top of the form, and each entry links to the control it is about. The same sentence is repeated next to the field for anyone who navigates straight there; only the summary is a live region, so nothing is read twice."
			>
				{/* Every panel shares one document, so a name is global: the
				    failure panel must not reuse 正常's `email` / `password`
				    ids, or its label and summary link would resolve to the
				    first panel's controls. */}
				<form className={formClassName} action="#" data-testid="a11y-form-error-failure">
					<ErrorSummary
						heading="招待を作成できませんでした"
						errors={[
							{
								field: 'failure-email',
								label: 'Email',
								message: 'この email は既に登録されています。',
							},
							{
								field: 'failure-password',
								label: 'Password',
								message: 'パスワードが短すぎます (8 文字以上)。',
							},
							{ label: '招待の作成', message: '作成に失敗しました。' },
						]}
					/>
					<TextField
						name="failure-email"
						label="Email"
						type="email"
						autoComplete="email"
						description="招待するアカウントのメールアドレス。"
						required
						error="この email は既に登録されています。"
					/>
					<TextField
						name="failure-password"
						label="Password"
						type="password"
						autoComplete="new-password"
						description="8 文字以上。"
						required
						error="パスワードが短すぎます (8 文字以上)。"
					/>
					<button type="submit" className={submitClassName}>
						Create invitation
					</button>
				</form>
			</Panel>

			<Panel
				state="縮小表示 — dense row layout"
				criterion="WCAG 2.2 1.4.4 (Resize Text) / 1.4.10 (Reflow): the same field in a narrow row. The sentence is not clipped or overlapped at the density where the control is beside its neighbours, and the control keeps its own width instead of being squeezed to a few characters."
			>
				<form
					className={css({
						display: 'grid',
						gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto',
						gap: '4',
						alignItems: 'start',
						marginBlockStart: '6',
						maxWidth: '760px',
					})}
					action="#"
				>
					<TextField
						name="slug"
						label="Slug (:thumbs_up: 形式)"
						type="text"
						description="英小文字と数字とアンダースコア。"
						required
						error="英小文字で始めてください。"
					/>
					<TextField name="glyph" label="Glyph (1 絵文字)" type="text" required />
					<button type="submit" className={submitClassName}>
						Add
					</button>
				</form>
			</Panel>
		</div>
	);
}

export const Gallery: Story = { render: () => <GalleryStory /> };

export const Default: Story = {
	render: () => (
		<Container>
			<TextField
				name="email"
				label="Email"
				type="email"
				autoComplete="username"
				description="招待された管理者のメールアドレス。"
				required
			/>
		</Container>
	),
};

export const RequiredUntouched: Story = {
	render: () => (
		<Container>
			<TextField name="name" label="Name" type="text" autoComplete="name" required />
		</Container>
	),
};

export const WithError: Story = {
	render: () => (
		<Container>
			<TextField
				name="image"
				label="Image"
				description="PNG / JPEG / WebP / GIF の 1 つを、256 KiB 以下で選択してください。"
				required
				error="ファイルが大きすぎます。256 KiB 以下にしてください。"
			/>
		</Container>
	),
};

export const WithSummary: Story = {
	render: () => (
		<Container>
			<ErrorSummary
				heading="招待を作成できませんでした"
				errors={[
					{ field: 'email', label: 'Email', message: 'この email は既に登録されています。' },
					{ label: '招待の作成', message: '作成に失敗しました。' },
				]}
			/>
		</Container>
	),
};
