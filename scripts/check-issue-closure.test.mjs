import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLOSURE_STATES, checkEntry, checkLedger } from './check-issue-closure.mjs';

function entry(overrides = {}) {
	return {
		issue: 274,
		title: 'feat: Codex ペットのキャラクターとアニメーションを Web でも再利用する',
		closedAt: '2026-10-31',
		state: 'planned-unimplemented',
		closure: 'unsupported',
		evidence: ['docs/personal/codex-pet.md'],
		decision: null,
		recordedBy: 'agent',
		ownerConfirmation: 'unconfirmed',
		action: 'reopened',
		...overrides,
	};
}

test('the closure vocabulary holds the eight states Issue #741 declares', () => {
	assert.equal(CLOSURE_STATES.length, 8);
	assert.ok(CLOSURE_STATES.includes('implemented-and-verified'));
	assert.ok(CLOSURE_STATES.includes('private-not-exported'));
});

test('a well-formed entry produces no finding', () => {
	assert.deepEqual(checkEntry(entry()), []);
});

test('a state outside the vocabulary is E002', () => {
	const findings = checkEntry(entry({ state: 'done' }));
	assert.equal(findings.length, 1);
	assert.equal(findings[0].rule, 'E002');
});

test('an unsupported closure may not carry a completion state (E004)', () => {
	const findings = checkEntry(entry({ state: 'implemented-and-verified', closure: 'unsupported' }));
	assert.ok(findings.some((f) => f.rule === 'E004'));
});

test('a completion state without openable evidence is E003', () => {
	const findings = checkEntry(
		entry({ state: 'implemented-and-verified', closure: 'supported', evidence: ['完了しました'] }),
	);
	assert.ok(findings.some((f) => f.rule === 'E003'));
});

test('the 2026-10-31 sweep template alone is not evidence (E006)', () => {
	const findings = checkEntry(
		entry({
			state: 'implemented-and-verified',
			closure: 'supported',
			evidence: ['回収完了。release-0-8-0統合完了（#679待機中）。'],
		}),
	);
	assert.ok(findings.some((f) => f.rule === 'E006'));
});

test('a decision state without a written reason is E005', () => {
	const findings = checkEntry(
		entry({ state: 'deferred-with-reason', closure: 'supported', decision: null }),
	);
	assert.ok(findings.some((f) => f.rule === 'E005'));
});

test('a decision state with a reason passes', () => {
	assert.deepEqual(
		checkEntry(
			entry({
				state: 'deferred-with-reason',
				closure: 'supported',
				decision: { kind: 'owner', reason: '公開方針の判断待ち' },
			}),
		),
		[],
	);
});

test('an agent-written record may not claim owner confirmation without a URL (E007)', () => {
	const findings = checkEntry(
		entry({ ownerConfirmation: 'confirmed', ownerReference: 'owner said so' }),
	);
	assert.ok(findings.some((f) => f.rule === 'E007'));
});

test('an agent-written record with a traceable owner artefact passes', () => {
	assert.deepEqual(
		checkEntry(
			entry({
				ownerConfirmation: 'confirmed',
				ownerReference: 'https://github.com/rebuildup/my-web-2026/pull/123#pullrequestreview-1',
			}),
		),
		[],
	);
});

test('owner confirmation without any reference is E007', () => {
	const findings = checkEntry(entry({ ownerConfirmation: 'confirmed' }));
	assert.ok(findings.some((f) => f.rule === 'E007'));
});

test('the same issue twice in one ledger is E008', () => {
	const { findings } = checkLedger({
		entries: [entry({ issue: 274 }), entry({ issue: 274 })],
	});
	assert.ok(findings.some((f) => f.rule === 'E008'));
});

test('the summary separates owner-confirmed from awaiting-confirmation records', () => {
	const { summary } = checkLedger({
		entries: [
			entry({ issue: 1, ownerConfirmation: 'unconfirmed' }),
			entry({
				issue: 2,
				ownerConfirmation: 'confirmed',
				ownerReference: 'https://github.com/rebuildup/my-web-2026/pull/1',
			}),
		],
	});
	assert.equal(summary.entries, 2);
	assert.equal(summary.ownerConfirmed, 1);
	assert.equal(summary.awaitingOwnerConfirmation, 1);
});

test('the summary counts states, not a score of closed issues', () => {
	const { summary } = checkLedger({ entries: [entry({ issue: 7 })] });
	assert.equal(summary.byState['planned-unimplemented'], 1);
	assert.equal(summary.byClosure.unsupported, 1);
});
