export type QaStep = Readonly<{ action: 'visit' } | { action: 'expectText'; text: string }>;
export type QaResult = Readonly<{ passed: boolean; observations: readonly string[]; simulated: boolean }>;
// Browser QA of a deployed preview (Kernel cloud browser in live mode). Findings only: never payment.
export interface BrowserQa {
  check(url: string, steps: readonly QaStep[]): Promise<QaResult>;
}
