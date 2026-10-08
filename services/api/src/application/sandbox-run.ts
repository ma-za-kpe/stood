// T-0224: drives one hold → release (capture) or refuse (void) run through Stood's own PayPal adapter,
// pausing for the buyer's approval, and returns a recording with ids, statuses and amounts only.
type Reply = Readonly<{ status: number | null; body: unknown }>;
type Amount = Readonly<{ currencyCode: string; value: string }>;
export interface SandboxTransport {
  fund(
    action: 'CREATE_ORDER' | 'AUTHORIZE_ORDER' | 'GET_FUNDING_ORDER',
    input: Readonly<{
      mode: 'sim' | 'live';
      orderId: string | null;
      requestId: string;
      operationKey: string;
      trancheId: string;
      payeeRef: string;
      amount: Amount;
    }>,
  ): Promise<Reply>;
  call(
    action: 'CAPTURE' | 'VOID' | 'GET_AUTHORIZATION',
    input: Readonly<{ authorizationId: string; requestId: string; operationKey: string; amount: Amount }>,
  ): Promise<Reply>;
}
export type SandboxStep = Readonly<{
  step: string;
  httpStatus: number | null;
  status: string | null;
  ids: Readonly<Record<string, string>>;
  amount: string | null;
  issue: string | null;
  debugId: string | null;
}>;
export type SandboxRecording = Readonly<{
  scenario: 'release' | 'refuse';
  mode: 'sim' | 'live';
  runId: string;
  outcome: string;
  steps: readonly SandboxStep[];
}>;

const AMOUNT: Amount = { currencyCode: 'USD', value: '10.00' };
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function record(step: string, reply: Reply): SandboxStep {
  const body = obj(reply.body);
  const unit = obj(list(body.purchase_units)[0]);
  const payments = obj(unit.payments);
  const ids: Record<string, string> = {};
  const id = str(body.id);
  // Order steps describe the order, a capture reply the capture, and void or read replies the authorization.
  if (id) ids[step.includes('ORDER') ? 'order' : step === 'CAPTURE' ? 'capture' : 'authorization'] = id;
  const authorization = str(list(payments.authorizations)[0]?.id);
  if (authorization) ids.authorization = authorization;
  const money = obj(body.amount).value ? obj(body.amount) : obj(unit.amount);
  return {
    step,
    httpStatus: reply.status,
    status: str(body.status),
    ids,
    amount: money.value ? `${money.value} ${money.currency_code}` : null,
    issue: issueOf(body),
    debugId: str(body.debug_id),
  };
}

// PayPal errors carry a name and per-field issues, e.g. "NOT_AUTHORIZED: PERMISSION_DENIED".
function issueOf(body: Json): string | null {
  const name = str(body.name);
  const issues = list(body.details)
    .map((d) => str(d.issue))
    .filter((i): i is string => !!i);
  return name ? [name, ...issues].join(': ') : null;
}

export async function runSandboxScenario(
  run: Readonly<{
    scenario: 'release' | 'refuse';
    mode: 'sim' | 'live';
    transport: SandboxTransport;
    payeeRef: string;
    runId: string;
    approve(link: string): Promise<void>;
    sleep(ms: number): Promise<void>;
    maxPolls: number;
  }>,
): Promise<SandboxRecording> {
  const steps: SandboxStep[] = [];
  const done = (outcome: string): SandboxRecording => ({
    scenario: run.scenario,
    mode: run.mode,
    runId: run.runId,
    outcome,
    steps,
  });
  const funding = (orderId: string | null, requestId: string) => ({
    mode: run.mode,
    orderId,
    requestId,
    operationKey: `${run.runId}-hold`,
    trancheId: `${run.runId}-tranche`,
    payeeRef: run.payeeRef,
    amount: AMOUNT,
  });
  const created = await run.transport.fund('CREATE_ORDER', funding(null, `${run.runId}-create`));
  steps.push(record('CREATE_ORDER', created));
  const orderId = str(obj(created.body).id);
  const link = list(obj(created.body).links).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!orderId || !str(link?.href)) return done('ORDER_NOT_CREATED');
  await run.approve(str(link?.href) ?? '');
  let approved = false;
  for (let poll = 0; poll < run.maxPolls && !approved; poll++) {
    if (poll) await run.sleep(5000);
    const order = await run.transport.fund('GET_FUNDING_ORDER', funding(orderId, `${run.runId}-read-${poll}`));
    approved = str(obj(order.body).status) === 'APPROVED';
    if (approved || poll === run.maxPolls - 1) steps.push(record('GET_FUNDING_ORDER', order));
  }
  if (!approved) return done('NOT_APPROVED');
  const authorized = await run.transport.fund('AUTHORIZE_ORDER', funding(orderId, `${run.runId}-authorize`));
  steps.push(record('AUTHORIZE_ORDER', authorized));
  const authorizationId = steps.at(-1)?.ids.authorization;
  if (!authorizationId) return done('NOT_AUTHORIZED');
  const effect = run.scenario === 'release' ? 'CAPTURE' : 'VOID';
  const payment = { authorizationId, operationKey: `${run.runId}-settle`, amount: AMOUNT };
  steps.push(record(effect, await run.transport.call(effect, { ...payment, requestId: `${run.runId}-${effect}` })));
  const final = await run.transport.call('GET_AUTHORIZATION', { ...payment, requestId: `${run.runId}-check` });
  steps.push(record('GET_AUTHORIZATION', final));
  return done(steps.at(-1)?.status ?? 'UNKNOWN');
}
