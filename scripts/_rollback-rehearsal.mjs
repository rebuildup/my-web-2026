/**
 * Offline rollback rehearsal for a failed Cloudflare Workers Builds
 * release (Issue #503).
 *
 * The obligation this file owns
 * -----------------------------
 * `docs/runbook/cloudflare-workers-builds.md` defines the canonical
 * production release sequence and the failure branches around it.
 * `docs/release.md` defines the release / patch-release workflow. This
 * module does not restate either document's ordering; it records a
 * **rehearsal** of the three failure classes those documents describe
 * (a failed build, a failed smoke, a post-deploy regression) and turns
 * the human procedure into a table the test suite can assert:
 *
 *   - what triggers the path,
 *   - who decides,
 *   - the exact command or owner procedure,
 *   - the observation that proves the step happened,
 *   - what cannot be undone by taking the step.
 *
 * Fail closed
 * -----------
 * A step with no owner, no observation, no authority citation, or no
 * "not reversible" record is an error, never a blank cell rendered as if
 * the procedure were complete. A mutating step (Worker binding,
 * repository, release merge, production deploy, D1) is accepted only
 * when the repository owner owns it AND the step is explicitly marked
 * as requiring human approval. An unknown owner — "agent" included — is
 * rejected: the rehearsal records authority, it cannot grant it.
 *
 * Nothing is executed
 * -------------------
 * This module is pure. It does not import `node:child_process`, a
 * network client, or a Cloudflare binding, and every action says
 * `executedByRehearsal: false`. The commands below are recorded text;
 * running one remains an operator action. `runRollbackRehearsal()`
 * therefore reports zero executed commands, zero external requests and
 * zero credentials read by construction (the test pins the import list
 * to keep it that way).
 *
 * Duration and state
 * ------------------
 * The fixture is deeply frozen and the runner holds no mutable state, so
 * the same table produces the same result on every call. The clock is
 * never read; a rehearsal dated by "now" would make the recorded result
 * drift without the procedure changing.
 */

/** The canonical runbook. Citations are checked against this file. */
export const RUNBOOK_PATH = 'docs/runbook/cloudflare-workers-builds.md';

/** The release workflow document. */
export const RELEASE_PATH = 'docs/release.md';

/** The always-on delivery contract (release merge human gate). */
export const AGENTS_PATH = 'AGENTS.md';

/**
 * Decision owners. A decision may be made by the repository owner or by
 * the release operator acting on the documented procedure. `agent` is
 * deliberately absent: an agent may prepare evidence, never approve a
 * release operation (AGENTS.md §6).
 */
export const OWNER = Object.freeze({
	repositoryOwner: 'repository-owner',
	releaseOperator: 'release-operator',
});

const OWNER_VALUES = new Set(Object.values(OWNER));

/** Human-readable owner labels used by the report. */
export const OWNER_LABEL = Object.freeze({
	[OWNER.repositoryOwner]: 'Repository owner',
	[OWNER.releaseOperator]: 'Release operator',
});

/** What a recorded step is. */
export const ACTION_KIND = Object.freeze({
	operatorCommand: 'operator-command',
	ownerProcedure: 'owner-procedure',
	humanGate: 'human-gate',
	stop: 'stop',
});

const ACTION_KIND_VALUES = new Set(Object.values(ACTION_KIND));

/** What a recorded action would change if an operator executed it. */
export const MUTATION = Object.freeze({
	none: 'none',
	workerBinding: 'worker-binding',
	repository: 'repository',
	releaseMerge: 'release-merge',
	productionDeploy: 'production-deploy',
	d1: 'd1',
});

const MUTATION_VALUES = new Set(Object.values(MUTATION));

/** The three failure classes the Issue asks the rehearsal to walk. */
export const FAILURE_CLASS = Object.freeze({
	failedBuild: 'failed-build',
	failedSmoke: 'failed-smoke',
	postDeployRegression: 'post-deploy-regression',
});

const FAILURE_CLASS_VALUES = new Set(Object.values(FAILURE_CLASS));

/** The decision each rehearsed path converges on. */
export const OUTCOME = Object.freeze({
	noDeploy: 'no-deploy',
	releaseBlocked: 'release-blocked',
	operatorRestore: 'operator-restore',
	canonicalPatchRelease: 'canonical-patch-release',
});

const OUTCOME_VALUES = new Set(Object.values(OUTCOME));

/** Stable error codes. A message never carries user- or secret-shaped text. */
export const ERROR_CODE = Object.freeze({
	pathsMissing: 'paths_missing',
	pathInvalid: 'path_invalid',
	pathIdMissing: 'path_id_missing',
	pathIdDuplicate: 'path_id_duplicate',
	titleMissing: 'title_missing',
	failureClassInvalid: 'failure_class_invalid',
	failureClassMissing: 'failure_class_missing',
	triggerMissing: 'trigger_missing',
	triggerObservationMissing: 'trigger_observation_missing',
	triggerSourceMissing: 'trigger_source_missing',
	decisionMissing: 'decision_missing',
	decisionQuestionMissing: 'decision_question_missing',
	decisionRuleMissing: 'decision_rule_missing',
	decisionOwnerMissing: 'decision_owner_missing',
	decisionOwnerInvalid: 'decision_owner_invalid',
	decisionAuthorityMissing: 'decision_authority_missing',
	outcomeInvalid: 'outcome_invalid',
	notReversibleMissing: 'not_reversible_missing',
	stepsMissing: 'steps_missing',
	stepInvalid: 'step_invalid',
	stepIdMissing: 'step_id_missing',
	stepIdDuplicate: 'step_id_duplicate',
	ownerMissing: 'owner_missing',
	ownerInvalid: 'owner_invalid',
	observationMissing: 'observation_missing',
	authorityMissing: 'authority_missing',
	actionMissing: 'action_missing',
	actionKindInvalid: 'action_kind_invalid',
	actionNotForbidden: 'execution_not_forbidden',
	actionCommandMissing: 'action_command_missing',
	actionProcedureMissing: 'action_procedure_missing',
	actionSummaryMissing: 'action_summary_missing',
	actionMutationInvalid: 'action_mutation_invalid',
	humanGateNotOwner: 'human_gate_not_owner',
	mutationNotOwnerGated: 'mutation_not_owner_gated',
});

/** Deep-freeze a JSON-shaped fixture so no caller can mutate the record. */
function deepFreeze(value) {
	if (value === null || typeof value !== 'object') return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}

/** A citation into a repository document. The test resolves the heading. */
function cite(file, heading) {
	return { file, heading };
}

/**
 * The rehearsal table.
 *
 * Every `command` below is quoted from the canonical runbook or names a
 * real repository script; the test asserts the anchor exists in the
 * cited document. None is executed here.
 */
export const REHEARSAL_PATHS = deepFreeze([
	{
		id: 'failed-build',
		title: 'Workers Builds build phase fails before deploy',
		failureClass: FAILURE_CLASS.failedBuild,
		trigger: {
			observation: 'Cloudflare Workers Builds reports the build command as failed.',
			description:
				'The build command (`pnpm run build`) fails in the Workers Builds environment. The deploy command never runs because the deploy phase consumes the Build Output the build phase must produce.',
			source: cite(RUNBOOK_PATH, '### Build / Deploy phase contract (Issue #247)'),
		},
		decisionPoint: {
			question:
				'Did the failure occur in the build phase, before any Build Output was consumed by the deploy phase?',
			rule: 'A build-phase failure means no production state changed. Diagnose with the repository helper and fix forward. Do not use the Cloudflare Dashboard or browser automation, and do not substitute a local deploy.',
			owner: OWNER.releaseOperator,
			authority: cite(RUNBOOK_PATH, '## Diagnosing a failed build (Issue #247)'),
		},
		steps: [
			{
				id: 'resolve-failed-build',
				owner: OWNER.releaseOperator,
				authority: cite(RUNBOOK_PATH, '## Diagnosing a failed build (Issue #247)'),
				action: {
					kind: ACTION_KIND.operatorCommand,
					command:
						'infisical run --env dev --path / -- node scripts/cf-build-status.mjs <commit-sha|build-uuid>',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The report names the build status, the failing stage, the first error line and the exit code, and says the deploy phase did not run.',
			},
			{
				id: 'fix-forward',
				owner: OWNER.repositoryOwner,
				authority: cite(RUNBOOK_PATH, '## Production deploy authority'),
				action: {
					kind: ACTION_KIND.ownerProcedure,
					procedure: [
						'Fix the build failure on the ticket branch.',
						'Land the fix through the canonical release flow.',
						'Let the push to `main` trigger Cloudflare Workers Builds again.',
					],
					mutates: MUTATION.repository,
					requiresHumanApproval: true,
					executedByRehearsal: false,
				},
				observation:
					'A new Workers Builds run starts from the corrected `main` commit; the failed run remains in build history.',
			},
			{
				id: 'refuse-local-deploy-substitute',
				owner: OWNER.repositoryOwner,
				authority: cite(RUNBOOK_PATH, '## Production deploy authority'),
				action: {
					kind: ACTION_KIND.stop,
					summary:
						'Do not run `pnpm run deploy:production:prepared` as a substitute for the canonical path. It is a recovery / debugging fallback owned by the repository owner, not a release path.',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'No local deploy command is invoked and production stays on the last successful Workers Builds deployment.',
			},
		],
		notReversible: [
			'The failed build log and its exit status remain in Cloudflare build history.',
			'No Worker version, D1 migration or secret binding changed, so there is no production state to roll back.',
		],
		outcome: OUTCOME.noDeploy,
	},
	{
		id: 'failed-smoke-pre-merge',
		title: 'Transition smoke fails before the release PR merges',
		failureClass: FAILURE_CLASS.failedSmoke,
		trigger: {
			observation:
				'`pnpm run e2e:prod:transition` exits non-zero while the legacy runtime is still active.',
			description:
				'Smoke #1 runs before the release PR merges. The versioned binding is present and inert; the legacy binding keeps serving the current `main` runtime.',
			source: cite(
				RUNBOOK_PATH,
				'## Canonical production release sequence (ADR-0015 §9 + Issue #124)',
			),
		},
		decisionPoint: {
			question:
				'Is the failure a transition / binding failure, or a legacy-auth / session failure?',
			rule: 'A transition / binding failure uses `--rollback-versioned-only`. A legacy-auth / session failure does not merge the release PR and does not treat the rollback as a repair for the legacy signing secret. Either way the release merge remains owner-only.',
			owner: OWNER.releaseOperator,
			authority: cite(RUNBOOK_PATH, '## Recovery operations (Phase B driver)'),
		},
		steps: [
			{
				id: 'observe-transition-smoke',
				owner: OWNER.releaseOperator,
				authority: cite(RUNBOOK_PATH, '## Smoke boundary semantics'),
				action: {
					kind: ACTION_KIND.operatorCommand,
					command: 'pnpm run e2e:prod:transition',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The failing route, its absolute URL and the failing assertion are named; the run did not leave the origin it was pointed at.',
			},
			{
				id: 'confirm-binding-state',
				owner: OWNER.releaseOperator,
				authority: cite(RUNBOOK_PATH, '## Source-controlled contract vs live Worker state'),
				action: {
					kind: ACTION_KIND.operatorCommand,
					command: 'pnpm exec wrangler secret list --format json -c wrangler.production.jsonc',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The command returns binding NAMES only. Both the legacy and versioned bindings are present, and no secret value is printed.',
			},
			{
				id: 'rollback-versioned-binding',
				owner: OWNER.repositoryOwner,
				authority: cite(RUNBOOK_PATH, '## Recovery operations (Phase B driver)'),
				action: {
					kind: ACTION_KIND.operatorCommand,
					command: 'node scripts/phase-3-plus-prod-flip.mjs --execute --rollback-versioned-only',
					mutates: MUTATION.workerBinding,
					requiresHumanApproval: true,
					executedByRehearsal: false,
				},
				observation:
					'The versioned `BETTER_AUTH_SECRETS` binding is removed from the Worker, the legacy binding remains readable, and Infisical `prod` is unchanged.',
			},
			{
				id: 'legacy-auth-failure-branch',
				owner: OWNER.repositoryOwner,
				authority: cite(
					RUNBOOK_PATH,
					'## Canonical production release sequence (ADR-0015 §9 + Issue #124)',
				),
				action: {
					kind: ACTION_KIND.stop,
					summary:
						'If the failure is legacy-auth / session, do not merge the release PR. `--rollback-versioned-only` can remove the inert binding but does not repair a broken legacy signing secret.',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The release PR stays unmerged and the incident is investigated on the legacy auth path.',
			},
			{
				id: 'release-merge-human-gate',
				owner: OWNER.repositoryOwner,
				authority: cite(AGENTS_PATH, '## 6. Sprint workflow'),
				action: {
					kind: ACTION_KIND.humanGate,
					summary:
						'Release PR merge, release tag, GitHub Release publication and every production deploy stay owner-only.',
					mutates: MUTATION.releaseMerge,
					requiresHumanApproval: true,
					executedByRehearsal: false,
				},
				observation:
					'`main` is unchanged, no tag is pushed and Workers Builds is not triggered while the smoke is red.',
			},
		],
		notReversible: [
			'The failed smoke run and its report remain in the record; the failed release attempt is not erased.',
			'Removing the inert versioned binding is reversible only through another explicit owner operation; the rehearsal does not perform it.',
			'No release merge happened on this path, so `main` history and release tags are unchanged.',
		],
		outcome: OUTCOME.releaseBlocked,
	},
	{
		id: 'failed-smoke-post-deploy',
		title: 'Post-deploy smoke fails after the Worker has shipped',
		failureClass: FAILURE_CLASS.failedSmoke,
		trigger: {
			observation:
				'`pnpm run e2e:prod` exits non-zero, or the operator sign-in step fails after the deploy.',
			description:
				'Smoke #2 (automated) or Smoke #3 (operator manual sign-in) fails after Workers Builds deployed the release commit. The release window is not complete.',
			source: cite(
				RUNBOOK_PATH,
				'## Canonical production release sequence (ADR-0015 §9 + Issue #124)',
			),
		},
		decisionPoint: {
			question:
				'Has `--delete-legacy-only` already run, and does the failure involve the versioned runtime?',
			rule: 'While the smoke is red, do not delete the legacy binding: it is the documented fallback. If the legacy binding was already deleted and Smoke #3 failed, restore it. The Phase B lifecycle stays open until a smoke passes.',
			owner: OWNER.repositoryOwner,
			authority: cite(RUNBOOK_PATH, '## Recovery operations (Phase B driver)'),
		},
		steps: [
			{
				id: 'observe-post-deploy-smoke',
				owner: OWNER.releaseOperator,
				authority: cite(RUNBOOK_PATH, '## Smoke boundary semantics'),
				action: {
					kind: ACTION_KIND.operatorCommand,
					command: 'pnpm run e2e:prod',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The failing representative route and assertion are named on the canonical origin; the deployed commit is identified.',
			},
			{
				id: 'confirm-both-bindings',
				owner: OWNER.releaseOperator,
				authority: cite(RUNBOOK_PATH, '## Source-controlled contract vs live Worker state'),
				action: {
					kind: ACTION_KIND.operatorCommand,
					command: 'pnpm exec wrangler secret list --format json -c wrangler.production.jsonc',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The binding NAMES show whether the legacy fallback is still bound. No secret value is printed.',
			},
			{
				id: 'do-not-delete-legacy',
				owner: OWNER.repositoryOwner,
				authority: cite(
					RUNBOOK_PATH,
					'## Canonical production release sequence (ADR-0015 §9 + Issue #124)',
				),
				action: {
					kind: ACTION_KIND.stop,
					summary:
						'Do not run `--execute --delete-legacy-only` while the post-deploy smoke is red. The legacy binding is the documented fallback and the Phase B lifecycle is not complete.',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The legacy binding remains bound, the Phase B lifecycle stays open and the release window is not declared complete.',
			},
			{
				id: 'restore-legacy-binding',
				owner: OWNER.repositoryOwner,
				authority: cite(RUNBOOK_PATH, '## Recovery operations (Phase B driver)'),
				action: {
					kind: ACTION_KIND.operatorCommand,
					command: 'node scripts/phase-3-plus-prod-flip.mjs --execute --restore-legacy-only',
					mutates: MUTATION.workerBinding,
					requiresHumanApproval: true,
					executedByRehearsal: false,
				},
				observation:
					'After a `--delete-legacy-only` that already ran, the legacy binding is restored from the Infisical audit / recovery copy and the versioned binding remains present.',
			},
			{
				id: 'investigate-before-closing-lifecycle',
				owner: OWNER.releaseOperator,
				authority: cite(RUNBOOK_PATH, '## Smoke boundary semantics'),
				action: {
					kind: ACTION_KIND.ownerProcedure,
					procedure: [
						'Keep the Phase B lifecycle open until a smoke passes.',
						'Record the failing surface and the deployed commit in the incident notes.',
						'Decide with the repository owner whether the next action is a fix-forward release or a further recovery operation.',
					],
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The incident notes name the failing surface, the deployed commit and the binding state, with no credential or personal data.',
			},
		],
		notReversible: [
			'The release commit is already deployed; rolling a secret binding back does not un-ship the Worker version or the `main` commit.',
			'D1 migrations applied by the deploy command are already applied and are not reversed by a binding operation.',
			'If `--delete-legacy-only` ran, restoring the binding depends on the Infisical audit / recovery copy; the deletion itself remains in the operation record.',
		],
		outcome: OUTCOME.operatorRestore,
	},
	{
		id: 'post-deploy-regression',
		title: 'Visitor-facing regression observed after the deploy window',
		failureClass: FAILURE_CLASS.postDeployRegression,
		trigger: {
			observation: 'A visitor-facing regression is reported after the smoke window has closed.',
			description:
				'The release is live and no smoke step is currently failing. The regression is a product or runtime defect discovered in production.',
			source: cite(RELEASE_PATH, '## Patch releases'),
		},
		decisionPoint: {
			question:
				'Is the regression repaired by the canonical patch-release path, or is it a binding-only failure on the documented recovery path?',
			rule: 'Do not push directly to `main`, do not tag, and do not run a local production deploy. Repair the regression through a patch release, or use the documented binding recovery operation when the failure is that operation’s exact failure class.',
			owner: OWNER.repositoryOwner,
			authority: cite(RELEASE_PATH, '## Patch releases'),
		},
		steps: [
			{
				id: 'record-regression',
				owner: OWNER.releaseOperator,
				authority: cite(RELEASE_PATH, '## Patch releases'),
				action: {
					kind: ACTION_KIND.ownerProcedure,
					procedure: [
						'Record the affected route or surface and the deployed source commit.',
						'Keep the record status-only: no credential, no visitor identifier, no third-party personal data.',
					],
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The incident record names the affected surface and the deployed commit, and contains no secret or personal data.',
			},
			{
				id: 'no-agent-rollback',
				owner: OWNER.repositoryOwner,
				authority: cite(AGENTS_PATH, '## 6. Sprint workflow'),
				action: {
					kind: ACTION_KIND.stop,
					summary:
						'No agent rollback and no agent deploy: no direct `main` push, no release tag, no GitHub Release, no local production deploy.',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'`main`, tags, the GitHub Release and Cloudflare deploy history are untouched by the rehearsal or an agent.',
			},
			{
				id: 'canonical-patch-release',
				owner: OWNER.repositoryOwner,
				authority: cite(RELEASE_PATH, '## Patch releases'),
				action: {
					kind: ACTION_KIND.ownerProcedure,
					procedure: [
						'Create `release-x-y-z` from the current `main`.',
						'Land the fix in a normal ticket PR against the release branch.',
						'Open the release PR and stop for explicit repository-owner approval.',
						'After approval, merge the release PR and let Cloudflare Workers Builds deploy the push to `main`.',
						'Run the post-deploy smoke against the canonical origin.',
					],
					mutates: MUTATION.repository,
					requiresHumanApproval: true,
					executedByRehearsal: false,
				},
				observation:
					'A new Workers Builds deployment is produced from the canonical path and the post-deploy smoke is green.',
			},
			{
				id: 'binding-only-recovery',
				owner: OWNER.repositoryOwner,
				authority: cite(RUNBOOK_PATH, '## Recovery operations (Phase B driver)'),
				action: {
					kind: ACTION_KIND.stop,
					summary:
						'If, and only if, the regression matches the documented post-`delete-legacy-only` failure class, use `--execute --restore-legacy-only` as recorded in the post-deploy smoke path. That is a recovery operation, not a code rollback.',
					mutates: MUTATION.none,
					executedByRehearsal: false,
				},
				observation:
					'The recovery operation is not used as a generic code rollback, and the patch release remains the path for a code defect.',
			},
		],
		notReversible: [
			'Production served the regression for the observation window; the visitor impact is not undone by the repair.',
			'The release commit, its merge history and any release tag remain published.',
			'D1 migrations already applied stay applied; the patch release repairs forward rather than restoring a previous schema.',
			'Cloudflare deployment history keeps the regressing version; the fix-forward deployment is a new record, not an erasure.',
		],
		outcome: OUTCOME.canonicalPatchRelease,
	},
]);

function isNonEmptyString(value) {
	return typeof value === 'string' && value.trim().length > 0;
}

function isCitation(value) {
	return Boolean(value) && isNonEmptyString(value.file) && isNonEmptyString(value.heading);
}

function isOwner(value) {
	return isNonEmptyString(value) && OWNER_VALUES.has(value);
}

function isFailureClass(value) {
	return isNonEmptyString(value) && FAILURE_CLASS_VALUES.has(value);
}

function isOutcome(value) {
	return isNonEmptyString(value) && OUTCOME_VALUES.has(value);
}

function isActionKind(value) {
	return isNonEmptyString(value) && ACTION_KIND_VALUES.has(value);
}

function isMutation(value) {
	return isNonEmptyString(value) && MUTATION_VALUES.has(value);
}

function isNonEmptyStringArray(value) {
	return (
		Array.isArray(value) && value.length > 0 && value.every((entry) => isNonEmptyString(entry))
	);
}

function recordError(errors, { pathId = null, stepId = null, code, message }) {
	errors.push({ pathId, stepId, code, message });
}

/**
 * Validate the rehearsal table.
 *
 * Everything is decided from the fixture itself, so a step that lost its
 * owner or observation in an edit is caught here rather than rendered as
 * a silent blank. The return value is always `{ ok, errors }`; callers
 * must check `ok` before presenting a PASS.
 */
export function validateRehearsal(paths = REHEARSAL_PATHS) {
	const errors = [];

	if (!Array.isArray(paths) || paths.length === 0) {
		recordError(errors, {
			code: ERROR_CODE.pathsMissing,
			message: 'the rehearsal table has no paths',
		});
		return { ok: false, errors, pathCount: 0, stepCount: 0 };
	}

	const seenPathIds = new Set();
	const seenFailureClasses = new Set();
	let stepCount = 0;

	for (const [pathIndex, path] of paths.entries()) {
		const pathId = isNonEmptyString(path?.id) ? path.id : `#${pathIndex}`;
		if (!path || typeof path !== 'object' || Array.isArray(path)) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.pathInvalid,
				message: 'path entry is not an object',
			});
			continue;
		}

		if (!isNonEmptyString(path.id)) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.pathIdMissing,
				message: 'path has no id',
			});
		} else if (seenPathIds.has(path.id)) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.pathIdDuplicate,
				message: 'path id is duplicated',
			});
		} else {
			seenPathIds.add(path.id);
		}

		if (!isNonEmptyString(path.title)) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.titleMissing,
				message: 'path has no title',
			});
		}

		if (!isFailureClass(path.failureClass)) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.failureClassInvalid,
				message: 'path failure class is not one of the rehearsed classes',
			});
		} else {
			seenFailureClasses.add(path.failureClass);
		}

		if (!path.trigger || typeof path.trigger !== 'object') {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.triggerMissing,
				message: 'path has no trigger',
			});
		} else {
			if (!isNonEmptyString(path.trigger.observation)) {
				recordError(errors, {
					pathId,
					code: ERROR_CODE.triggerObservationMissing,
					message: 'trigger has no observation',
				});
			}
			if (!isCitation(path.trigger.source)) {
				recordError(errors, {
					pathId,
					code: ERROR_CODE.triggerSourceMissing,
					message: 'trigger has no document citation',
				});
			}
		}

		if (!path.decisionPoint || typeof path.decisionPoint !== 'object') {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.decisionMissing,
				message: 'path has no decision point',
			});
		} else {
			if (!isNonEmptyString(path.decisionPoint.question)) {
				recordError(errors, {
					pathId,
					code: ERROR_CODE.decisionQuestionMissing,
					message: 'decision point has no question',
				});
			}
			if (!isNonEmptyString(path.decisionPoint.rule)) {
				recordError(errors, {
					pathId,
					code: ERROR_CODE.decisionRuleMissing,
					message: 'decision point has no deciding rule',
				});
			}
			if (!isNonEmptyString(path.decisionPoint.owner)) {
				recordError(errors, {
					pathId,
					code: ERROR_CODE.decisionOwnerMissing,
					message: 'decision point has no owner',
				});
			} else if (!isOwner(path.decisionPoint.owner)) {
				recordError(errors, {
					pathId,
					code: ERROR_CODE.decisionOwnerInvalid,
					message: 'decision point owner is not an authorised human owner',
				});
			}
			if (!isCitation(path.decisionPoint.authority)) {
				recordError(errors, {
					pathId,
					code: ERROR_CODE.decisionAuthorityMissing,
					message: 'decision point has no authority citation',
				});
			}
		}

		if (!isOutcome(path.outcome)) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.outcomeInvalid,
				message: 'path has no rehearsed outcome',
			});
		}

		if (!isNonEmptyStringArray(path.notReversible)) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.notReversibleMissing,
				message: 'path does not record what is not reversible',
			});
		}

		if (!Array.isArray(path.steps) || path.steps.length === 0) {
			recordError(errors, {
				pathId,
				code: ERROR_CODE.stepsMissing,
				message: 'path has no steps',
			});
			continue;
		}

		const seenStepIds = new Set();
		for (const [stepIndex, step] of path.steps.entries()) {
			const stepId = isNonEmptyString(step?.id) ? step.id : `#${stepIndex}`;
			stepCount += 1;

			if (!step || typeof step !== 'object' || Array.isArray(step)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.stepInvalid,
					message: 'step entry is not an object',
				});
				continue;
			}

			if (!isNonEmptyString(step.id)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.stepIdMissing,
					message: 'step has no id',
				});
			} else if (seenStepIds.has(step.id)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.stepIdDuplicate,
					message: 'step id is duplicated inside the path',
				});
			} else {
				seenStepIds.add(step.id);
			}

			if (!isNonEmptyString(step.owner)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.ownerMissing,
					message: 'step has no owner',
				});
			} else if (!isOwner(step.owner)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.ownerInvalid,
					message: 'step owner is not an authorised human owner',
				});
			}

			if (!isNonEmptyString(step.observation)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.observationMissing,
					message: 'step has no expected observation',
				});
			}

			if (!isCitation(step.authority)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.authorityMissing,
					message: 'step has no authority citation',
				});
			}

			const action = step.action;
			if (!action || typeof action !== 'object' || Array.isArray(action)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.actionMissing,
					message: 'step has no action',
				});
				continue;
			}

			if (!isActionKind(action.kind)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.actionKindInvalid,
					message: 'action kind is not in the closed vocabulary',
				});
			}

			if (action.executedByRehearsal !== false) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.actionNotForbidden,
					message: 'action must be recorded with executedByRehearsal: false',
				});
			}

			if (!isMutation(action.mutates)) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.actionMutationInvalid,
					message: 'action does not declare what it mutates',
				});
			}

			switch (action.kind) {
				case ACTION_KIND.operatorCommand:
					if (!isNonEmptyString(action.command)) {
						recordError(errors, {
							pathId,
							stepId,
							code: ERROR_CODE.actionCommandMissing,
							message: 'operator command step has no command',
						});
					}
					break;
				case ACTION_KIND.ownerProcedure:
					if (!isNonEmptyStringArray(action.procedure)) {
						recordError(errors, {
							pathId,
							stepId,
							code: ERROR_CODE.actionProcedureMissing,
							message: 'owner procedure step has no procedure',
						});
					}
					break;
				case ACTION_KIND.humanGate:
					if (step.owner !== OWNER.repositoryOwner) {
						recordError(errors, {
							pathId,
							stepId,
							code: ERROR_CODE.humanGateNotOwner,
							message: 'human gate step must be owned by the repository owner',
						});
					}
					if (action.requiresHumanApproval !== true) {
						recordError(errors, {
							pathId,
							stepId,
							code: ERROR_CODE.humanGateNotOwner,
							message: 'human gate step must require explicit human approval',
						});
					}
					break;
				case ACTION_KIND.stop:
					if (!isNonEmptyString(action.summary)) {
						recordError(errors, {
							pathId,
							stepId,
							code: ERROR_CODE.actionSummaryMissing,
							message: 'stop step has no summary',
						});
					}
					break;
				default:
					break;
			}

			if (
				isMutation(action.mutates) &&
				action.mutates !== MUTATION.none &&
				(step.owner !== OWNER.repositoryOwner || action.requiresHumanApproval !== true)
			) {
				recordError(errors, {
					pathId,
					stepId,
					code: ERROR_CODE.mutationNotOwnerGated,
					message:
						'a mutating step must be owned by the repository owner and require explicit human approval',
				});
			}
		}
	}

	for (const failureClass of FAILURE_CLASS_VALUES) {
		if (!seenFailureClasses.has(failureClass)) {
			recordError(errors, {
				code: ERROR_CODE.failureClassMissing,
				message: `the rehearsal does not walk the "${failureClass}" failure class`,
			});
		}
	}

	return { ok: errors.length === 0, errors, pathCount: paths.length, stepCount };
}

/**
 * Run the rehearsal and project the recorded table into a result.
 *
 * This is a table-driven rehearsal, not a deploy simulator: the paths
 * are checked for completeness and projected for the report. It never
 * executes a recorded command. An invalid table returns `ok: false` and
 * no paths, so a caller cannot print a partial result as a PASS.
 */
export function runRollbackRehearsal(paths = REHEARSAL_PATHS) {
	const validation = validateRehearsal(paths);

	if (!validation.ok) {
		return {
			issue: '#503',
			ok: false,
			paths: [],
			summary: {
				pathCount: 0,
				stepCount: 0,
				executedCommands: 0,
				externalRequests: 0,
				credentialsRead: 0,
				ownerGatedSteps: 0,
				humanGateSteps: 0,
				readOnlySteps: 0,
				outcomes: [],
				failureClasses: [],
			},
			errors: validation.errors,
		};
	}

	const projected = paths.map((path) => ({
		id: path.id,
		title: path.title,
		failureClass: path.failureClass,
		outcome: path.outcome,
		trigger: path.trigger,
		decisionPoint: path.decisionPoint,
		steps: path.steps.map((step) => ({
			...step,
			status: 'recorded',
		})),
		notReversible: path.notReversible,
	}));

	const allSteps = projected.flatMap((path) => path.steps);

	return {
		issue: '#503',
		ok: true,
		paths: projected,
		summary: {
			pathCount: projected.length,
			stepCount: allSteps.length,
			executedCommands: 0,
			externalRequests: 0,
			credentialsRead: 0,
			ownerGatedSteps: allSteps.filter((step) => step.action.requiresHumanApproval === true).length,
			humanGateSteps: allSteps.filter((step) => step.action.kind === ACTION_KIND.humanGate).length,
			readOnlySteps: allSteps.filter((step) => step.action.mutates === MUTATION.none).length,
			outcomes: projected.map((path) => path.outcome),
			failureClasses: [...new Set(projected.map((path) => path.failureClass))],
		},
		errors: [],
	};
}

/** Status-only lines: codes and counts, never a fixture value that could be secret. */
export function formatRollbackRehearsal(result) {
	const lines = [
		`rollback rehearsal (${result.issue}): ${result.ok ? 'PASS' : 'FAIL'}`,
		`paths: ${result.summary.pathCount}, steps: ${result.summary.stepCount}`,
		`executed commands: ${result.summary.executedCommands}, external requests: ${result.summary.externalRequests}, credentials read: ${result.summary.credentialsRead}`,
		`owner-gated steps: ${result.summary.ownerGatedSteps}, human gates: ${result.summary.humanGateSteps}`,
	];
	for (const path of result.paths) {
		lines.push(`PASS ${path.id}: ${path.outcome} (${path.steps.length} steps)`);
	}
	for (const error of result.errors) {
		const location = [error.pathId, error.stepId].filter(Boolean).join('/');
		lines.push(`ERROR ${error.code}${location ? ` at ${location}` : ''}: ${error.message}`);
	}
	return lines;
}

/**
 * Sensitive-value detectors applied to this repository's own output.
 *
 * The rehearsal is an internal fixture, but it is committed and
 * screenshotted, so the guard refuses an e-mail address, a bearer token,
 * a private-key block, an AWS access key id or a `password=`/`token=`
 * assignment. Only the detector id and line number are returned, never
 * the matched text.
 */
const SENSITIVE_DETECTORS = Object.freeze([
	{ id: 'email', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
	{ id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/ },
	{ id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{
		id: 'secret-assignment',
		pattern: /\b(?:password|secret|token|api[_-]?key)\s*=\s*["']?[A-Za-z0-9_\-./+=]{8,}/i,
	},
]);

/** Return findings as `{ detectorId, line }`, never the matched text. */
export function findSensitiveInText(text) {
	const findings = [];
	const lines = String(text).split('\n');
	for (const [index, line] of lines.entries()) {
		for (const detector of SENSITIVE_DETECTORS) {
			if (detector.pattern.test(line)) {
				findings.push({ detectorId: detector.id, line: index + 1 });
			}
		}
	}
	return findings;
}

/** Mechanical guard for a rendered artefact or a fixture dump. */
export function assertNoSensitiveInText(text) {
	const findings = findSensitiveInText(text);
	return { ok: findings.length === 0, findings };
}
