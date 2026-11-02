import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorSummary } from './ErrorSummary';
import { FileField, TextField } from './Field';
import { Gallery } from './form-errors.stories';

/**
 * SSR markup contract for the form primitives (Issue #404).
 *
 * The renderer is `react-dom/server` — the same renderer the Worker
 * uses — so what is asserted here is what a visitor receives before a
 * single byte of JavaScript runs. That matters for this Issue
 * specifically: the whole point of the contract is that a form is
 * usable by a screen-reader user BEFORE hydration, and a defect that
 * only appears after hydration is a defect a static review misses.
 *
 * The failure these tests exist to prevent, per form that previously
 * hand-wired the attributes:
 *
 *   - a control with no accessible name (placeholder-only, or a
 *     `<label>` that wraps nothing),
 *   - `aria-describedby` pointing at an id the document never
 *     rendered,
 *   - `aria-invalid` present on a field with no error sentence, which
 *     tells a platform 「this is wrong」 without saying what is wrong
 *     (WCAG 2.2 3.3.1),
 *   - an error that is announced twice, because both the field and a
 *     live region carried it.
 */

/** Attribute value of the first tag matching `pattern`. */
function attributeOf(html: string, pattern: RegExp, attribute: string): string | null {
	const tag = html.match(pattern)?.[0];
	if (tag === undefined) return null;
	return new RegExp(`${attribute}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

function describedByOf(html: string, controlId: string): string | null {
	return attributeOf(html, new RegExp(`<input[^>]*id="${controlId}"[^>]*>`), 'aria-describedby');
}

function invalidOf(html: string, controlId: string): string | null {
	return attributeOf(html, new RegExp(`<input[^>]*id="${controlId}"[^>]*>`), 'aria-invalid');
}

/** Every id the document actually defines. */
function declaredIds(html: string): Set<string> {
	return new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]));
}

describe('TextField — association (Issue #404)', () => {
	it('names the control with a visible label', () => {
		const html = renderToStaticMarkup(
			<TextField name="email" label="Email" type="email" description="hint" />,
		);
		expect(html).toContain('<label for="email"');
		expect(html).toContain('Email');
		expect(html).toContain('id="email"');
		// A placeholder is not a name: the label element is what makes
		// the accessible name exist (WCAG 2.2 1.3.1 / 3.3.2).
		expect(html).not.toContain('placeholder=');
	});

	it('references only the ids the document declares', () => {
		const html = renderToStaticMarkup(
			<TextField name="email" label="Email" type="email" description="hint" />,
		);
		const declared = declaredIds(html);
		const describedBy = describedByOf(html, 'email');
		expect(describedBy).toBe('email-description');
		expect(declared.has(describedBy as string)).toBe(true);
	});

	it('leaves no aria-describedby when there is no description', () => {
		const html = renderToStaticMarkup(<TextField name="email" label="Email" type="email" />);
		expect(describedByOf(html, 'email')).toBeNull();
		expect(html).not.toContain('aria-describedby');
		expect(html).not.toContain('email-description');
	});

	it('is not invalid until an error sentence exists', () => {
		const clean = renderToStaticMarkup(<TextField name="email" label="Email" type="email" />);
		expect(invalidOf(clean, 'email')).toBeNull();

		const failed = renderToStaticMarkup(
			<TextField
				name="email"
				label="Email"
				type="email"
				error="この email は既に登録されています。"
			/>,
		);
		expect(invalidOf(failed, 'email')).toBe('true');
		// …and the sentence is reachable from the control, not only
		// rendered next to it.
		expect(describedByOf(failed, 'email')).toBe('email-error');
		expect(declaredIds(failed).has('email-error')).toBe(true);
	});

	it('carries description and error together, in reading order', () => {
		const html = renderToStaticMarkup(
			<TextField
				name="password"
				label="Password"
				type="password"
				description="8 文字以上。"
				error="パスワードが短すぎます (8 文字以上)。"
			/>,
		);
		expect(describedByOf(html, 'password')).toBe('password-description password-error');
		// The sentence is TEXT, and it is preceded by a marker that is
		// hidden from the platform so it is not read as a stray symbol
		// (WCAG 2.2 3.3.1 / 1.4.1).
		expect(html).toContain('パスワードが短すぎます (8 文字以上)。');
		expect(html).toContain('aria-hidden="true"');
	});

	it('draws the error marker as a glyph, not a typed character (Issue #823)', () => {
		const html = renderToStaticMarkup(
			<TextField name="email" label="Email" type="email" error="この値は受け付けられません。" />,
		);
		// The marker is a Material Symbols SVG, drawn and `aria-hidden`.
		expect(html).toMatch(/<p[^>]*data-testid="email-error"[^>]*><svg[^>]*aria-hidden="true"/);
		// …and the text layer carries no `×` character at all.
		expect(html).not.toContain('×');
	});

	it('marks a required field in markup and in the visible label', () => {
		const html = renderToStaticMarkup(
			<TextField name="name" label="Name" type="text" required autoComplete="name" />,
		);
		expect(html).toContain('required=""');
		expect(html).toContain('autoComplete="name"');
		expect(html).toContain('必須');
	});
});

describe('FileField — association (Issue #404)', () => {
	it('keeps accept as a hint and states the rule in text', () => {
		const html = renderToStaticMarkup(
			<FileField
				name="image"
				label="Image"
				accept="image/png,image/jpeg"
				description="256 KiB 以下の PNG / JPEG を選択してください。"
				required
			/>,
		);
		expect(html).toContain('type="file"');
		expect(html).toContain('accept="image/png,image/jpeg"');
		expect(html).toContain('256 KiB 以下の PNG / JPEG を選択してください。');
		expect(describedByOf(html, 'image')).toBe('image-description');
	});

	it('refuses a file with a stated reason, on the control and in the summary', () => {
		const html = renderToStaticMarkup(
			<>
				<ErrorSummary
					heading="画像をアップロードできませんでした"
					errors={[{ field: 'image', label: 'Image', message: 'ファイルが大きすぎます。' }]}
				/>
				<FileField name="image" label="Image" error="ファイルが大きすぎます。" required />
			</>,
		);
		expect(invalidOf(html, 'image')).toBe('true');
		expect(html).toContain('role="alert"');
		// The summary jumps to the control it is about.
		expect(html).toContain('href="#image"');
	});
});

describe('ErrorSummary (Issue #404)', () => {
	it('renders nothing when there is nothing refused', () => {
		expect(renderToStaticMarkup(<ErrorSummary heading="送信できません" errors={[]} />)).toBe('');
	});

	it('is a single live region labelled by its heading', () => {
		const html = renderToStaticMarkup(
			<ErrorSummary
				heading="送信できません"
				headingLevel={2}
				errors={[
					{ field: 'email', label: 'Email', message: 'この email は既に登録されています。' },
					{ field: 'password', label: 'Password', message: 'パスワードが短すぎます。' },
				]}
			/>,
		);
		expect(html.match(/role="alert"/g)).toHaveLength(1);
		const labelledBy = attributeOf(html, /<div[^>]*role="alert"[^>]*>/, 'aria-labelledby');
		expect(labelledBy).not.toBeNull();
		expect(html).toContain(`<h2 id="${labelledBy}"`);
		expect(html).toContain('href="#email"');
		expect(html).toContain('href="#password"');
		// The link text is the visible label, never a bare field name a
		// screen-reader user would have to translate.
		expect(html).not.toContain('>#email<');
	});

	it('renders a form-level refusal as text, with no link to invent', () => {
		const html = renderToStaticMarkup(
			<ErrorSummary
				heading="招待を作成できませんでした"
				errors={[{ label: '招待の作成', message: '作成に失敗しました。' }]}
			/>,
		);
		expect(html).toContain('招待の作成');
		expect(html).not.toContain('<a ');
	});

	it('gives each summary its own heading id when two share a document', () => {
		const html = renderToStaticMarkup(
			<>
				<ErrorSummary
					heading="送信できません"
					errors={[{ label: '送信', message: '失敗しました。' }]}
				/>
				<ErrorSummary
					heading="保存できません"
					errors={[{ label: '保存', message: '失敗しました。' }]}
				/>
			</>,
		);
		const labelledBy = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
		expect(labelledBy).toHaveLength(2);
		expect(new Set(labelledBy).size).toBe(2);
	});

	it('keeps a caller-owned test hook and machine-readable facts', () => {
		const html = renderToStaticMarkup(
			<ErrorSummary
				heading="移動先を確認できませんでした"
				testId="return-to-rejected"
				dataAttributes={{ 'data-reject-reason': 'external_origin' }}
				errors={[{ label: '移動先', message: '/admin に移動します。' }]}
			/>,
		);
		expect(html).toContain('data-testid="return-to-rejected"');
		expect(html).toContain('data-reject-reason="external_origin"');
	});
});

/**
 * The Gallery is one document with five panels, so its ids are global.
 *
 * This fixture is what the committed verification screenshot renders;
 * a duplicated `name` here silently rebinds the second panel's label,
 * description and summary link to the first panel's control, which is
 * exactly the defect the gallery exists to demonstrate is absent. The
 * shipped routes have unique names per form, so the gallery must model
 * that rather than hide the collision.
 */
describe('form-error Gallery — one document, unique identities (Issue #404)', () => {
	const html = renderToStaticMarkup((Gallery.render as unknown as () => ReactNode)());

	it('keeps every id unique across all five panels', () => {
		const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);
		expect(ids.length).toBeGreaterThan(0);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('points every summary entry at a control inside the same form', () => {
		const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((match) => match[0]);
		const summaryForms = forms.filter((form) => form.includes('role="alert"'));
		expect(summaryForms).toHaveLength(1);
		const summaryForm = summaryForms[0];
		const links = [...summaryForm.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
		expect(links.length).toBeGreaterThan(0);
		const ids = declaredIds(summaryForm);
		for (const target of links) {
			expect(ids.has(target)).toBe(true);
			expect(summaryForm).toContain(`id="${target}"`);
			expect(summaryForm).toMatch(new RegExp(`<input[^>]*id="${target}"`));
		}
	});
});
