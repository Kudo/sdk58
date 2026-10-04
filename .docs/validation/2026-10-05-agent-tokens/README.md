# Agent token efficiency: baseline and first implementation

Date: 2026-10-05. This records local output measurements and an audit of existing eval traces. It is not a fresh comparison of agents using the revised tool against screenshots.

## Changes measured

`test --help`, `test -h`, and `help test` now print tool-owned help. No runner dependency lookup or child spawn is needed for this help. Leading `--no-stderr` dispatches tests correctly, and suppression applies to child stderr. File/name filters and explicit reporter/output-file options remain supported. Help-like name-filter values are passed with `=` so Vitest does not interpret them as help flags.

The skill defaults to file-first flow tests, targeted repair runs, and one final affected-file run. It distinguishes one-time `render`/`run` probes from implementation verification, checks executed counts, and retains launch/native/visual coverage. `skill` only prints its content.

| Surface | Before | After | Reduction |
| --- | --- | --- | --- |
| Test help stdout | 10,356 bytes / 77 lines | 643 bytes / 12 lines | 93.8% bytes |
| Initial skill content | 4,943 bytes | 2,999 bytes | 39.3% bytes |

These are byte reductions, not measured reductions in model tokens or task cost. Help before is reproduced with the exact forwarded Vitest command used by the previous wrapper. See [`cli-measurements.json`](cli-measurements.json) and the saved stdout/stderr artifacts.

## Runner output findings

Node 26.5.1 and Vitest 5.0.3, default versus built-in `dot` reporter:

| Case | Default bytes | Dot bytes | Exit |
| --- | --- | --- | --- |
| Passing file | 297 | 261 | 0 |
| Assertion failure | 901 | 811 | 1 |
| Missing query, with compact tree context | 1,065 | 977 | 1 |
| Bundle dependency failure | 2,062 | 1,972 | 1 |
| Missing host | 1,560 | 1,460 | 1 |

Missing file selection exits 1. A name pattern matching zero tests exits 0 with the file/tests skipped. Preserve runner status for compatibility and teach agents to inspect executed counts; exit 0 alone is insufficient evidence. A help-like test-name pattern produces a normal test summary, not full Vitest help.

The `dot` reporter saves only 36 bytes on this passing-file sample and around 90–100 bytes on the failure samples. Keep the default reporter for now. These small fixtures do not rule out larger-suite output problems; investigate those if fresh task traces identify them.

The bundle case was checked to contain the intended missing dependency error; the query case contains the missing target and relevant tree. Measurements use sample app data and copy no credentials or live network responses. Paths, timing lines, and stack line numbers can vary on rerun.

Reproduce local measurements:

```sh
node .docs/validation/2026-10-05-agent-tokens/measure-cli.mjs
```

The script creates temporary test files under `examples/` and removes them. Run it separately from tests that discover all flow files at the repository root. Set `RN_A11Y_TREE_CACHE_DIR` to a writable temporary cache when the user's normal cache is outside the execution sandbox.

## Existing eval trace audit

[`eval-baseline.json`](eval-baseline.json) was generated from `~/a11y-eval/runs/*/stream.ndjson` with [`analyze-evals.py`](analyze-evals.py). Usage totals agree with all available saved `metrics.json` files. Incremental usage events are summed once; cumulative `end.usage` is excluded. Exposed reasoning usage is reported separately, without adding it to the provider's supplied total.

| Run | Done metadata | Model calls | Total tokens | Cached input share | Test executions + help |
| --- | --- | --- | --- | --- | --- |
| A r6-1 | False | 121 | 15,824,412 | 95.1% | 6 + 1 |
| B r6-1 | False | 116 | 13,394,816 | 94.3% | 0 + 0 |
| A-hard r6-1 | True | 160 | 20,244,261 | 97.0% | 5 + 1 |
| B r6-2 | True | 108 | 11,254,971 | 94.4% | 0 + 0 |
| A-hard r6-2 | True | 41 | 3,031,417 | 95.0% | 5 + 0 |
| A r6-2 | Missing | 47 | 3,496,403 | 90.1% | 3 + 0 |

The reported test-call counts include help. A's help update was 7,520 bytes; A-hard's combined help/README update was 14,597 bytes. A-hard also received a 2,624-byte schema update. These support the reported discovery-overhead observations. The audit counts terminal commands mentioning `rn-a11y-tree test`; compound commands can contain more than one invocation, so this is not an executed-test-case count. None of these detected test execution commands used a name filter.

The 20.24M-token A-hard run contains 19.64M cached input tokens. It also made 160 model calls versus 108 in finished B, and accumulated more context per call. Removing discovery text helps future context, but neither the byte totals nor action labels identify its marginal share of all task tokens. Cached context includes the entire retained conversation and tool metadata, not just a11y output.

A-hard r6-2 was much cheaper than the other finished runs, which shows substantial run-to-run variation. Its completion marker has not been independently scored for quality. Do not discard it or conclude that the revised tool saves tokens from this old run. A r6-2 has no completion metadata and is retained as incomplete/unknown.

Terminal output bytes in the JSON are the largest output update received for each tool call. They are not summed model input tokens. No raw output text from the agent traces is copied. Simulator command counts here include command strings mentioning `agent-device` or screenshot operations and image reads are recorded separately; they use a different counting rule from the supplied report and should not replace that report's figures.

Reproduce the audit without modifying the external eval home:

```sh
python3 .docs/validation/2026-10-05-agent-tokens/analyze-evals.py \
  /Users/kudo/a11y-eval \
  .docs/validation/2026-10-05-agent-tokens/eval-baseline.json
```

## Fresh comparison prerequisites

The existing external runner still calls `skill --install`, pins the old package scaffold, and scores by building a Release app. Its script-hash manifest and clean-checkout guard also require runner changes to be committed before starting a run. Launching it unchanged would not measure the revised CLI/skill and would reintroduce the build confound.

Before the five-condition pilot in the plan: update the runner to capture one printed skill read inside measured usage, use immutable candidate/control packages and skill hashes, implement independent CLI/skill selection, and use equivalent Expo Go launch/scoring for all conditions. Check SDK 58 Expo Go availability and auth without exposing credentials. Keep the same requested model/effort and record the resolved model. Preserve historical runs and run fresh conditions in new directories. Quality scoring and held-out tasks remain required before claiming lower total token usage.

The candidate changes and local evidence are ready for this next phase. The fresh comparison has not run.

The frozen control tarball's skill hash matches the original eval smoke hash exactly. A pre-release candidate tarball was prepared at `/tmp/rn-a11y-tree-token-candidate/react-native-a11y-tree-0.1.6.tgz`; control/candidate archive hashes and source hashes are in [`candidate-provenance.json`](candidate-provenance.json). That archive predates the 0.1.7 version bump and remains a frozen local working-tree snapshot. Its temporary path must be preserved, or a replacement package rebuilt and recorded with new provenance before fresh runs.

## Verification

- Typecheck, schema consistency, skill validation, and build passed.
- Across the full unit run and targeted retries, all 391 non-skipped tests passed; 8 existing tests were skipped. The first run had 3 failures caused by sandbox cache/socket restrictions. The affected package and localhost-network tests passed with writable temporary caches and the required network permission. No unrelated code was changed to make those checks pass.
- All 23 real-host flow E2E tests passed in strict mode on the two configured presets, including taps, scrolling, gestures, native fixtures, network record/replay, Router flows, and runner name/reporter forwarding.
- Pack/install verification passed, including concise help from the installed CLI. Built CLI output matches the current skill and source help; source/published README copies match.
- Release preparation for 0.1.7: frozen-lockfile installation, build, typecheck, schema consistency, 43 focused CLI/skill/changelog tests, and npm tarball metadata/content checks passed after the version bump.

The fresh five-condition agent pilot, independent quality scores, and held-out tasks remain pending. They are the release gate for a claim about total task token savings.
