import { providerRuntime } from './provider-runtime.js';

// Same composition and time source as the HTTP server; no implicit live fallback.
export async function reconciliationRuntime(env: Readonly<Record<string, string | undefined>>) {
  const runtime = await providerRuntime(env);
  if (!runtime.transport) throw new Error('Reconciliation provider is not configured');
  return { ...runtime, transport: runtime.transport };
}
