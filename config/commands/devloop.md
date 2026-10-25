---
description: Feature loop - parallel test-writing, dev<->review iterations (max 3), tester verification, optional visual checks
agent: orchestrator
---

Deliver: $ARGUMENTS

**Decide two settings up front (state them in your first message):**
- `VIS`: `off` (default) | `live` (a separate background window so the USER can glance at the run) | `record`
  (headless + PNG/MP4 saved under `artifacts/`). Ask the user only when the task is plausibly visual (control
  loops, simulations, perception, UI); otherwise assume `off`. `live` is a courtesy, never a gate.
- `SCRATCH`: if there is no project context (a throwaway experiment), the working dir is
  `/tmp/opencode/<name>/` on Linux or `%TEMP%\opencode\<name>\` on native Windows, and you
  DELETE it at the end. Inside a real project nothing moves: tests stay in the repo.

**Phase 0 - plan the tests (you own this list).**
Write a numbered, verifiable test list from: the existing suite, the modules the task touches, and the project
invariants (AGENTS.md: pytest / `colcon test`, SI units, control logic decoupled from the simulator).
Every item must be runnable or checkable by the tester. This list is the source of truth for the tester and for
your final report. Also state the contract explicitly: any ambiguity (boundary conditions, exact semantics) is
YOUR decision, written down before delegating.

**Phase 1 - parallel, no cross-talk.**
1. Launch `developer` with the task. Tell it: (a) it may consult `@robotics` directly for math/physics/algorithms;
   (b) do NOT create or edit anything under `tests/` or `test/` - the tester owns the tests; (c) its FULL report
   goes in its FINAL message (files touched, diff summary, checks it ran).
2. In the same turn, launch `tester` with the test list: its job now is to WRITE the suite (it can only edit test
   files); the implementation may not exist yet, so it must not try to run it.
- Keep both `sessionID`s. The two never talk to each other: all traffic goes through you.

**Phase 2 - dev <-> review until convergence (max 3 iterations).**
   a. `reviewer` on the diff (`git diff`), findings as `blocker`/`major`/`minor` + verdict. It is instructed to be
      short and to skip non-defects; if you need a full audit, ask for a "deep pass" explicitly.
   b. Continue the SAME developer session with those findings verbatim, plus (from iteration 2) the tester's
      failures. Ask it to state, per finding, whether it is addressed and how.
   c. Stop as soon as the reviewer reports no `blocker`/`major`.
Hard cap: 3 iterations. Still open blockers at iteration 3? Stop and report - never start a 4th.

**Phase 3 - verification (the tester runs what it wrote).**
Continue the tester session: run the suite against the current revision and report per numbered item the command,
exit code, result, plus coverage notes. Failures go back into the developer session (step 2b) and the tester
re-runs afterwards. These rounds count inside the 3-iteration cap.

**Phase 4 - optional live view (`VIS=live` only; it never gates the loop).**
Fire-and-forget: a separate background viewer (`plt.show()`, `rviz`, `rqt`) attached to a run that keeps producing
its own output. Start it once, report PID + how to stop it, carry on immediately - never wait for the user and never
treat a closed window as a failure. `VIS=record` instead saves headless artifacts under `artifacts/`.
If the user reports something visually wrong, that is a finding: feed it as a new iteration.

**Debugger - your call, strict trigger.** Launch `@debugger` only when: the same failure survives 2 fix attempts,
the tester's failure cause is not visible in the log/trace, or the failure is intermittent. Nobody else may call it.

**Final report:** settings used (`VIS`/`SCRATCH`), phases run, iterations used, the test list with pass/fail per
item, files changed, artifact paths, remaining findings by severity, debugger involvement, verdict
(merge / needs a human decision).

**Hard rules:**
- Only you launch agents. No child may launch another child, except `developer` -> `robotics`.
- Only a child's LAST message reaches you: always demand a complete final report.
- Verification and rendering run in the same location (worktree/scratch dir) the developer worked in.
- Delete the scratch dir at the end when `SCRATCH` applies.
