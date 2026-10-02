# Proposed explicit data faults — not executed

Keep the successful pilot and its evidence unchanged. Run these scenarios in a
separate temporary app/process with a distinct, named setup file. Retain the real
App, QueryClient/provider, navigator, screens, API module and hooks. Do not replace
`fetchMovie`/`fetchMovies`, set Query cache results directly, or claim real HTTP
failures: the upstream API reads an in-memory JSON dataset after a timer.

## Feasible boundary: mutate the imported JSON array explicitly

Setup can import `./src/data/movies.json`, save its original array contents, and
mutate that array in place. This changes test input, not an ESM export binding or
an API implementation. Metro's shared module instance should let the unchanged
API observe those contents; verify that assumption in the actual experiment.
The source JSON file can remain byte-for-byte unchanged. A separately perturbed
JSON file is another option, but must have its own hash/diff and must never be
folded into the unchanged-source happy-path evidence.

The entry template installs the RN environment before loading setup, and setup
runs before App. An explicit scenario fixture can therefore schedule data changes
and log each mutation. It must emit a named `APPLICATION_FIXTURE` diagnostic such
as `pilot/movies-data`, alongside the existing NetInfo fixture. That diagnostic
must remain visible and require an exact strict allowance. This would be a
manually declared data fixture, not an automatically detected native adapter.

## Empty list and recovery

Before App loads, clear the array. Run the whole app through its real pending
query to resolution. Assert no movie rows and no pending indicator structure.
The upstream app has no dedicated empty-state message; report a blank resolved
list, not a designed empty-state experience.

Then restore the array and explicitly inject a JS AppState background→active
notification so the upstream `useAppState` → Query `focusManager` path refetches.
Assert a second `fetchMovies` call followed by the restored rows. The injection
must be separately logged and disclosed: this checks JS lifecycle handling, not
actual OS background/foreground delivery. Validate the real RN event contract
before implementation; do not silently replace `useAppState` or the provider.

## Detail error and recovery

Let the normal list query resolve first. Its output is a new array of title/year
objects, so removing Rush from the underlying dataset afterward leaves the cached
list row intact. Tap that real row. The unchanged detail query then fails with
`Movie not found` after its delay; the real QueryClient performs its configured
two retries. Assert the application's ErrorMessage appears and that the query was
retried, rather than merely accepting a logged rejection.

Restore the dataset only after the error has been observed. Inject the explicitly
labeled focus transition described above (or use genuine back/re-entry controls)
to trigger the real query again. Assert replacement of the error with the title,
plot and actors. Recovery through navigation must be labeled as such, not called
an in-place retry-button test; upstream has no retry button.

The data delays are 200–2199 ms and retry delays add time. Use bounded, staged
harness waits and explicit fixture timing/log evidence, preserving the real Query
retry settings. Do not globally replace timers or Math.random to manufacture a
pass. Before choosing timer cutoffs, verify when the detail query starts and that
the scheduler drains promise jobs between advances.

## What this would establish

Only after execution: the complete upgraded upstream example's Query state,
error UI and recovery behavior under disclosed dataset/lifecycle perturbations.
It would not establish HTTP transport/error handling, a production backend,
connectivity transitions, native lifecycle delivery, or independent production
adoption. No fault setup or data mutation was implemented during this assessment.
