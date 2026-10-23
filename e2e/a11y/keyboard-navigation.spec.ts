import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * キーボードのみのナビゲーション回帰検査 (Issue #394)
 *
 * キーボードだけで主要導線を完了できることは、WCAG 2.2 の
 * SC 2.1.1 Keyboard / SC 2.1.2 No Keyboard Trap / SC 2.4.1 Bypass Blocks /
 * SC 2.4.3 Focus Order / SC 2.4.7 Focus Visible の要求である。この
 * リポジトリにはその回帰検査が 1 本もなかった。本 spec は既存の
 * route に対して「キーボードだけで到達でき、focus を見失わず、
 * 開いた場所へ focus が戻る」ことを機械で観測する。
 *
 * 機械で決まること (この spec が検査する範囲)
 *   - skip link が最初の Tab stoppableで、Enter で main へ移動する
 *     (SC 2.4.1 Bypass Blocks)。
 *   - Tab / Shift+Tab の順序が DOM 順と矛盾せず、文書末尾で先頭へ
 *     wrap する = 途中で focus を見失っていない (SC 2.4.3 Focus Order)。
 *   - mobile menu が Enter で開き、Escape で閉じたとき focus がトリガへ
 *     戻る (SC 2.1.2 / SC 2.4.3)。
 *   - 唯一の `<dialog>` (リアクション picker) が開いている間、focus が
 *     dialog の外へ出ない (SC 2.1.2 No Keyboard Trap)。
 *
 * 機械では決めないこと (人が評価する範囲)
 *   - focus ring の見た目 (視認性・コントラスト)。#399 の gate と人が
 *     評価する領域であり、ここでは扱わない。
 *   - スクリーンリーダーの読み上げ、 MCA (読み上げ) 順序の体感。
 *
 * 既存 config を流用する
 * ----------------------
 * `playwright.config.ts` の `testDir: './e2e'` に置くことで、既存の
 * `pnpm run e2e` (CI の release gate) に乗る。新しい Playwright 設定
 * ファイルは作らず、CI workflow YAML も変更しない。
 *
 * 安定性
 * ------
 *   - `networkidle` や sleep で同期を補わない。待つのは「意味のある要素」
 *     (`expect(locator).toBeVisible()`) だけ。
 *   - 乱数・時刻に依存しない。Tab 順は静的な DOM から読む。
 *   - negative control を必ず 1 つ以上入れる。正常な実装だけで緑に
 *     すると、assertion が何も見ていない可能性が残るためである。
 *     negative control は production コードを書き換えず、実行時に DOM を
 *     一時的に壊すだけで済る。
 */

/** 1 つの Tab stop の観測結果。 */
interface FocusStop {
	/** 要素の tag 名 (`A` / `BUTTON` / `SUMMARY` …)。 */
	tag: string;
	/** `href` 属性 (リンクの場合)。 */
	href: string | null;
	/** `data-testid` 属性 (stable な識別子がある場合)。 */
	testId: string | null;
	/** 人が読めるラベル。 */
	label: string;
	/** `<main>` の内側にいるか。 */
	inMain: boolean;
}

/** 1 回の走査で許容する Tab stop 数の上限。 */
const MAX_TAB_STOPS = 60;

/** 走査の途中で focus が見失われたとみなす supportive element。 */
function isSupportingElement(stop: FocusStop): boolean {
	return stop.tag === 'BODY' || stop.tag === 'HTML' || stop.tag === 'NONE';
}

/** 2 つの stop が同じ要素を指すか (wrap の判定に使う)。 */
function sameStop(a: FocusStop, b: FocusStop | undefined): boolean {
	if (!b) return false;
	return a.tag === b.tag && a.href === b.href && a.label === b.label;
}

/** 現在の `document.activeElement` を読む。 */
async function readActiveStop(page: Page): Promise<FocusStop> {
	return page.evaluate(() => {
		const element = document.activeElement;
		if (!element) {
			return { tag: 'NONE', href: null, testId: null, label: '', inMain: false };
		}
		const raw = element.getAttribute('aria-label') ?? element.textContent ?? '';
		return {
			tag: element.tagName,
			href: element.getAttribute('href'),
			testId: element.getAttribute('data-testid'),
			label: raw.replace(/\s+/g, ' ').trim().slice(0, 48),
			inMain: element.closest('main') !== null,
		};
	});
}

/**
 * Tab で focus が止まった要素を順に集める。
 *
 * `body` / `html` に落ちた時点が「focus が見失われた」地点だが、文書
 * 末尾の wrap-around でも同じ supportive element に落ちる。そのため
 * 「意味のある要素が何個連続して並んだか」と「最後に supportive element
 * へ落ちたか」を分けて返す。
 */
async function collectTabStops(
	page: Page,
	max: number = MAX_TAB_STOPS,
): Promise<{ stops: FocusStop[]; reachedEnd: boolean }> {
	const stops: FocusStop[] = [];
	for (let index = 0; index < max; index += 1) {
		await page.keyboard.press('Tab');
		const stop = await readActiveStop(page);
		if (isSupportingElement(stop)) {
			return { stops, reachedEnd: true };
		}
		stops.push(stop);
	}
	return { stops, reachedEnd: false };
}

/**
 * 文書末尾まで Tab し、その後で先頭へ wrap することまで確認する。
 *
 * wrap しないのは「途中で focus を見失った」場合だけである（focus を
 * 失った位置の直後が次の Tab の着地点になるため、新しい要素に跳ぶ）。
 * したがって「wrap した」事実は、focus を見失っていないことの証拠に
 * なる。
 */
async function walkWholeDocument(
	page: Page,
	max: number = MAX_TAB_STOPS,
): Promise<{ stops: FocusStop[]; wrapped: boolean }> {
	const { stops, reachedEnd } = await collectTabStops(page, max);
	if (!reachedEnd || stops.length === 0) return { stops, wrapped: false };
	await page.keyboard.press('Tab');
	const first = await readActiveStop(page);
	return { stops, wrapped: sameStop(first, stops[0]) };
}

/** Tab を重ねて `target` に focus 할 때까지進める。 */
async function tabUntilFocused(page: Page, target: Locator, max = MAX_TAB_STOPS): Promise<boolean> {
	// `evaluateAll` を使うのは、同じ href の link が desktop strip と
	// mobile panel の両方に存在しうるため。単一要素に限定すると
	// strict mode violation で例外になり、判定が壊れる。
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
 * `/` — Home: skip link と focus 順序
 * ------------------------------------------------------------------------- */

test.describe('/ — home: skip link and focus order (Issue #394)', () => {
	test('the skip link is the first Tab stop and moves the focus past the repeated chrome', async ({
		page,
	}) => {
		await page.goto('/');
		const skipLink = page.locator('a[href="#main"]');
		await expect(skipLink).toHaveCount(1);

		// Tab 1 番で skip link に focus する。
		await page.keyboard.press('Tab');
		await expect(skipLink).toBeFocused();

		// Enter で main へ移動する。`<main>` 自体は focusable ではないため、
		// 観測できるのは「fragment が変わった」ことと「次の Tab が main の
		// 内から始まる」こと (sequential focus navigation starting point)。
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
		const { stops, wrapped } = await walkWholeDocument(page);

		expect(
			stops.length,
			'the home surface must expose a keyboard-reachable path (SC 2.1.1)',
		).toBeGreaterThanOrEqual(5);
		for (const stop of stops) {
			expect(
				isSupportingElement(stop),
				`the focus fell onto a supporting element (${stop.tag}) instead of a meaningful control`,
			).toBe(false);
		}
		expect(
			wrapped,
			'the Tab order must wrap back to the first stop after the end of the document; a non-wrapping walk means the focus was lost mid-document (SC 2.4.3)',
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
 * `/about` — ヘッダー nav (opt-in page)
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
 * `/about` — mobile menu (Escape で閉じ、focus がトリガへ戻る)
 * ------------------------------------------------------------------------- */

test.describe('/about — mobile menu (Issue #394)', () => {
	// `md` の breakpoint は 768px。`e2e/nav.spec.ts` と同じ 600px を
	// 使い、desktop strip が畳まれた状態（mobile panel のある状態）を
	// 決定的につくる。
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

		// トリガへ keyboard で focus して Enter で開く。
		expect(await tabUntilFocused(page, toggle), 'the menu trigger must be Tab-reachable').toBe(
			true,
		);
		await expect(toggle).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(panel).toBeVisible();

		// パネル内へ Tab 进去る。
		await page.keyboard.press('Tab');
		expect(
			await panel.evaluate((element) => element.contains(document.activeElement)),
			'the focus must be able to move into the open menu panel',
		).toBe(true);

		// Escape で閉じる。閉じたとき focus はトリガへ戻る (見失れない)。
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
 * `/tools` — Tools 入口
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
 * `/contact` — channel 一覧 (フォームは無い)
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

		// `/contact` にはフォームが無い (Issue #103: channel の一覧だけ) ため、
		// 「入力要素に focus が届くか」の対象が存在しない。ここではその
		// 事実を明示的に固定する。フォームが追加されたら、この assertion
		// が赤になる = そのときに初めて入力要素の focus 契約が要る。
		expect(
			await page.locator('input, textarea, select').count(),
			'/contact is a static channel list — it must not grow a form without a focus contract',
		).toBe(0);
	});
});

/* ---------------------------------------------------------------------------
 * 唯一の `<dialog>` — リアクション picker
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
			// `src/home/reactions/widget.tsx` の picker は、この
			// リポジトリ唯一の `<dialog>` であり、home consumer API key が
			// 設定された deployment でのみ描画される (未設定なら
			// 「reactions disabled」表示になる)。key の無い環境では dialog
			// の実体が存在しないので、Contract としてその状態を明示する
			// (skip はしない)。
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
			// 対象なし (dialog が描画されない deployment)。上の test が
			// 「dialog が存在しないのは documented な状態であること」を
			// 固定している。ここでは skip ではなく、その状態を表明する。
			await expect(page.getByText(/reactions disabled/i).first()).toBeVisible();
			return;
		}

		await trigger.click();
		const dialog = page.locator('dialog[aria-label="Add a reaction"]');
		await expect(dialog).toBeVisible();

		// dialog を開いたら focus は dialog 内に留まる (SC 2.1.2)。
		const inside = await dialog.evaluate((element) => element.contains(document.activeElement));
		expect(inside, 'opening the dialog must move the focus into the dialog').toBe(true);

		for (let index = 0; index < 12; index += 1) {
			await page.keyboard.press('Tab');
			const stillInside = await dialog.evaluate((element) =>
				element.contains(document.activeElement),
			);
			expect(stillInside, `the focus escaped the dialog after ${index + 1} Tab(s)`).toBe(true);
		}

		// Escape で閉じると focus はトリガへ戻る。
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(
			trigger,
			'the focus must return to the trigger that opened the dialog',
		).toBeFocused();
	});
});

/* ---------------------------------------------------------------------------
 * negative control — assertion が赤になれることの確認
 * ------------------------------------------------------------------------- */

test.describe('negative control — the assertions can turn red (Issue #394)', () => {
	test('removing the skip link turns the first-Tab-stop assertion red', async ({ page }) => {
		await page.goto('/');
		expect(
			await skipLinkAssertionFails(page),
			'the skip-link assertion must pass on the shipped page',
		).toBe(false);

		// production コードは書き換えず、実行時に DOM から skip link を
		// 外すだけ。
		await page.evaluate(() => {
			document.querySelector('a[href="#main"]')?.remove();
		});

		expect(
			await skipLinkAssertionFails(page),
			'the skip-link assertion must turn red once the skip link is removed — otherwise it asserts nothing',
		).toBe(true);
	});
});

test.describe('negative control — mobile menu (Issue #394)', () => {
	// mobile panel のある viewport でないと trigger が `display: none` に
	// なるため、menu の negative control は同じ viewport を使う。
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
 * 「最初の Tab stop が skip link か」を検査し、違反したら true を返す。
 *
 * negative control 用の helper。catch して boolean に落とすのは、
 * 「assertion が赤になる」ことを 1 つの観測にまとめるため。
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
