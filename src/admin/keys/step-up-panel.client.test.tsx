import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepUpStatus } from '../auth/step-up';
import { StepUpPanel } from './step-up-panel';

/**
 * `StepUpPanel` expiry behaviour (Issue #445, review fix).
 *
 * Contract under test: a tab left open across the end of the five-minute
 * window must NOT keep claiming the session is confirmed. The panel owns
 * a client-only clock, so it is the only component that notices the
 * boundary before the next request does — and before it noticed, the
 * `confirmed` badge stayed up, the re-auth form stayed hidden and the
 * create button stayed enabled until someone pressed it and got refused.
 *
 * The panel therefore hands the lapsed status back to the caller, which
 * is what flips the rest of the surface (`KeysRoute` passes `setStatus`
 * for both `onConfirmed` and `onExpired`).
 *
 * Two seams are stubbed:
 *
 *   - `../auth/step-up` pulls in `cloudflare:workers` through the server
 *     functions, which cannot resolve outside the workerd pool. The
 *     `lapseStepUpStatus` stub is the same predicate as the real one;
 *     the real rule (including the exact-boundary case) is covered in
 *     `src/admin/auth/step-up.test.ts`. What is under test HERE is the
 *     panel's wiring: that the crossing calls `onExpired`, and that the
 *     caller adopting the result re-renders the expired state.
 *   - `@tanstack/react-start` — `useServerFn` needs a request context
 *     this suite has none of. No test below submits the form.
 */
vi.mock('@tanstack/react-start', () => ({
	useServerFn: () => async () => ({ ok: false as const }),
}));

vi.mock('../auth/step-up', () => ({
	STEP_UP_MAX_AGE_SECONDS: 300,
	confirmStepUp: async () => ({ ok: false as const }),
	lapseStepUpStatus: (status: StepUpStatus, nowMs: number) => {
		if (status.state !== 'confirmed' || status.expiresAtMs === null) return null;
		return nowMs < status.expiresAtMs ? null : { ...status, state: 'expired' as const };
	},
}));

const NOW = 1_700_000_000_000;
const CONFIRMED_AT = NOW - 60_000;
const EXPIRES_AT = CONFIRMED_AT + 300_000;

const confirmedStatus: StepUpStatus = {
	state: 'confirmed',
	confirmedAtMs: CONFIRMED_AT,
	expiresAtMs: EXPIRES_AT,
};

/**
 * The caller as `KeysRoute` composes it: it owns the status, adopts
 * whatever the panel reports, and re-renders the panel from it.
 */
function Harness({
	initial,
	onExpired,
}: {
	initial: StepUpStatus;
	onExpired: (status: StepUpStatus) => void;
}) {
	const [status, setStatus] = useState<StepUpStatus>(initial);
	return (
		<StepUpPanel
			status={status}
			onConfirmed={setStatus}
			onExpired={(next) => {
				onExpired(next);
				setStatus(next);
			}}
		/>
	);
}

function renderPanel(initial: StepUpStatus) {
	const lapses: StepUpStatus[] = [];
	const view = render(<Harness initial={initial} onExpired={(next) => lapses.push(next)} />);
	return {
		view,
		lapses,
		labels: () =>
			Array.from(view.container.querySelectorAll('span')).map((el) => el.textContent ?? ''),
		reauthForm: () => view.container.querySelector('form'),
		summary: () => view.container.querySelector('output')?.textContent ?? '',
	};
}

describe('StepUpPanel — the window lapses on the client clock', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('keeps the confirmation and the countdown while the window is open', () => {
		const { lapses, labels, reauthForm, summary } = renderPanel(confirmedStatus);
		expect(labels()).toContain('confirmed');
		expect(reauthForm()).toBeNull();
		expect(summary()).toContain('4 分以内');
		act(() => {
			vi.advanceTimersByTime(120_000);
		});
		expect(lapses).toEqual([]);
		expect(labels()).toContain('confirmed');
		// Half the window is gone; the copy counts down instead of
		// repeating the constant.
		expect(summary()).toContain('2 分以内');
	});

	it('hands the lapsed status back when the clock crosses the boundary', () => {
		const { lapses, labels, reauthForm, summary } = renderPanel(confirmedStatus);
		act(() => {
			vi.advanceTimersByTime(EXPIRES_AT - NOW + 1_000);
		});
		expect(lapses).toEqual([
			{ state: 'expired', confirmedAtMs: CONFIRMED_AT, expiresAtMs: EXPIRES_AT },
		]);
		// The caller adopted it, so the surface reads as lapsed: the
		// badge flips, the re-auth form comes back and the copy says so.
		expect(labels()).toContain('expired');
		expect(labels()).not.toContain('confirmed');
		expect(reauthForm()).not.toBeNull();
		expect(summary()).toContain('有効期限が切れました');
	});

	it('lapses on arrival when the tab was opened after the window closed', () => {
		const lapsedOnArrival: StepUpStatus = {
			state: 'confirmed',
			confirmedAtMs: CONFIRMED_AT,
			expiresAtMs: NOW - 1_000,
		};
		const { lapses, labels, reauthForm } = renderPanel(lapsedOnArrival);
		expect(lapses).toEqual([
			{ state: 'expired', confirmedAtMs: CONFIRMED_AT, expiresAtMs: lapsedOnArrival.expiresAtMs },
		]);
		expect(labels()).toContain('expired');
		expect(reauthForm()).not.toBeNull();
	});

	it('never lapses a session that never confirmed', () => {
		const { lapses, labels, reauthForm } = renderPanel({
			state: 'required',
			confirmedAtMs: null,
			expiresAtMs: null,
		});
		act(() => {
			vi.advanceTimersByTime(600_000);
		});
		expect(lapses).toEqual([]);
		expect(labels()).toContain('required');
		expect(reauthForm()).not.toBeNull();
	});

	it('reports the lapse once, not on every later tick', () => {
		const { lapses } = renderPanel(confirmedStatus);
		act(() => {
			vi.advanceTimersByTime(EXPIRES_AT - NOW + 1_000);
		});
		act(() => {
			vi.advanceTimersByTime(600_000);
		});
		expect(lapses).toHaveLength(1);
	});
});
