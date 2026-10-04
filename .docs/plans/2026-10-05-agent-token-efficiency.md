# Plan: reduce agent token usage without reducing verification

Date: 2026-10-05

Status: In progress; baseline audited, concise help and skill/README implemented; fresh comparative evals pending

Scope: test CLI, bundled skill, documentation, and comparative agent evals

## Outcome

Make the ordinary agent workflow easy to discover and cheaper in total tokens than the screenshot loop for tasks the host supports, while preserving task completion and defect detection. Measure the whole task, including setup, test authoring, repairs, launch verification, and final reporting. Short CLI output alone does not establish a cheaper workflow.

The reported real evals contradict the expected token savings. Treat that as a product problem to investigate, rather than dismissing it as agent misuse. Start with the confirmed help and guidance problems; use fresh evals to decide whether further output or API changes are necessary.

## Evidence and limits

| Finding | Evidence | Confidence / implication |
| --- | --- | --- |
| A printed about 7.6k characters of Vitest help. A-hard printed help plus README, about 14.6k characters, then a JSON schema. | User-supplied eval summary in this conversation; raw traces not yet available. | Reported observations, not independently audited token counts. |
| A reran the same file five times. | User-supplied eval summary. | Audit intervening edits and failures before classifying individual runs as unnecessary. |
| `test --help` exposes the underlying runner's full help. | Locally reproduced against source and existing built CLI: 77 stdout lines, 10,356 bytes, Vitest 5.0.3. Built CLI stderr was empty. | Confirmed in this checkout; differs from the reported eval's character count. |
| Test dispatch bypasses Commander's help. | [`cli.ts`](../../packages/react-native-a11y-tree/src/cli.ts) dispatches a leading `test` directly to `runTests`; [`testingCommand.ts`](../../packages/react-native-a11y-tree/src/testingCommand.ts) forwards arguments and inherits stdio. | A Commander help description alone will not fix the observed path. |
| Guidance encourages broad discovery and repeated runs. | [`SKILL.md`](../../packages/react-native-a11y-tree/skill/SKILL.md): “after changes until it passes”; examples for `render`, `run`, and `check`; no explicit file-first completion rule. | Confirmed wording; causal impact needs an eval. |
| Reading all reference material is expensive. | Current skill: 4,943 bytes / 55 lines. Root README: 94,637 bytes / 1,614 lines. | Byte counts, not model token counts. The size of a full file is not proof an eval consumed all of it. |
| Several diagnostics are already bounded. | [`testing.ts`](../../packages/react-native-a11y-tree/src/testing.ts) caps query-error tree excerpts at 2,000 characters and matcher excerpts at 1,000; `screen.debug()` prints the full compact tree. | Do not assume every failure prints an unbounded tree. Investigate actual transcripts first. |
| Output still uses Vitest's default reporter. | [`testingConfig.ts`](../../packages/react-native-a11y-tree/src/testingConfig.ts), with inherited child stdio. | Measure passing, failing, no-match, and infrastructure-error output before changing reporters. |

Local reproduction: `node packages/react-native-a11y-tree/dist/rn-a11y-tree.js test --help`, with stdout redirected to a temporary file and measured instead of pasted. Source reproduction required `--experimental-strip-types` on the local Node 22.14.0. The existing build was not rebuilt for this planning task.

The older [`agent-friendliness.md`](../agent-friendliness.md) and [`perf-analysis.md`](../perf-analysis.md) provide historical output and latency context. They are not a current end-to-end token comparison. The implementation phase located raw traces under `~/a11y-eval/runs/`; the [baseline audit and local measurements](../validation/2026-10-05-agent-tokens/README.md) record what was independently checked.

### Supplied comparison report

The user supplied this report while the plan was being drafted. All figures below are reported, not recomputed from traces. A/A-hard are interpreted as tool conditions and B as the screenshot condition from the conversation; the exact condition definitions still need confirmation from the eval configuration.

| Run | Finished | Reported tokens | Cost | Time outside build | Tests (report label) | Simulator calls |
| --- | --- | --- | --- | --- | --- | --- |
| A r6-1 | No | 15.8M | $1.73 | 61 min | 7, last passed | 18 |
| B r6-1 | No | 13.4M | $1.34 | 61 min | 0 | 29 |
| A-hard r6-1 | Yes | 20.2M | $2.70 | 12 min | 6, last passed | 12 |
| B r6-2 | Yes | 11.3M | $0.66 | 28 min | 0 | 47 |

The two unfinished r6-1 runs show about 18% more reported tokens and 29% more cost for A at the same reported time. Among the finished runs, A-hard used about 79% more reported tokens and 4.1 times the cost, despite about 57% less time outside the build and 74% fewer simulator calls. These are descriptive comparisons, not controlled estimates: A-hard and B use different run labels, and task difficulty, settings, build exclusion, and cache accounting are unknown.

This establishes the problem to investigate: faster completion and fewer simulator calls did not produce lower reported token usage or cost in these observations. Both unfinished runs must remain visible in the analysis. A's final passing test did not establish task completion. Clarify whether the report's “Tests” column counts invocations, test cases, or another unit; do not equate it with the separately reported five runs of one file.

## Proposed workflow contract

Recommended default: `test <file>` for implementation and regression work, because assertions provide repeatable verification and an explicit completion signal. Use `render` for one-time inspection, `run` for one-time interaction probes or existing scripts, and `check` for rule audits. Avoid treating these as a mandatory sequence. A small inspection task should not require writing a test. This is a workflow recommendation; which condition is cheapest still needs the comparative eval below.

Put the sufficient first-use instructions at the top of the skill, with one normal execution command:

```sh
rn-a11y-tree test a11y/notes.a11y.test.ts
```

1. Write explicit assertions for the requested flow using exports from `react-native-a11y-tree/test`. Include one minimal example and the essential query, action, and matcher names. Use `renderRoute` for routes and `render` for components; no separate runner configuration.
2. Run the affected file once. If it fails, fix the cause and rerun that file with `-t '^should submit a note$'`, using a pattern that uniquely matches the intended test. Vitest name filters are regular expressions and may match multiple tests; verify the executed count. Escaping and full test names matter when using `describe`.
3. After repairs or subsequent relevant edits, run the whole affected file once at the end. If the first full run passed and nothing relevant changed afterward, it already satisfies this final check. Run other affected files when shared code changes require them.
4. A passing file closes only its asserted, host-supported flows at that source revision and configuration. Do not replay those same flows with screenshots for reassurance. For a behavior task with no visual or native requirement, take one launch screenshot; take another after repairing a launch error visible in the first. Inspect each unchanged PNG once. Persistent launch failures remain unresolved work, not a reason to declare success.
5. Perform additional simulator checks for requested visual changes and native behavior the host does not prove: keyboard, permissions, WebViews, maps, native navigation, animation, and restart persistence. Changes invalidate relevant previous verification. An explicit eval requirement for screenshots takes precedence.
6. During routine test authoring, do not run `--help`, `schema`, `render`, or `run`, or read the entire README. The skill should contain enough to proceed. Consult the relevant reference only for a concrete unsupported operation or diagnostic. `screen.debug()` is a deliberate diagnostic after existing failure context proves insufficient; remove temporary debug calls before final verification.
7. Keep required accessibility verification. If the task needs a default-rule screen audit beyond its assertions, run `check --rules default` once for each affected screen/configuration, and rerun after relevant fixes. Do not multiply the same audit across every flow.

Retain the existing warning against changing production UI merely to satisfy the host, fixture isolation, asynchronous-query guidance, and simulator coverage boundaries. Keep advanced command, fixture, and network reference material discoverable outside the short initial workflow. Routine agents should not need to load it all.

## Work sequence

### 1. Establish an attributable baseline

- Obtain the raw traces underlying the supplied four-run report, including task prompts, model/settings, package/skill revisions, evaluator results, usage records, the meaning of “Tests,” and why B r6-2 differs from B r6-1. If unavailable, create a new reproducible baseline and keep the supplied figures labeled as reported evidence.
- Classify help/README/schema discovery, skill loading, test authoring, runner output, failure diagnostics, repairs, duplicate runs, screenshots, image rereads, and final prose. Distinguish tool-generated output from agent-written commands/tests; both contribute to task cost.
- Record run arguments, executed tests, intervening source/test/config changes, exit status, and the reason for each repeat. Separate useful iterations from unchanged reruns.
- Measure output with artifacts and short summaries. Count bytes/characters separately from actual model tokens. Repeated text can increase cached prompt usage on later turns; do not count it as newly generated tool text each time. Report uncached input, cached input, output, and exposed reasoning usage separately, using the provider's accounting definitions to avoid double counting. Cost and token totals are distinct metrics.
- Capture default runner output for a green file, assertion failure, missing query, no file match, no name match, bundle failure, and unavailable host. This determines whether a reporter change is worth its compatibility cost.

Deliverable: a small trace attribution table and versioned baseline artifacts under `.docs/validation/`, with sensitive data excluded. Completed for the available six traces: token totals agree with saved metrics; discovery output and command counts are recorded separately from model usage. Marginal token attribution still requires controlled fresh runs.

### 2. Fix concise help at the CLI boundary

- Handle `test --help` and `test -h` before resolving or spawning Vitest. Print tool-owned help to stdout and exit 0; no runner, bundler, or host startup. Cover `help test` consistently and define behavior around the `--` delimiter and option values so literal values are not mistaken for help.
- Include file selection, the supported `.a11y.test.{ts,tsx,js,jsx}` convention, one `-t` example, a short statement that ordinary Vitest flags pass through, and runner exit semantics. No argument still discovers all configured matching files; do not turn that existing convenience into a usage error.
- Proposed output budget: at most 1,200 UTF-8 bytes / 20 lines. Confirm the text is sufficient in first-use evals rather than removing necessary guidance just to meet the budget.
- State 0 for runner success, 1 for runner failures/errors (including default no-file-match behavior), and 130 for SIGINT as implemented. Measured correction: zero name matches exit 0 with all tests skipped; teach agents to check executed counts. Distinguish wrapper usage errors and the separate `render`/`run`/`check` exit table. Preserve child statuses and signals.
- Preserve explicit reporter/output-file options. Do not add a new family of agent flags or a full-help command without demonstrated need; full reference can remain available on demand.
- Audit leading global options and `--no-stderr`: dispatch must not silently skip a test or advertise suppression the inherited child stdio cannot provide. Record existing issues separately if they require a broader fix.

Likely files: `src/cli.ts`, `src/testingCommand.ts`, focused CLI tests, and the root README. The build copies the root README into the published package; avoid maintaining conflicting instructions in both copies.

### 3. Shorten and clarify the shipped skill

- Replace the open-ended verification loop with the workflow contract above. Lead with an explicit file and a minimal working test; put native/visual completion criteria next to the stopping rule.
- Move advanced discovery material to a bundled reference if needed, preserving packaging. Set a provisional initial-skill budget of 3,000 UTF-8 bytes; test whether an unfamiliar agent can complete the task without additional discovery.
- Keep `rn-a11y-tree skill` as a print-only command: the agent reads its stdout once. Installation, path lookup, and installed-copy drift checks are removed. The revised entrypoint is 2,999 bytes versus 4,943 before (39.3% smaller); fresh usability evaluation remains pending.
- Update the root README's test quick start to match. Keep no-file suite discovery and advanced runner flags documented for humans and CI.
- Validate that `rn-a11y-tree skill` prints the bundled content exactly. Record its content hash and package revision in controlled eval setup; include the agent's one-time read in measured usage. Do not create an installed project skill or preload a second copy of the same guidance.

### 4. Evaluate the CLI and skill changes independently

Use five conditions: screenshot baseline; existing CLI + existing skill; concise CLI + existing skill; existing CLI + revised skill; concise CLI + revised skill. The four tool conditions isolate individual effects and interaction. Equalize access to task information; count all supplied guidance in usage.

- Start with A and A-hard, at least three fresh repetitions per condition as a pilot, with randomized condition order and fixed model/settings. That pilot detects obvious regressions; increase samples before claiming a reliable win. Agents start without prior trace context or carried-over help text.
- Use equivalent task acceptance criteria, independently score completed app behavior, and retain required visual/native checks in every condition. Keep test authoring and setup inside the measured task boundary. Report cold first use separately from warm repeated use; control bundle caches and the version/content of printed skill guidance.
- Add held-out tasks for forms, navigation, asynchronous data, an actual failing flow, a launch-only error, and native/visual requirements. Include a novice agent that naturally tries help; the CLI must remain usable without perfect compliance with the skill.
- Record total tokens and cost, median and tail usage, end-to-end wall time and time outside build separately, task success, defect detection, first-command success, discovery calls, full/filtered reruns, tests actually executed, simulator actions, and image reads. Keep incomplete/failed tasks in the results instead of reporting only cheap successes. Include cost per successful completion across all attempts; repeated failed attempts are part of the workflow's cost.
- Do not infer quality from green tests alone. Include known behavior faults, empty/misnamed files, and filters selecting zero tests; confirm that the agent detects missing coverage and unresolved native requirements.

Deliverable: a reproducible condition table plus per-task attribution, including uncertainty and task categories where screenshots remain necessary.

### 5. Add output changes only if remaining evidence justifies them

If runner banners, repeated passing names, or failure context remain a material share of task tokens, compare the existing supported reporters before building a custom one. A compact result should retain the file, failed test names, executed/passed/failed/skipped counts, useful assertion context, and exit status. Keep explicitly selected JSON/reporters intact.

If diagnostics dominate, study focused tree excerpts and explicit truncation indicators with access to fuller details on demand. Current error excerpts already have limits; blindly shortening them may cause more debug calls and higher total usage. Measure recovery success and total repair tokens.

Do not expand this plan into host caching, daemon architecture, transport changes, or query API redesign unless the attribution identifies a causal token problem there.

## Test plan

Implementation tests use BDD names beginning with lowercase `should`, grouped by functionality with a flat `describe` → `it` hierarchy.

| Area | Verification |
| --- | --- |
| Help | `test --help`, `test -h`, a file followed by help, and `help test` produce concise accurate help, stdout output, and status 0. Verify byte/line budget and no Vitest spawn/dependency lookup, Metro startup, or host resolution. Test operand/option-value handling and `--`. |
| Dispatch | Plain `test`, explicit files, `-t` before/after file filters, leading supported global flags, and malformed options run or fail explicitly. No path silently succeeds without executing tests. |
| Runner behavior | A green file returns 0; a failing assertion returns a failure status; absent file matches fail by default; deliberate opt-in runner overrides remain forwarded. Absent name matches retain Vitest's 0 status and skipped counts; ensure eval scoring requires executed assertions. |
| Compatibility | Reporter/output-file forwarding, errors, SIGINT/SIGTERM propagation and cleanup, and `--no-stderr` behavior retain their documented semantics. Reuse existing Router/name-filter E2E coverage. |
| Skill and package | Printing matches bundled content; removed installation/path/check options fail as usage errors; source and built CLI behavior agree. Any reference files survive packing. README copies agree after the normal build. |
| Agent usability | A fresh agent can write and execute a flow from the short skill. Failures prompt a targeted repair; unchanged green flows stop. Native/visual tasks retain required simulator checks. |
| Quality faults | Seed behavior faults, an empty or misnamed test file, a zero-match name filter, a launch error, and a native-only defect. Detect failures without weakening assertions or substituting production UI for fixtures. |

Run focused tests first, then the required repository checks once on the final implementation: typecheck, schema consistency, unit tests, relevant real-host E2E tests, and package/build verification. This workspace's `check` script runs typecheck, schema check, unit, and E2E; it has no separate lint script. Use CI's existing platform coverage for CLI/process portability. Manual agent evals verify stopping behavior that code tests cannot establish.

## Release gates and open questions

- Concise help meets its budget and remains sufficient for an unfamiliar agent; ordinary test execution, statuses, flags, and package behavior remain compatible.
- Combined CLI + skill changes reduce total task usage against the existing tool workflow. On host-supported tasks, aim for lower median total usage than the screenshot baseline, with no observed loss in task success or seeded-defect detection; inspect tails and uncertainty before making a general claim.
- Native/visual tasks are reported separately. A pilot too small to establish savings is inconclusive, not a pass. If savings do not appear, revisit attribution before adding more commands or stronger restrictions.
- Resolved locally: raw trace location and incremental accounting; reported test counts include help; no-name-match behavior; help now emits 643 bytes versus 10,356; skill is under 3 KB. Open: causal discovery/test-authoring overhead, fresh quality scoring, first-use skill usability, and end-to-end token savings. Small output probes do not justify a reporter change yet.

## Progress

- [x] Inspect current help dispatch, runner config, skill, docs, and relevant tests.
- [x] Reproduce and measure full-help output without dumping it into context.
- [x] Incorporate the supplied four-run comparison report and distinguish descriptive results from causal evidence.
- [x] Record command-selection guidance and the default verification/stopping loop in the bundled skill.
- [x] Simplify `skill` to print bundled guidance; remove installation, path, and drift-check options.
- [x] Write this fresh plan with hypotheses, implementation sequence, eval design, and test plan.
- [x] Obtain/audit raw eval evidence and establish a local command-output baseline.
- [x] Implement concise help and finish README/skill refinements.
- [x] Measure default and dot reporter output; retain default pending stronger evidence.
- [x] Verify implementation with typecheck/schema/build, unit tests, package/install checks, and 23 strict real-host flow E2E cases; record measured results and candidate/control provenance.
- [ ] Run comparative and held-out evals, then decide whether further output changes are justified.
- [ ] Update the external eval runner to printed guidance and immutable conditions, score quality, and verify end-to-end token savings before release claims.
