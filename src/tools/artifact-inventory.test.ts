/**
 * Tests for the Tool artefact license + dependency inventory policy
 * (Issue #466).
 *
 * The rules are pure functions over observations, so the table below is
 * the whole contract: given what a caller observed, which finding comes
 * out, and at which severity. The severity split — `error` for a Tool
 * this repository publishes, `warn` for a hold, `info` for an entry with
 * nothing to inspect — is the part a regression would hide, because a
 * missing severity downgrade turns an unreviewed license into a silent
 * pass.
 */
import { describe, expect, it } from 'vitest';

import {
	LICENSE_FILE_CANDIDATES,
	LOCKFILE_CANDIDATES_BY_PACKAGE_MANAGER,
	type ReviewedToolRecord,
	type ToolInventoryInput,
	buildReviewedRecord,
	declaredSpdxIds,
	detectSpdxLicenses,
	driftSeverity,
	evaluateToolArtifactInventory,
	isKnownSpdxId,
	isShippedDelivery,
	summarizeToolInventory,
} from './artifact-inventory';

const MIT_TEXT = `MIT License

Copyright (c) 2026 example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software, to deal in the Software without restriction.
`;

const AGPL_TEXT = `GNU AFFERO GENERAL PUBLIC LICENSE
Version 3, 19 November 2007

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License.
`;

/**
 * Canonical GPL-3.0 shape: the title names the GPL, and §13 cross-
 * references "version 3 of the GNU Affero General Public License".
 * Those are the two phrases that used to make one text report both
 * identifiers.
 */
const GPL_3_TEXT = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>

  "This License" refers to version 3 of the GNU General Public License.

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine any covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work, and to convey the resulting work.
`;

/**
 * Canonical AGPL-3.0 shape: the title names the AGPL, and §13 cross-
 * references "version 3 of the GNU General Public License".
 */
const AGPL_3_FULL_TEXT = `                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>

  13. Remote Network Interaction; Use with the GNU General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine any covered work with a work licensed
under version 3 of the GNU General Public License into a single
combined work, and to convey the resulting work.
`;

/** Canonical BSD-2-Clause grant: no "neither the name" clause. */
const BSD_2_TEXT = `Copyright (c) 2026 example

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".
`;

/** Canonical BSD-3-Clause grant: BSD-2 plus "neither the name". */
const BSD_3_TEXT = `${BSD_2_TEXT}
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.
`;

/** A fully verified observation, used as the baseline every rule edits. */
function baseInput(overrides: Partial<ToolInventoryInput> = {}): ToolInventoryInput {
	return {
		slug: 'widget',
		deliveryKind: 'same_origin_static',
		pinnedSha: 'a'.repeat(40),
		checkoutPresent: true,
		license: {
			declared: 'MIT',
			evidenceFile: 'LICENSE',
			evidenceSha256: 'lic-digest',
			evidenceText: MIT_TEXT,
			packageLicenseField: 'MIT',
		},
		dependencies: {
			lockfile: 'pnpm-lock.yaml',
			lockfileSha256: 'lock-digest',
			runtimeDependencies: ['left-pad'],
			devDependencyCount: 3,
		},
		outbound: { present: false, hosts: [] },
		reviewed: null,
		...overrides,
	};
}

function reviewedRecord(overrides: Partial<ReviewedToolRecord> = {}): ReviewedToolRecord {
	return {
		pinned_sha: 'a'.repeat(40),
		license: {
			status: 'verified',
			evidence_file: 'LICENSE',
			evidence_sha256: 'lic-digest',
			detected: ['MIT'],
		},
		dependencies: {
			status: 'verified',
			lockfile: 'pnpm-lock.yaml',
			lockfile_sha256: 'lock-digest',
			runtime: ['left-pad'],
		},
		outbound: { observed: false, hosts: [] },
		...overrides,
	};
}

const codes = (findings: readonly { code: string }[]) => findings.map((item) => item.code);

describe('detectSpdxLicenses', () => {
	it('recognises standard MIT text', () => {
		expect(detectSpdxLicenses(MIT_TEXT)).toEqual(['MIT']);
	});

	it('recognises AGPL-3.0 text', () => {
		expect(detectSpdxLicenses(AGPL_TEXT)).toEqual(['AGPL-3.0-only']);
	});

	it('does not read the GPL reference inside AGPL §13 as a second grant', () => {
		expect(detectSpdxLicenses(AGPL_3_FULL_TEXT)).toEqual(['AGPL-3.0-only']);
	});

	it('does not read the AGPL reference inside GPL §13 as a second grant', () => {
		expect(detectSpdxLicenses(GPL_3_TEXT)).toEqual(['GPL-3.0-only']);
	});

	it('reports BSD-3-Clause alone when the "neither the name" clause is present', () => {
		expect(detectSpdxLicenses(BSD_3_TEXT)).toEqual(['BSD-3-Clause']);
	});

	it('reports BSD-2-Clause alone when that clause is absent', () => {
		expect(detectSpdxLicenses(BSD_2_TEXT)).toEqual(['BSD-2-Clause']);
	});

	it('is case-insensitive and tolerates smart quotes', () => {
		expect(
			detectSpdxLicenses('permission is hereby granted, free of charge — without restriction'),
		).toEqual(['MIT']);
	});

	it('requires every phrase, so a mention is not a grant', () => {
		expect(
			detectSpdxLicenses('this bundle happens to mention the Apache License, Version 2.0'),
		).toEqual(['Apache-2.0']);
		expect(detectSpdxLicenses('see the Apache License for details')).toEqual([]);
	});

	it('reports an empty list for text that grants nothing recognisable', () => {
		expect(detectSpdxLicenses('Copyright 2026. All rights reserved.')).toEqual([]);
		expect(detectSpdxLicenses('')).toEqual([]);
		expect(detectSpdxLicenses(null)).toEqual([]);
	});
});

describe('declaredSpdxIds', () => {
	it('accepts a bare identifier', () => {
		expect(declaredSpdxIds('MIT')).toEqual(['MIT']);
	});

	it('expands an SPDX expression to the identifiers this policy knows', () => {
		expect(declaredSpdxIds('(MIT OR Apache-2.0)')).toEqual(['Apache-2.0', 'MIT']);
	});

	it('strips the trailing plus of a "or later" declaration', () => {
		expect(declaredSpdxIds('GPL-2.0+')).toEqual(['GPL-2.0-only']);
	});

	it('never turns a refusal to license into a grant', () => {
		expect(declaredSpdxIds('UNLICENSED')).toEqual([]);
		expect(declaredSpdxIds('SEE LICENSE IN LICENSE.md')).toEqual([]);
		expect(declaredSpdxIds('(c) 2026, all rights reserved')).toEqual([]);
		expect(declaredSpdxIds(undefined)).toEqual([]);
	});

	it('keeps the recognised identifier list in sync with the detector', () => {
		for (const id of declaredSpdxIds('MIT')) {
			expect(isKnownSpdxId(id)).toBe(true);
		}
		expect(isKnownSpdxId('WTFPL')).toBe(false);
	});
});

describe('severity policy', () => {
	it('only a Tool this repository publishes is a build failure', () => {
		expect(isShippedDelivery('same_origin_static')).toBe(true);
		expect(isShippedDelivery('external_exception')).toBe(false);
		expect(isShippedDelivery('host_disabled')).toBe(false);
	});

	it('fails closed for a published Tool, holds for an unpublished one, notes an empty one', () => {
		expect(driftSeverity(true, true)).toBe('error');
		expect(driftSeverity(true, false)).toBe('error');
		expect(driftSeverity(false, true)).toBe('warn');
		expect(driftSeverity(false, false)).toBe('info');
	});
});

describe('evaluateToolArtifactInventory — verified baseline', () => {
	it('reports nothing when license, dependencies and record all agree', () => {
		const result = evaluateToolArtifactInventory(baseInput({ reviewed: reviewedRecord() }));
		expect(result.findings).toEqual([]);
		expect(result.rows[0].verdict).toBe('PASS');
		expect(result.rows[0].license_status).toBe('verified');
		expect(result.rows[0].dependencies_status).toBe('verified');
	});

	it('reads the license and lockfile candidate lists as policy, not as caller input', () => {
		expect(LICENSE_FILE_CANDIDATES).toContain('LICENSE');
		expect(LICENSE_FILE_CANDIDATES).toContain('COPYING');
		expect(LOCKFILE_CANDIDATES_BY_PACKAGE_MANAGER.bun).toEqual(['bun.lock', 'bun.lockb']);
		expect(LOCKFILE_CANDIDATES_BY_PACKAGE_MANAGER.pnpm).toEqual(['pnpm-lock.yaml']);
	});
});

describe('evaluateToolArtifactInventory — license evidence', () => {
	it('fails a published Tool whose license file grants something else', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				license: {
					declared: 'MIT',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: AGPL_TEXT,
					packageLicenseField: null,
				},
			}),
		);
		expect(codes(result.findings)).toContain('LICENSE_MISMATCH');
		expect(result.findings[0].severity).toBe('error');
		expect(result.findings[0].message).toContain('AGPL-3.0-only');
		expect(result.rows[0].verdict).toBe('FAIL');
	});

	it('does not verify a GPL-3.0 claim against AGPL-3.0 text', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				license: {
					declared: 'GPL-3.0-only',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: AGPL_3_FULL_TEXT,
					packageLicenseField: null,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['LICENSE_MISMATCH']);
		expect(result.rows[0].license_status).toBe('mismatch');
	});

	it('does not verify a BSD-2-Clause claim against BSD-3-Clause text', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				license: {
					declared: 'BSD-2-Clause',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: BSD_3_TEXT,
					packageLicenseField: null,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['LICENSE_MISMATCH']);
		expect(result.rows[0].license_status).toBe('mismatch');
	});

	it('holds (does not fail) the same mismatch for a Tool nothing publishes', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				deliveryKind: 'host_disabled',
				reviewed: reviewedRecord(),
				license: {
					declared: 'MIT',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: AGPL_TEXT,
					packageLicenseField: null,
				},
			}),
		);
		expect(codes(result.findings)).toContain('LICENSE_MISMATCH');
		expect(result.findings[0].severity).toBe('warn');
		expect(result.rows[0].verdict).toBe('WARN');
	});

	it('fails a published Tool with no license file at all', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				license: {
					declared: 'MIT',
					evidenceFile: null,
					evidenceSha256: null,
					evidenceText: null,
					packageLicenseField: null,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['LICENSE_EVIDENCE_MISSING']);
		expect(result.findings[0].severity).toBe('error');
	});

	it('reports an undeclared license even when a license file exists', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord({
					license: {
						status: 'unverified',
						evidence_file: 'LICENSE',
						evidence_sha256: 'lic-digest',
						detected: ['MIT'],
					},
				}),
				license: {
					declared: null,
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: MIT_TEXT,
					packageLicenseField: 'MIT',
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['LICENSE_UNDECLARED']);
	});

	it('reports license text that grants nothing recognisable instead of passing it', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				license: {
					declared: 'MIT',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: 'Copyright 2026. All rights reserved.',
					packageLicenseField: null,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['LICENSE_UNRECOGNISED']);
	});

	it('reports a package.json license field that contradicts the license file', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				license: {
					declared: 'MIT',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: MIT_TEXT,
					packageLicenseField: 'Apache-2.0',
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['LICENSE_FIELD_MISMATCH']);
	});

	it('treats a missing package.json license field as absent, not as a contradiction', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				license: {
					declared: 'MIT',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: MIT_TEXT,
					packageLicenseField: null,
				},
			}),
		);
		expect(result.findings).toEqual([]);
	});
});

describe('evaluateToolArtifactInventory — dependency evidence', () => {
	it('fails a published Tool with no lockfile', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord({
					dependencies: {
						status: 'unverified',
						lockfile: null,
						lockfile_sha256: null,
						runtime: [],
					},
				}),
				dependencies: {
					lockfile: null,
					lockfileSha256: null,
					runtimeDependencies: [],
					devDependencyCount: 0,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['LOCKFILE_MISSING']);
		expect(result.rows[0].dependencies_status).toBe('unverified');
	});

	it('names what a rewritten lockfile added and removed', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord({
					dependencies: {
						status: 'verified',
						lockfile: 'pnpm-lock.yaml',
						lockfile_sha256: 'old-digest',
						runtime: ['left-pad'],
					},
				}),
				dependencies: {
					lockfile: 'pnpm-lock.yaml',
					lockfileSha256: 'new-digest',
					runtimeDependencies: ['left-pad', 'right-pad'],
					devDependencyCount: 1,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['DEPENDENCY_DRIFT']);
		expect(result.findings[0].message).toContain('added: right-pad');
		expect(result.findings[0].message).toContain('removed: none');
	});

	it('compares the runtime set even when the lockfile digest is unchanged', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				dependencies: {
					lockfile: 'pnpm-lock.yaml',
					lockfileSha256: 'lock-digest',
					runtimeDependencies: ['left-pad', 'right-pad'],
					devDependencyCount: 3,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['DEPENDENCY_DRIFT']);
		expect(result.findings[0].message).toContain('added: right-pad');
	});
});

describe('evaluateToolArtifactInventory — reviewed record', () => {
	it('fails when the record describes a different commit', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord({ pinned_sha: 'b'.repeat(40) }),
			}),
		);
		expect(codes(result.findings)).toEqual(['REVIEWED_PIN_MISMATCH']);
		expect(result.rows[0].reviewed_pin).toBe('b'.repeat(40));
	});

	it('compares the reviewed pin for an inventory-only entry too', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				deliveryKind: 'host_disabled',
				checkoutPresent: false,
				reviewed: reviewedRecord({ pinned_sha: 'b'.repeat(40) }),
				license: {
					declared: 'MIT',
					evidenceFile: null,
					evidenceSha256: null,
					evidenceText: null,
					packageLicenseField: null,
				},
				dependencies: {
					lockfile: null,
					lockfileSha256: null,
					runtimeDependencies: [],
					devDependencyCount: 0,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['REVIEWED_PIN_MISMATCH']);
		expect(result.findings[0].severity).toBe('info');
		expect(result.rows[0].verdict).toBe('INFO');
	});

	it('fails when the license file changed since the review', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord({
					license: {
						status: 'verified',
						evidence_file: 'LICENSE',
						evidence_sha256: 'old-digest',
						detected: ['MIT'],
					},
				}),
			}),
		);
		expect(codes(result.findings)).toEqual(['LICENSE_EVIDENCE_CHANGED']);
	});

	it('fails when no reviewed entry exists for a published Tool', () => {
		const result = evaluateToolArtifactInventory(baseInput({ reviewed: null }));
		expect(codes(result.findings)).toEqual(['REVIEW_RECORD_MISSING']);
		expect(result.findings[0].severity).toBe('error');
	});

	it('says nothing about an entry with no checkout and nothing published', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				deliveryKind: 'host_disabled',
				reviewed: null,
				checkoutPresent: false,
				license: {
					declared: 'MIT',
					evidenceFile: null,
					evidenceSha256: null,
					evidenceText: null,
					packageLicenseField: null,
				},
				dependencies: {
					lockfile: null,
					lockfileSha256: null,
					runtimeDependencies: [],
					devDependencyCount: 0,
				},
			}),
		);
		expect(result.findings).toEqual([]);
		expect(result.rows[0].verdict).toBe('INFO');
	});

	it('fails a published Tool whose checkout cannot be read at all', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				checkoutPresent: false,
				license: {
					declared: 'MIT',
					evidenceFile: null,
					evidenceSha256: null,
					evidenceText: null,
					packageLicenseField: null,
				},
				dependencies: {
					lockfile: null,
					lockfileSha256: null,
					runtimeDependencies: [],
					devDependencyCount: 0,
				},
			}),
		);
		expect(codes(result.findings)).toEqual(['CHECKOUT_UNVERIFIABLE', 'DEPENDENCY_UNVERIFIABLE']);
	});
});

describe('evaluateToolArtifactInventory — outbound references', () => {
	it('stays silent before a build has collected an artefact', () => {
		const result = evaluateToolArtifactInventory(baseInput({ reviewed: reviewedRecord() }));
		expect(result.rows[0].outbound_status).toBe('unobserved');
		expect(codes(result.findings)).not.toContain('OUTBOUND_UNDECLARED');
	});

	it('refuses a host the reviewed set does not contain', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord(),
				outbound: { present: true, hosts: ['example.com', 'metrics.example.org'] },
			}),
		);
		expect(codes(result.findings)).toEqual(['OUTBOUND_UNDECLARED']);
		// Issue #733 (V-2): a Tool this repository builds and serves must
		// not carry an external reference nobody reviewed. The remedy is
		// the record regeneration, which shows the host in the diff.
		expect(result.findings[0].severity).toBe('error');
		expect(result.rows[0].outbound_new).toEqual(['example.com', 'metrics.example.org']);
	});

	it('holds, but does not refuse, an undeclared host of a Tool this repository does not serve', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				deliveryKind: 'host_disabled',
				reviewed: reviewedRecord(),
				outbound: { present: true, hosts: ['example.com'] },
			}),
		);
		expect(codes(result.findings)).toEqual(['OUTBOUND_UNDECLARED']);
		expect(result.findings[0].severity).toBe('warn');
	});

	it('holds a reviewed host the artefact no longer references', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord({
					outbound: { observed: true, hosts: ['example.com', 'metrics.example.org'] },
				}),
				outbound: { present: true, hosts: ['example.com'] },
			}),
		);
		expect(codes(result.findings)).toEqual(['OUTBOUND_RECORD_STALE']);
		expect(result.findings[0].message).toContain('metrics.example.org');
	});

	it('says nothing when the artefact matches the reviewed set', () => {
		const result = evaluateToolArtifactInventory(
			baseInput({
				reviewed: reviewedRecord({ outbound: { observed: true, hosts: ['example.com'] } }),
				outbound: { present: true, hosts: ['example.com'] },
			}),
		);
		expect(result.findings).toEqual([]);
	});
});

describe('summarizeToolInventory', () => {
	it('counts the published, passing and inventory-only populations apart', () => {
		const result = evaluateToolArtifactInventory(baseInput({ reviewed: reviewedRecord() }));
		const inventoryOnly = evaluateToolArtifactInventory(
			baseInput({
				slug: 'shelved',
				deliveryKind: 'host_disabled',
				checkoutPresent: false,
				license: {
					declared: 'MIT',
					evidenceFile: null,
					evidenceSha256: null,
					evidenceText: null,
					packageLicenseField: null,
				},
				dependencies: {
					lockfile: null,
					lockfileSha256: null,
					runtimeDependencies: [],
					devDependencyCount: 0,
				},
			}),
		);
		expect(summarizeToolInventory([...result.rows, ...inventoryOnly.rows])).toEqual({
			tools: 2,
			shipped: 1,
			passed: 1,
			warned: 0,
			failed: 0,
			inventoryOnly: 1,
		});
	});
});

describe('buildReviewedRecord', () => {
	it('records the same verdict the gate reports for the same observation', () => {
		const observed = baseInput();
		expect(buildReviewedRecord(observed).license.status).toBe(
			evaluateToolArtifactInventory(observed).rows[0].license_status,
		);
		expect(buildReviewedRecord(observed).dependencies.status).toBe(
			evaluateToolArtifactInventory(observed).rows[0].dependencies_status,
		);
	});

	it('records what was observed, not what was declared', () => {
		const record = buildReviewedRecord(
			baseInput({
				license: {
					declared: 'MIT',
					evidenceFile: 'LICENSE',
					evidenceSha256: 'lic-digest',
					evidenceText: AGPL_TEXT,
					packageLicenseField: null,
				},
			}),
		);
		expect(record.license.status).toBe('mismatch');
		expect(record.license.detected).toEqual(['AGPL-3.0-only']);
	});

	it('records an unbuilt artefact as unobserved rather than as "no hosts"', () => {
		const record = buildReviewedRecord(baseInput({ outbound: { present: false, hosts: [] } }));
		expect(record.outbound).toEqual({ observed: false, hosts: [] });
	});
});
