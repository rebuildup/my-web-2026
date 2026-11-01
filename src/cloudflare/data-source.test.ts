import { describe, expect, it } from 'vitest';
import {
	DATA_SOURCE,
	DATA_SOURCE_ENV_VAR,
	FORCE_LOCAL_ENV_VAR,
	isProductionReadonlyValue,
	isRemoteBindingsEnabled,
	isWritable,
	productionWriteRefusal,
	resolveDataSource,
} from './data-source';

describe('resolveDataSource', () => {
	it('reports the deployed Worker as production', () => {
		const descriptor = resolveDataSource({});
		expect(descriptor.source).toBe(DATA_SOURCE.PRODUCTION);
		expect(descriptor.write_policy).toBe('writable');
		expect(descriptor.binding_source).toBe('production');
	});

	it('reports the local dev server as local', () => {
		const descriptor = resolveDataSource({ [DATA_SOURCE_ENV_VAR]: 'local' });
		expect(descriptor.source).toBe(DATA_SOURCE.LOCAL);
		expect(descriptor.write_policy).toBe('writable');
		expect(descriptor.binding_source).toBe('local');
	});

	it('reports the mock gate as mock, whatever the binding source says', () => {
		const descriptor = resolveDataSource({
			LOCAL_API_MODE: 'mock',
			[DATA_SOURCE_ENV_VAR]: 'local',
		});
		expect(descriptor.source).toBe(DATA_SOURCE.MOCK);
		expect(descriptor.api_mode).toBe('mock');
		expect(descriptor.write_policy).toBe('writable');
	});

	it('reports the mock gate as mock even without a data-source binding', () => {
		const descriptor = resolveDataSource({ LOCAL_API_MODE: 'mock' });
		expect(descriptor.source).toBe(DATA_SOURCE.MOCK);
		expect(descriptor.api_mode).toBe('mock');
	});

	it('keeps the production opt-in ahead of a stale mock gate', () => {
		const descriptor = resolveDataSource({
			LOCAL_API_MODE: 'mock',
			[DATA_SOURCE_ENV_VAR]: 'production-readonly',
		});
		expect(descriptor.source).toBe(DATA_SOURCE.PRODUCTION_READONLY);
		expect(descriptor.api_mode).toBe('live');
		expect(descriptor.write_policy).toBe('read-only');
		expect(descriptor.warning).toContain('LOCAL_API_MODE');
	});

	it('reports the remote-binding dev server as production-readonly', () => {
		const descriptor = resolveDataSource({ [DATA_SOURCE_ENV_VAR]: 'production-readonly' });
		expect(descriptor.source).toBe(DATA_SOURCE.PRODUCTION_READONLY);
		expect(descriptor.write_policy).toBe('read-only');
		expect(descriptor.binding_source).toBe('production');
	});

	it('fails closed on an unrecognised value and says so', () => {
		const descriptor = resolveDataSource({ [DATA_SOURCE_ENV_VAR]: 'production' });
		expect(descriptor.write_policy).toBe('read-only');
		expect(descriptor.warning).toContain(DATA_SOURCE_ENV_VAR);
	});

	it('keeps the write refusal when the bindings stayed local', () => {
		const descriptor = resolveDataSource({
			[DATA_SOURCE_ENV_VAR]: DATA_SOURCE.PRODUCTION_READONLY_LOCAL,
		});
		expect(descriptor.source).toBe(DATA_SOURCE.PRODUCTION_READONLY);
		expect(descriptor.write_policy).toBe('read-only');
		expect(descriptor.binding_source).toBe('local');
		expect(descriptor.detail).toContain('local');
	});
});

describe('isRemoteBindingsEnabled', () => {
	it('is off by default', () => {
		expect(isRemoteBindingsEnabled({})).toBe(false);
	});

	it('is on only for the production-readonly mode', () => {
		expect(
			isRemoteBindingsEnabled({ [DATA_SOURCE_ENV_VAR]: DATA_SOURCE.PRODUCTION_READONLY }),
		).toBe(true);
	});

	it('is off when the operator forced the bindings to stay local', () => {
		expect(
			isRemoteBindingsEnabled({
				[DATA_SOURCE_ENV_VAR]: DATA_SOURCE.PRODUCTION_READONLY,
				[FORCE_LOCAL_ENV_VAR]: 'true',
			}),
		).toBe(false);
	});
});

describe('isWritable / productionWriteRefusal', () => {
	it('allows writes in production, local and mock', () => {
		expect(isWritable({})).toBe(true);
		expect(isWritable({ [DATA_SOURCE_ENV_VAR]: 'local' })).toBe(true);
		expect(isWritable({ LOCAL_API_MODE: 'mock' })).toBe(true);
		expect(productionWriteRefusal({ [DATA_SOURCE_ENV_VAR]: 'local' }, 'x')).toBeNull();
	});

	it('refuses writes in production-readonly mode with a reason', () => {
		const refusal = productionWriteRefusal(
			{ [DATA_SOURCE_ENV_VAR]: 'production-readonly' },
			'reactions:insert',
		);
		expect(refusal?.code).toBe('production_readonly_write_refused');
		expect(refusal?.operation).toBe('reactions:insert');
		expect(refusal?.message).toContain('production');
	});

	it('refuses writes when the value cannot be classified', () => {
		const refusal = productionWriteRefusal({ [DATA_SOURCE_ENV_VAR]: 'typo' }, 'access:hit');
		expect(refusal?.code).toBe('production_readonly_write_refused');
	});
});

describe('isProductionReadonlyValue', () => {
	it('is true for exactly one value', () => {
		expect(isProductionReadonlyValue('production-readonly')).toBe(true);
		expect(isProductionReadonlyValue('local')).toBe(false);
		expect(isProductionReadonlyValue(undefined)).toBe(false);
	});
});
