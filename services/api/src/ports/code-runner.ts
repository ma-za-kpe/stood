// T-0164/T-0159 (ADR-0026): what the application asks of the isolated runner and of the report signer. Adapters
// implement these; the application never imports them directly.
export type RunJob = Readonly<{
  // The builder's repository at the exact commit, as text files.
  source: readonly Readonly<{ path: string; content: string }>[];
  // The buyer's frozen tests: written last, so they replace anything the builder put at those paths.
  frozenTests: readonly Readonly<{ id: string; path: string; content: string }>[];
}>;
export type RunResult = Readonly<{
  tests: readonly Readonly<{ id: string; status: 'PASS' | 'FAIL' }>[];
  installExitCode: number | null;
}>;
export interface CodeRunner {
  run(job: RunJob): Promise<RunResult>;
}
