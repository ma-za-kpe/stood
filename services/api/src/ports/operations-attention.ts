// T-0155: what needs a person right now, as counts only (no ids, amounts or owners), so it can be public.
export type Attention = Readonly<{ openFindings: number; openAlerts: number; oldestOpenedAt: string | null }>;
export interface OperationsAttention {
  read(): Promise<Attention>;
}
