import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Keyboard-only navigation regression spec (Issue #394).
 *
 * Completing the main navigation paths with the keyboard alone is a
 * requirement of WCAG 2.2 SC 2.1.1 Keyboard / SC 2.1.2 No Keyboard Trap /
 * SC 2.4.1 Bypass Blocks / SC 2.4.3 Focus Order / SC 2.4.7 Focus Visible.
 * The repository had no regression spec for it. This spec observes, on
 * the EXISTING routes, that the keyboard reaches every surface, that
 * the focus is never lost on the way, and that the focus comes back to
 * the control that opened a transient surface.
 *
 * What this spec decides (machine-checked)
 *   - the skip link is the first Tab stop, and Enter moves the focus
 *     past the repeated chrome (SC 2.4.1 Bypass Blocks),
 *   - the Tab / Shift+Tab order does not contradict the document order
 *     and wraps back to the first stop at the end of the document, so
 *     the focus was never lost on the way (SC 2.4.3 Focus Order),
 *   - the mobile menu opens from the keyboard, and Escape hands the
 *     focus back to the trigger (SC 2.1.2 / SC 2.4.3),
 *   - the reaction picker `<dialog>` is MODAL, keeps the focus inside
 *     while it is open, and closes on Escape (SC 2.1.1 / SC 2.1.2).
 *
 * What this spec does not decide (human evaluation)
 *   - how the focus ring LOOKS (visibility, contrast). That is the
 *     Issue #399 gate plus a human reader; it is out of scope here.
 *   - how a screen reader announces the page, and the feel of the
 *     reading order.
 *
 * Reusing the existing configuration
 * ----------------------------------
 * The file lives under `playwright.config.ts`'s `testDir: './e2e'`, so
 * it rides the existing `pnpm run e2e` (the CI release gate). No new
 * Playwright config file is created, and the CI workflow YAML is not
 * touched.
 *
 * Stability
 * ---------
 *   - No `networkidle` and no sleep to paper over timing. The only
 *     waits are on meaningful elements (`expect(locator).toBeVisible()`,
 *     `expect.poll(...)`).
 *   - Nothing depends on randomness or on the clock. The Tab order is
 *     read from a static DOM.
 *   - At least one negative control is mandatory. With a correct
 *     implementation alone, green proves nothing: an assertion that
 *     cannot turn red may not be looking at anything. A negative
 *     control breaks the DOM at runtime; it never rewrites production
 *     code.
 */

/** One observed Tab stop. */
interface FocusStop {
	/** The element's tag name (`A` / `BUTTON` / `SUMMARY` …). */
	tag: string;
	/** The `href` attribute, when the element is a link. */
	href: string | null;
	/** The `data-testid` attribute, when the element carries a stable id. */
	testId: string | null;
	/** A human-readable label. */
	label: string;
	/** Whether the element is inside the `<main>` landmark. */
	inMain: boolean;
	/**
	 * The element's position in the document (`document.querySelectorAll('*')`
	 * index).
	 *
	 * This is how the spec decides whether the focus moved FORWARD
	 * through the document. When the focus is lost, Tab restarts at the
	 * top of the document, so this value becomes smaller.
	 */
	order: number;
}

/** The maximum number of Tab stops one walk may record. */
const MAX_TAB_STOPS = 60;

/** The tags that count as a meaningful Tab stop. */
const INTERACTIVE_TAGS = [
	'A',
	'AREA',
	'AUDIO',
	'BUTTON',
	'DETAILS',
	'IFRAME',
	'INPUT',
	'SELECT',
	'SUMMARY',
	'TEXTAREA',
	'VIDEO',
];

/** The minimum number of Tab stops a walked surface must expose. */
const MIN_TAB_STOPS = 5;

/**
 * The elements inside a container that can take the focus.
 *
 * Used for the dialog contract: a Tab target must be one of these,
 * inside the dialog. The selector is the browser's own notion of a
 * focusable element, minus the disabled ones (a disabled control
 * cannot be focused, so including it would weaken the check).
 */
const FOCUSABLE_SELECTOR =
	'a[href]:not([disabled]), button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Whether the focus landed on a supporting element, i.e. was lost. */
function isSupportingElement(stop: FocusStop): boolean {
	return stop.tag === 'BODY' || stop.tag === 'HTML' || stop.tag === 'NONE';
}

/** Whether two stops point at the same element (used by the wrap check). */
function sameStop(a: FocusStop, b: FocusStop | undefined): boolean {
	if (!b) return false;
	return a.tag === b.tag && a.href === b.href && a.label === b.label;
}

/** Read the current `document.activeElement`. */
async function readActiveStop(page: Page): Promise<FocusStop> {
	return page.evaluate(() => {
		const element = document.activeElement;
		if (!element) {
			return { tag: 'NONE', href: null, testId: null, label: '', inMain: false, order: -1 };
		}
		const raw = element.getAttribute('aria-label') ?? element.textContent ?? '';
		return {
			tag: element.tagName,
			href: element.getAttribute('href'),
			testId: element.getAttribute('data-testid'),
			label: raw.replace(/\s+/g, ' ').trim().slice(0, 48),
			inMain: element.closest('main') !== null,
			order: Array.prototype.indexOf.call(document.querySelectorAll('*'), element),
		};
	});
}

/** The recorded order of the meaningful stops of one walk. */
interface TabWalk {
	/** The meaningful elements, in the order the focus visited them. */
	stops: FocusStop[];
	/**
	 * The supporting element that ended the walk.
	 *
	 * `null` means the walk ran out of steps (`max`), i.e. it never
	 * ended. `tag` is the tag the focus actually fell onto; at the end
	 * of a document that is `BODY`.
	 */
	end: { tag: string; index: number } | null;
	/**
	 * Whether Tab after the end of the document returns to the first
	 * stop.
	 *
	 * This is the evidence that the Tab order is cyclic. It does NOT
	 * detect a lost focus on its own: a focus lost to the body also
	 * makes the next Tab land on the first element. `forward` is what
	 * detects that.
	 */
	wrapped: boolean;
	/**
	 * Whether the focus moved forward through the document, i.e. never
	 * went back to an earlier stop.
	 *
	 * A lost focus makes Tab restart at the top of the document, so
	 * the document position becomes smaller (= `false`). This is the
	 * mechanical evidence that the focus was never lost mid-document.
	 */
	forward: boolean;
}

/**
 * Collect the elements the focus stops at, in order.
 *
 * The walk ends when the focus falls onto `body` / `html`, and it
 * reports WHICH supporting element received it as `end`. The
 * supporting element never enters `stops`, so a "this stop is not a
 * supporting element" check over `stops` would be structurally true
 * and would guard nothing; `end` and `forward` are the checks that
 * carry weight.
 */
async function collectTabStops(
	page: Page,
	max: number = MAX_TAB_STOPS,
	breakAfterStops?: number,
): Promise<{ stops: FocusStop[]; end: { tag: string; index: number } | null }> {
	const stops: FocusStop[] = [];
	for (let index = 0; index < max; index += 1) {
		await page.keyboard.press('Tab');
		const stop = await readActiveStop(page);
		if (isSupportingElement(stop)) {
			return { stops, end: { tag: stop.tag, index } };
		}
		stops.push(stop);
		// The negative control's break: remove the element that holds
		// the focus from the DOM, so the focus falls to the body and
		// every later Tab restarts at the top of the document (a lost
		// focus).
		if (breakAfterStops !== undefined && stops.length === breakAfterStops) {
			await page.evaluate(() => {
				const element = document.activeElement;
				if (element && element !== document.body) element.remove();
			});
		}
	}
	return { stops, end: null };
}

/** Whether the recorded stops moved forward through the document. */
function isForwardOrder(stops: FocusStop[]): boolean {
	for (let index = 1; index < stops.length; index += 1) {
		if (stops[index].order <= stops[index - 1].order) return false;
	}
	return true;
}

/**
 * Tab to the end of the document and then check that Tab wraps back to
 * the first stop.
 *
 * The only way the order does NOT wrap is a focus lost on the way: the
 * Tab after a lost focus lands on a new element instead of the first
 * one, so "it wrapped" is evidence that the focus was never lost.
 */
async function walkWholeDocument(
	page: Page,
	max: number = MAX_TAB_STOPS,
	breakAfterStops?: number,
): Promise<TabWalk> {
	const { stops, end } = await collectTabStops(page, max, breakAfterStops);
	if (end === null || stops.length === 0) {
		return { stops, end, wrapped: false, forward: isForwardOrder(stops) };
	}
	await page.keyboard.press('Tab');
	const first = await readActiveStop(page);
	return {
		stops,
		end,
		wrapped: sameStop(first, stops[0]),
		forward: isForwardOrder(stops),
	};
}

/** Whether the focus is inside the dialog (the dialog element counts). */
async function isFocusInside(dialog: Locator): Promise<boolean> {
	return dialog.evaluate(
		(element) => element === document.activeElement || element.contains(document.activeElement),
	);
}

/**
 * Whether the focused element is one of the dialog's own focusable
 * elements.
 *
 * "The focus did not leave the dialog" alone is too weak: a dialog
 * that is not modal may still hold the focus for a dozen Tab presses
 * simply because it renders many focusable elements. The stronger
 * claim is that every Tab target is a focusable element OF the dialog.
 */
async function isFocusOnDialogFocusable(dialog: Locator): Promise<boolean> {
	return dialog.evaluate((element, selector) => {
		const active = document.activeElement;
		if (!active || active === document.body) return false;
		if (!element.contains(active)) return false;
		return Array.prototype.some.call(element.querySelectorAll(selector), (node) => node === active);
	}, FOCUSABLE_SELECTOR);
}

/** Whether the dialog is a modal one (`showModal()`, not `show()`). */
async function isModalDialog(dialog: Locator): Promise<boolean> {
	return dialog.evaluate((element) => element.matches(':modal'));
}

/**
 * Wait until the dialog renders at least one focusable element.
 *
 * The picker content is a lazily loaded chunk, so the dialog may be
 * shown before it has any focusable child. Waiting for the content
 * keeps the Tab assertions below from reading a half-rendered dialog.
 */
async function waitForDialogFocusable(dialog: Locator): Promise<void> {
	await expect
		.poll(
			async () =>
				dialog.evaluate(
					(element, selector) => element.querySelectorAll(selector).length,
					FOCUSABLE_SELECTOR,
				),
			{ timeout: 15_000 },
		)
		.toBeGreaterThan(0);
}

/** Tab until `target` holds the focus, or give up. */
async function tabUntilFocused(page: Page, target: Locator, max = MAX_TAB_STOPS): Promise<boolean> {
	// `evaluateAll` is used because the same href can exist in the
	// desktop strip and in the mobile panel. Narrowing it to a single
	// element would raise a strict-mode violation and break the check.
	const isFocused = () =>
		target
			.evaluateAll((elements) => elements.some((element) => element === document.activeElement))
			.catch(() => false);
	for (let index = 0; index < max; index += 1) {
		if (await isFocused()) return true;
		await page.keyboard.press('Tab');
	}
	return isFocused();
}

/* ---------------------------------------------------------------------------
 * `/` — home: skip link and focus order
 * ------------------------------------------------------------------------- */

test.describe('/ — home: skip link and focus order (Issue #394)', () => {
	test('the skip link is the first Tab stop and moves the focus past the repeated chrome', async ({
		page,
	}) => {
		await page.goto('/');
		const skipLink = page.locator('a[href="#main"]');
		await expect(skipLink).toHaveCount(1);

		// The first Tab focuses the skip link.
		await page.keyboard.press('Tab');
		await expect(skipLink).toBeFocused();

		// Enter moves the focus to `main`. `<main>` itself is not
		// focusable, so what can be observed is "the fragment changed"
		// and "the next Tab starts inside main" (the sequential focus
		// navigation starting point).
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#main$/);

		await page.keyboard.press('Tab');
		const stop = await readActiveStop(page);
		expect(
			stop.inMain,
			`the focus after the skip link must land inside <main> (SC 2.4.1), got <${stop.tag}> ${stop.href ?? stop.label}`,
		).toBe(true);
	});

	test('the Tab walk reaches the end of the document without losing the focus', async ({
		page,
	}) => {
		await page.goto('/');
		const walk = await walkWholeDocument(page);
		const { stops, end, wrapped, forward } = walk;

		// The walk must END by leaving the document (the browser hands
		// the focus back to the document at the end of the page), not by
		// running out of steps. `end` records WHICH element the focus
		// fell onto, so this is an observation rather than a constant.
		expect(
			end,
			'the Tab walk must terminate by leaving the document, not by hitting the step limit',
		).not.toBeNull();
		expect(
			end?.tag,
			'the walk must end on the document body — the standard way a Tab order ends (SC 2.4.3)',
		).toBe('BODY');

		expect(
			stops.length,
			'the home surface must expose a keyboard-reachable path (SC 2.1.1)',
		).toBeGreaterThanOrEqual(MIN_TAB_STOPS);

		// Every recorded stop must be an interactive control, and it must
		// carry a name a reader can hear. `stops` cannot contain a
		// supporting element (the walk stops there), so this is the
		// meaningful per-stop check.
		for (const stop of stops) {
			expect(
				INTERACTIVE_TAGS,
				`the focus landed on <${stop.tag}>, which is not an interactive control`,
			).toContain(stop.tag);
			expect(
				stop.label.length > 0 || stop.href !== null || stop.testId !== null,
				`the focused control <${stop.tag}> carries no accessible name, href or test id`,
			).toBe(true);
		}

		expect(
			forward,
			'the focus must move forward through the document; a stop that goes back means the focus was lost mid-document and the Tab order restarted (SC 2.4.3)',
		).toBe(true);

		expect(
			wrapped,
			'the Tab order must wrap back to the first stop after the end of the document (SC 2.4.3)',
		).toBe(true);
	});

	test('Shift+Tab walks the same order backwards', async ({ page }) => {
		await page.goto('/');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		const forward = await readActiveStop(page);
		await page.keyboard.press('Shift+Tab');
		const backward = await readActiveStop(page);

		expect(forward.href, 'the second Tab stop must not be the skip link again').not.toBe('#main');
		expect(backward.href, 'Shift+Tab must return to the previous stop (SC 2.4.3 Focus Order)').toBe(
			'#main',
		);
	});
});

/* ---------------------------------------------------------------------------
 * `/about` — the header nav (an opt-in page)
 * ------------------------------------------------------------------------- */

test.describe('/about — public nav (Issue #394)', () => {
	test('a nav link is reachable with Tab and Enter navigates to it', async ({ page }) => {
		await page.goto('/about');
		const nav = page.locator('nav[aria-label="Public"]');
		await expect(nav).toBeVisible();

		const toolsLink = nav.locator('a[href="/tools"]').first();
		await expect(toolsLink).toHaveCount(1);
		expect(
			await tabUntilFocused(page, toolsLink),
			'the /tools nav link must be reachable with Tab alone (SC 2.1.1)',
		).toBe(true);
		await expect(toolsLink).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/tools$/);
	});
});

/* ---------------------------------------------------------------------------
 * `/about` — the mobile menu (Escape closes it, the focus goes back)
 * ------------------------------------------------------------------------- */

test.describe('/about — mobile menu (Issue #394)', () => {
	// The `md` breakpoint is 768px. The spec uses the same 600px as
	// `e2e/nav.spec.ts`, which deterministically produces the collapsed
	// desktop strip (the state that has the mobile panel).
	test.use({ viewport: { width: 600, height: 800 } });

	test('the menu opens from the keyboard and Escape returns the focus to the trigger', async ({
		page,
	}) => {
		await page.goto('/about');
		const nav = page.locator('nav[aria-label="Public"]');
		const toggle = nav.locator('button[aria-controls]');
		const panel = nav.locator('[data-testid="public-nav-mobile-panel"]');

		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(panel).toBeHidden();

		// Focus the trigger with the keyboard and open it with Enter.
		expect(await tabUntilFocused(page, toggle), 'the menu trigger must be Tab-reachable').toBe(
			true,
		);
		await expect(toggle).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(panel).toBeVisible();

		// Tab moves into the panel.
		await page.keyboard.press('Tab');
		expect(
			await panel.evaluate((element) => element.contains(document.activeElement)),
			'the focus must be able to move into the open menu panel',
		).toBe(true);

		// Escape closes it, and the focus goes back to the trigger
		// (nothing is lost).
		await page.keyboard.press('Escape');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(panel).toBeHidden();
		const afterEscape = await readActiveStop(page);
		await expect(
			toggle,
			`the focus must return to the trigger that opened the menu (SC 2.4.3 / 2.1.2); the focus is on <${afterEscape.tag}> ${afterEscape.label}`,
		).toBeFocused();
	});
});

/* ---------------------------------------------------------------------------
 * `/tools` — the tools entry
 * ------------------------------------------------------------------------- */

test.describe('/tools — the tools entry (Issue #394)', () => {
	test('a published tool is reachable with Tab and Enter opens it', async ({ page }) => {
		await page.goto('/tools');
		const toolLinks = page.locator('a[href^="/tools/"]');
		const count = await toolLinks.count();
		expect(count, 'the tools index must publish at least one tool entry').toBeGreaterThan(0);

		const first = toolLinks.first();
		expect(await tabUntilFocused(page, first), 'the first tool entry must be Tab-reachable').toBe(
			true,
		);
		await expect(first).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/tools\/[a-z0-9-]+$/);
	});
});

/* ---------------------------------------------------------------------------
 * `/contact` — the channel list (there is no form)
 * ------------------------------------------------------------------------- */

test.describe('/contact — the channel list (Issue #394)', () => {
	test('the skip link and the channel links are reachable with Tab', async ({ page }) => {
		await page.goto('/contact');
		const skipLink = page.locator('a[href="#main"]');
		await expect(skipLink).toHaveCount(1);
		expect(
			await tabUntilFocused(page, skipLink),
			'the contact skip link must be Tab-reachable (SC 2.4.1)',
		).toBe(true);
		await expect(skipLink).toBeFocused();

		// `/contact` has no form (Issue #103 lists the verified channels
		// and nothing else), so there is no "can the focus reach an input
		// element" subject here. The fact is pinned explicitly: if a
		// form is ever added, this assertion turns red, and only then
		// does the input focus contract become a subject.
		expect(
			await page.locator('input, textarea, select').count(),
			'/contact is a static channel list — it must not grow a form without a focus contract',
		).toBe(0);
	});
});

/* ---------------------------------------------------------------------------
 * The one and only `<dialog>` — the reaction picker
 * ------------------------------------------------------------------------- */

test.describe('/ — the reactions picker dialog (Issue #394)', () => {
	test('the only dialog surface is the reactions picker, and this deployment states which state it is in', async ({
		page,
	}) => {
		await page.goto('/');
		const dialogs = page.locator('dialog');
		const dialogCount = await dialogs.count();
		for (let index = 0; index < dialogCount; index += 1) {
			await expect(dialogs.nth(index)).toHaveAttribute('aria-label', 'Add a reaction');
		}

		const trigger = page.getByTestId('home-reactions-open-picker');
		if (dialogCount === 0) {
			// The picker in `src/home/reactions/widget.tsx` is the only
			// `<dialog>` in this repository, and it renders only in a
			// deployment that has the home consumer API key (without it
			// the widget shows the "reactions disabled" marker). A
			// deployment without the key has no dialog element at all,
			// so the contract states that case explicitly instead of
			// skipping.
			await expect(
				page.getByText(/reactions disabled/i).first(),
				'without the picker there must be the documented disabled marker, not a silent gap',
			).toBeVisible();
			await expect(trigger).toHaveCount(0);
			return;
		}

		await expect(trigger).toHaveCount(1);
	});

	test('the picker dialog keeps the focus inside and returns it to the trigger on Escape', async ({
		page,
	}) => {
		await page.goto('/');
		const trigger = page.getByTestId('home-reactions-open-picker');
		if ((await trigger.count()) === 0) {
			// No subject in this deployment (the dialog is not rendered).
			// The test above already pins that the absence is a
			// documented state; here the state is stated instead of
			// skipping.
			await expect(page.getByText(/reactions disabled/i).first()).toBeVisible();
			return;
		}

		await trigger.click();
		const dialog = page.locator('dialog[aria-label="Add a reaction"]');
		await expect(dialog).toBeVisible();

		// The dialog must be MODAL. A non-modal `<dialog>` (opened with
		// `show()` instead of `showModal()`) keeps the page behind it
		// reachable, so the "no keyboard trap" contract is a property of
		// the modality, not of the element count inside the dialog.
		expect(
			await isModalDialog(dialog),
			'the picker dialog must be modal (opened with showModal()), otherwise the page behind it stays keyboard-reachable (SC 2.1.2)',
		).toBe(true);

		await waitForDialogFocusable(dialog);

		// Opening the dialog moves the focus into it (SC 2.1.2).
		expect(
			await isFocusInside(dialog),
			'opening the dialog must move the focus into the dialog',
		).toBe(true);

		for (let index = 0; index < 12; index += 1) {
			await page.keyboard.press('Tab');
			expect(
				await isFocusInside(dialog),
				`the focus escaped the dialog after ${index + 1} Tab(s)`,
			).toBe(true);
			expect(
				await isFocusOnDialogFocusable(dialog),
				`the Tab target after ${index + 1} Tab(s) is not one of the dialog's own focusable elements`,
			).toBe(true);
		}

		// Escape closes it and the focus goes back to the trigger.
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(
			trigger,
			'the focus must return to the trigger that opened the dialog',
		).toBeFocused();
	});
});

/* ---------------------------------------------------------------------------
 * `/design-system` — the shipped picker dialog fixture
 *
 * The home picker renders only when the home consumer API key is
 * configured, so a deployment without that key has no `<dialog>` at all
 * and the dialog's focus contract cannot be measured there. The
 * `/design-system` fixture mounts the SHIPPED dialog component
 * (`PickerModal`), so the contract below is exercised in every
 * deployment — the key is not part of the contract, the dialog is.
 * ------------------------------------------------------------------------- */

test.describe('/design-system — the reaction picker dialog fixture (Issue #394)', () => {
	test('the shipped picker dialog traps the focus and returns it to the trigger on Escape', async ({
		page,
	}) => {
		await page.goto('/design-system');
		const trigger = page.getByTestId('design-system-reaction-picker-open');
		await expect(trigger).toBeVisible();

		// Open it with the keyboard only: focus the trigger, press Enter.
		await trigger.focus();
		await expect(trigger).toBeFocused();
		await page.keyboard.press('Enter');

		const dialog = page.locator('dialog[aria-label="Add a reaction"]');
		await expect(dialog).toBeVisible();

		// The modality is the contract: a non-modal dialog leaves the
		// page behind it keyboard-reachable, and "the focus stayed
		// inside for twelve Tab presses" would not notice that.
		expect(
			await isModalDialog(dialog),
			'the shipped picker dialog must be modal (opened with showModal()) (SC 2.1.2)',
		).toBe(true);

		await waitForDialogFocusable(dialog);

		expect(
			await isFocusInside(dialog),
			'opening the dialog must move the focus into the dialog (SC 2.1.2)',
		).toBe(true);

		// Every Tab target stays inside the dialog, and it is one of the
		// dialog's own focusable elements (SC 2.1.2).
		for (let index = 0; index < 12; index += 1) {
			await page.keyboard.press('Tab');
			expect(
				await isFocusInside(dialog),
				`the focus escaped the dialog after ${index + 1} Tab(s)`,
			).toBe(true);
			expect(
				await isFocusOnDialogFocusable(dialog),
				`the Tab target after ${index + 1} Tab(s) is not one of the dialog's own focusable elements`,
			).toBe(true);
		}

		// Escape closes it, even though the picker's search input
		// consumes the key (SC 2.1.2), and the focus goes back to the
		// trigger that opened it (SC 2.4.3).
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(
			trigger,
			'the focus must return to the trigger that opened the dialog (SC 2.4.3)',
		).toBeFocused();
	});
});

/* ---------------------------------------------------------------------------
 * Negative control — proving the assertions can turn red
 * ------------------------------------------------------------------------- */

test.describe('negative control — the assertions can turn red (Issue #394)', () => {
	test('removing the skip link turns the first-Tab-stop assertion red', async ({ page }) => {
		await page.goto('/');
		expect(
			await skipLinkAssertionFails(page),
			'the skip-link assertion must pass on the shipped page',
		).toBe(false);

		// Production code is not rewritten: only the skip link is
		// removed from the DOM at runtime.
		await page.evaluate(() => {
			document.querySelector('a[href="#main"]')?.remove();
		});

		expect(
			await skipLinkAssertionFails(page),
			'the skip-link assertion must turn red once the skip link is removed — otherwise it asserts nothing',
		).toBe(true);
	});

	test('losing the focus mid-document turns the focus-order assertion red', async ({ page }) => {
		await page.goto('/');
		const shipped = await walkWholeDocument(page);
		expect(shipped.forward, 'the shipped page must walk forward through the document').toBe(true);

		// Remove the focused element from the DOM at runtime (the focus
		// falls to the body). Every later Tab restarts at the top of the
		// document.
		await page.goto('/');
		const broken = await walkWholeDocument(page, MAX_TAB_STOPS, 3);
		expect(
			broken.forward,
			'the focus-order assertion must turn red once the focus is lost mid-document — otherwise it asserts nothing',
		).toBe(false);
	});
});

test.describe('negative control — mobile menu (Issue #394)', () => {
	// Without a viewport that has the mobile panel, the trigger is
	// `display: none`, so the menu's negative control uses the same
	// viewport.
	test.use({ viewport: { width: 600, height: 800 } });

	test('removing the menu trigger turns the focus-return assertion red', async ({ page }) => {
		await page.goto('/about');
		const nav = page.locator('nav[aria-label="Public"]');
		const toggle = nav.locator('button[aria-controls]');

		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Tab');

		await page.evaluate(() => {
			document.querySelector('nav[aria-label="Public"] button[aria-controls]')?.remove();
		});
		await page.keyboard.press('Escape');

		let failed = false;
		try {
			await expect(toggle).toBeFocused();
		} catch {
			failed = true;
		}
		expect(
			failed,
			'the focus-return assertion must turn red once the trigger is gone — otherwise it asserts nothing',
		).toBe(true);
	});
});

/**
 * Check whether "the first Tab stop is the skip link" holds, and report
 * a violation as `true`.
 *
 * A helper for the negative control: catching the failure and turning
 * it into a boolean collects "the assertion turned red" into one
 * observation.
 */
async function skipLinkAssertionFails(page: Page): Promise<boolean> {
	try {
		const { stops } = await collectTabStops(page, 3);
		expect(stops[0]?.href).toBe('#main');
		return false;
	} catch {
		return true;
	}
}
