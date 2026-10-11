// T-0164/T-0159 (ADR-0026): what the application asks of the isolated runner and of the report signer. Adapters
// implement these; the application never imports them directly.
export type RunJob = Readonly<{
  // The builder's repository at the exact commit, as text files.
  source: readonly Readonly<{ path: string; content: string }>[];
  // The buyer's frozen tests: written last, so they replace anything the builder put at those paths.
  frozenTests: readonly Readonly<{ id: string; path: string; content: string }>[];
}>;
// Second audit (2026-10-11): how each frozen file ran, read from the judge's own test report.
// PASSED: real named tests ran and every one passed. ASSERTION_FAILED: real named tests ran and every failure is an
// assertion (the software does not do what the test asks). NOT_RUN: the file could not show either (it did not load,
// threw outside an assertion, timed out, skipped or cancelled a test, or declared none).
export type TestOutcome = 'PASSED' | 'ASSERTION_FAILED' | 'NOT_RUN';
export type RunResult = Readonly<{
  // PASS only when the outcome is PASSED.
  tests: readonly Readonly<{ id: string; status: 'PASS' | 'FAIL'; outcome: TestOutcome }>[];
  installExitCode: number | null;
}>;
export interface CodeRunner {
  run(job: RunJob): Promise<RunResult>;
}
