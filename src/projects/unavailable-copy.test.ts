import { describe, expect, it } from 'vitest';
import { availabilityLabel, unavailableNotice, unavailableReasonLabel } from './unavailable-copy';

describe('unavailable source copy', () => {
	it('says "not public" only for the source states that mean it', () => {
		for (const reason of ['not-found', 'not-public']) {
			expect(unavailableNotice(reason)).toContain('現在公開されていない');
		}
		for (const reason of ['archived', 'ref-mismatch', 'readme-shape']) {
			expect(unavailableNotice(reason)).not.toContain('現在公開されていない');
		}
	});

	it('names the actual source state for every declared reason', () => {
		expect(unavailableNotice('archived')).toContain('アーカイブ');
		expect(unavailableNotice('ref-mismatch')).toContain('既定ブランチ');
		expect(unavailableNotice('readme-shape')).toContain('README の構成');
	});

	it('falls back to an unknown-state note instead of claiming non-publication', () => {
		expect(unavailableNotice(null)).toContain('現在の状態を確認できなかった');
		expect(unavailableNotice('something-new')).not.toContain('現在公開されていない');
	});

	it('labels the provenance cell with the specific reason', () => {
		expect(availabilityLabel('not-public')).toBe('unavailable — 上流リポジトリが公開されていない');
		expect(unavailableReasonLabel('readme-shape')).toBe('README の構成を解釈できない');
		expect(unavailableReasonLabel(null)).toBe('理由を特定できない');
	});
});
