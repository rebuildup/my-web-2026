import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagesView } from './images';

/**
 * Image-upload form error association (Issue #404).
 *
 * The acceptance condition under test: 「空欄/形式違反が視覚と読み上げで
 * 理解できる」 on the one admin form whose refusals are decided before
 * anything reaches the Worker, plus the form-level summary that makes a
 * refusal findable without reading the whole form.
 *
 * Two seams are stubbed:
 *
 *   - `@tanstack/react-start`'s `useServerFn` has no request context in
 *     this suite; the stub returns the `upload` mock directly.
 *   - `./load` is the server-function module (it reaches D1 / R2 through
 *     `cloudflare:workers`), so it is replaced rather than loaded.
 *
 * The component, the field contract and the sentences are the shipped
 * ones; only the transport is fake. Files are attached to the real
 * control (`files` is a live list in happy-dom), so each client-side
 * gate below is the one that actually runs in a browser.
 */

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock('@tanstack/react-start', () => ({
	useServerFn: () => upload,
}));

vi.mock('./load', () => ({
	uploadReactionImage: upload,
	deleteReactionImage: vi.fn(),
}));

const MAX_BYTES = 256 * 1024;

afterEach(() => {
	cleanup();
	upload.mockReset();
});

function renderLibrary() {
	return render(<ImagesView images={[]} />);
}

function fileInput(): HTMLInputElement {
	return screen.getByLabelText(/^Image/) as HTMLInputElement;
}

/**
 * Attach a chosen file the way a file picker would.
 *
 * `FileList` is read-only in the DOM spec, so a real picker replaces
 * the list; happy-dom exposes the live array behind the getter, which
 * is what makes `push` the faithful stand-in here.
 */
function chooseFile(name: string, type: string, bytes: number) {
	const input = fileInput();
	(input.files as unknown as File[]).push(new File([new Uint8Array(bytes)], name, { type }));
}

function submitForm() {
	const form = screen.getByRole('button', { name: /Upload image/ }).closest('form');
	fireEvent.submit(form as HTMLFormElement);
}

/** Every id the rendered document declares. */
function declaredIds(container: HTMLElement): Set<string> {
	return new Set([...container.querySelectorAll('[id]')].map((node) => node.id));
}

describe('admin image upload — field errors', () => {
	it('starts with no error state and no dangling references', () => {
		const { container } = renderLibrary();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(fileInput().getAttribute('aria-invalid')).toBeNull();
		// The accept filter is a hint; the description is what states the
		// rule, and the control must actually reference it.
		const describedBy = fileInput().getAttribute('aria-describedby');
		expect(describedBy).toBe('image-description');
		expect(declaredIds(container).has(describedBy as string)).toBe(true);
	});

	it('states the empty case on the control and in the form summary', async () => {
		renderLibrary();
		submitForm();

		const summary = await screen.findByRole('alert');
		expect(summary.textContent).toContain('画像をアップロードできませんでした');
		expect(summary.textContent).toContain('ファイルを選択してください。');
		expect(summary.querySelector('a')?.getAttribute('href')).toBe('#image');

		const input = fileInput();
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe('image-description image-error');
		// One live region per form: the per-field sentence is reached
		// through `aria-describedby`, not announced a second time.
		expect(screen.getAllByRole('alert')).toHaveLength(1);
		expect(upload).not.toHaveBeenCalled();
	});

	it('states the size refusal the same way', async () => {
		renderLibrary();
		chooseFile('big.png', 'image/png', MAX_BYTES + 1024);
		submitForm();

		const summary = await screen.findByRole('alert');
		expect(summary.textContent).toContain('256 KiB 以下にしてください');
		expect(fileInput().getAttribute('aria-invalid')).toBe('true');
		expect(upload).not.toHaveBeenCalled();
	});

	it('states the format refusal the same way', async () => {
		renderLibrary();
		chooseFile('notes.txt', 'text/plain', 128);
		submitForm();

		const summary = await screen.findByRole('alert');
		expect(summary.textContent).toContain('許可形式: image/png, image/jpeg, image/webp, image/gif');
		expect(fileInput().getAttribute('aria-invalid')).toBe('true');
		expect(upload).not.toHaveBeenCalled();
	});

	it('maps a server policy code to its sentence, never to the wire string', async () => {
		upload.mockRejectedValueOnce(new Error('image_policy:content_type_mismatch'));
		renderLibrary();
		chooseFile('fake.png', 'image/png', 64);
		submitForm();

		const summary = await screen.findByRole('alert');
		expect(summary.textContent).toContain('拡張子と中身が一致しません。');
		expect(summary.textContent).not.toContain('image_policy');
		expect(fileInput().getAttribute('aria-invalid')).toBe('true');
	});

	it('withdraws the refusal when an accepted upload succeeds', async () => {
		upload.mockResolvedValueOnce({ id: 'img_fixture' });
		renderLibrary();

		submitForm();
		await screen.findByRole('alert');

		chooseFile('ok.png', 'image/png', 64);
		submitForm();
		// The accepted outcome is announced in its own right: the form is
		// polite about it (`<output>` / status) so it cannot interrupt a
		// refusal that is already being read.
		await waitFor(() => {
			expect(screen.getByText(/uploaded: img_fixture/)).toBeTruthy();
		});
		expect(screen.queryByRole('alert')).toBeNull();
		expect(fileInput().getAttribute('aria-invalid')).toBeNull();
		// The control is re-enabled for the next file. (Whether
		// `form.reset()` clears a file input is asserted in a real
		// browser, not here: happy-dom does not implement that half of
		// the reset algorithm, so asserting it would test the emulator.)
	});
});
