import { createHmac } from 'node:crypto';
export type DraftInput = Readonly<{
  payee_ref: string;
  cap: Readonly<{ minor: number; currency: string }>;
  milestones: readonly Readonly<{
    name: string;
    amount: Readonly<{ minor: number; currency: string }>;
    profile: string;
    params: Readonly<Record<string, unknown>>;
  }>[];
  window_days: number;
  max_resubmits: number;
}>;
export type DraftView = Readonly<{
  id: string;
  status: 'DRAFT';
  cap: Readonly<{ minor: number; currency: string }>;
  tranches: readonly Readonly<{ id: string; name: string }>[];
}>;
export type PackageInput = Readonly<{
  repository: string;
  base_commit: string;
  commit_sha: string;
  report_ref: string;
  report_sha256: string;
}>;
export type PackageView = Readonly<{
  id: string;
  trancheId: string;
  status: 'QUEUED';
  waitingFor: 'HOLD' | 'RENEWAL' | 'RUNNER';
  createdAt: string;
  metadata: PackageInput;
}>;
// A read of Stood's public tranche view. Callers act on it only together with a signed notification.
export type TrancheView = Readonly<{
  id: string;
  state: string;
  version: number;
  holdExpiresAt: string | null;
  settlement: Readonly<{ effect: 'CAPTURE' | 'VOID' | 'EXPIRE'; reference: string }> | null;
  decision: Readonly<{ outcome: 'RELEASE' | 'REFUSE' | 'WAIT'; namedField: string | null; reason: string }> | null;
}>;
const STATES = [
  'PENDING',
  'WAIT_FUNDING',
  'HELD',
  'DECIDING',
  'WAITING',
  'CAPTURE_PENDING',
  'VOID_PENDING',
  'REAUTHORIZE_PENDING',
  'RELEASED',
  'REFUSED',
  'EXPIRED',
  'CANCELLED',
  'DISPUTED',
];
type Code =
  | 'INVALID_INPUT'
  | 'INVALID_RESPONSE'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNAVAILABLE'
  | 'UNKNOWN_OUTCOME'
  | 'TIMEOUT';
export class StoodClientError extends Error {
  constructor(readonly code: Code) {
    super('Stood request failed.');
    this.name = 'StoodClientError';
  }
}
type Config = Readonly<{
  baseUrl: string;
  key: string;
  secret: string;
  clock(): number;
  transport?: (request: Request) => Promise<Response>;
  timeoutMs?: number;
}>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
const hex = (v: unknown, n: number): v is string => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
function draftView(v: unknown): DraftView {
  if (
    !object(v) ||
    !id(v.id) ||
    v.status !== 'DRAFT' ||
    !object(v.cap) ||
    !Number.isSafeInteger(v.cap.minor) ||
    Number(v.cap.minor) <= 0 ||
    !['USD', 'GBP', 'EUR'].includes(String(v.cap.currency)) ||
    !Array.isArray(v.tranches) ||
    !v.tranches.length ||
    !v.tranches.every((t) => object(t) && id(t.id) && id(t.name))
  )
    throw new StoodClientError('INVALID_RESPONSE');
  return Object.freeze({
    id: v.id,
    status: 'DRAFT',
    cap: Object.freeze({ minor: Number(v.cap.minor), currency: String(v.cap.currency) }),
    tranches: Object.freeze(v.tranches.map((t) => Object.freeze({ id: String(t.id), name: String(t.name) }))),
  });
}
function trancheView(v: unknown, trancheId: string): TrancheView {
  if (
    !object(v) ||
    v.id !== trancheId ||
    !STATES.includes(String(v.state)) ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 0 ||
    (v.hold !== null &&
      (!object(v.hold) || typeof v.hold.expires_at !== 'string' || !Number.isFinite(Date.parse(v.hold.expires_at)))) ||
    (v.settlement !== null &&
      (!object(v.settlement) ||
        !['CAPTURE', 'VOID', 'EXPIRE'].includes(String(v.settlement.effect)) ||
        !id(v.settlement.reference))) ||
    (v.decision !== null &&
      (!object(v.decision) ||
        !['RELEASE', 'REFUSE', 'WAIT'].includes(String(v.decision.outcome)) ||
        typeof v.decision.reason !== 'string' ||
        (v.decision.namedField !== null && typeof v.decision.namedField !== 'string')))
  )
    throw new StoodClientError('INVALID_RESPONSE');
  const s = v.settlement as { effect: 'CAPTURE' | 'VOID' | 'EXPIRE'; reference: string } | null;
  const d = v.decision as { outcome: 'RELEASE' | 'REFUSE' | 'WAIT'; namedField: string | null; reason: string } | null;
  return Object.freeze({
    id: trancheId,
    state: String(v.state),
    version: Number(v.version),
    holdExpiresAt: v.hold === null ? null : String((v.hold as { expires_at: string }).expires_at),
    settlement: s ? Object.freeze({ effect: s.effect, reference: s.reference }) : null,
    decision: d ? Object.freeze({ outcome: d.outcome, namedField: d.namedField, reason: d.reason }) : null,
  });
}
function packageView(v: unknown, trancheId: string): PackageView {
  if (
    !object(v) ||
    !id(v.id) ||
    v.trancheId !== trancheId ||
    v.status !== 'QUEUED' ||
    !['HOLD', 'RENEWAL', 'RUNNER'].includes(String(v.waitingFor)) ||
    typeof v.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    !object(v.metadata)
  )
    throw new StoodClientError('INVALID_RESPONSE');
  const m = v.metadata;
  if (
    Object.keys(m).sort().join() !== 'base_commit,commit_sha,report_ref,report_sha256,repository' ||
    typeof m.repository !== 'string' ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(m.repository) ||
    !hex(m.base_commit, 40) ||
    !hex(m.commit_sha, 40) ||
    !hex(m.report_sha256, 64) ||
    typeof m.report_ref !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9/_-]*\.json$/.test(m.report_ref)
  )
    throw new StoodClientError('INVALID_RESPONSE');
  return Object.freeze({
    id: v.id,
    trancheId,
    status: 'QUEUED',
    waitingFor: v.waitingFor as PackageView['waitingFor'],
    createdAt: v.createdAt,
    metadata: Object.freeze({
      repository: m.repository,
      base_commit: m.base_commit,
      commit_sha: m.commit_sha,
      report_ref: m.report_ref,
      report_sha256: m.report_sha256,
    }),
  });
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new StoodClientError('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new StoodClientError('INVALID_RESPONSE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new StoodClientError('INVALID_RESPONSE');
  }
}
// Server-side only: do not bundle platform credentials in yard-web.
// No capture, dispatch, approval or webhook-authority methods exist in this slice.
export class StoodClient {
  private readonly origin: string;
  private readonly timeout: number;
  private readonly transport: (request: Request) => Promise<Response>;
  constructor(private readonly config: Config) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw new StoodClientError('INVALID_INPUT');
    }
    this.timeout = config.timeoutMs ?? 5000;
    if (
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !config.key.trim() ||
      !config.secret.trim() ||
      !Number.isInteger(this.timeout) ||
      this.timeout < 1 ||
      this.timeout > 30000
    )
      throw new StoodClientError('INVALID_INPUT');
    this.origin = url.origin;
    this.transport = config.transport ?? ((request) => fetch(request));
  }
  private resource(value: string): string {
    if (!id(value)) throw new StoodClientError('INVALID_INPUT');
    return encodeURIComponent(value);
  }
  private async request(method: 'POST' | 'GET', path: string, input?: unknown, key?: string): Promise<unknown> {
    const now = this.config.clock();
    if (!Number.isSafeInteger(now) || now < 0 || (method === 'POST' && (!key?.trim() || key.length > 200)))
      throw new StoodClientError('INVALID_INPUT');
    let body = '';
    try {
      if (method === 'POST') {
        const encoded = JSON.stringify(input);
        if (typeof encoded !== 'string') throw new StoodClientError('INVALID_INPUT');
        body = encoded;
      }
    } catch {
      throw new StoodClientError('INVALID_INPUT');
    }
    if (Buffer.byteLength(body) > 65536) throw new StoodClientError('INVALID_INPUT');
    const timestamp = String(Math.floor(now / 1000));
    const url = new URL(`${this.origin}/v1${path}`);
    const headers = new Headers({
      Authorization: `Bearer ${this.config.key}`,
      'Content-Type': 'application/json',
    });
    if (key) headers.set('Idempotency-Key', key);
    const signature = createHmac('sha256', this.config.secret)
      .update(
        JSON.stringify([
          'stood.request@2',
          timestamp,
          method,
          `${url.pathname}${url.search}`,
          headers.get('Idempotency-Key') ?? '',
          headers.get('If-Match') ?? '',
          headers.get('Content-Type') ?? '',
          body,
        ]),
      )
      .digest('hex');
    headers.set('Stood-Signature', `t=${timestamp},v2=${signature}`);
    const controller = new AbortController();
    // The SDK owns its deadline: a transport that misses or ignores the abort still ends at the timeout.
    let expire = () => {};
    const deadline = new Promise<never>((_resolve, reject) => {
      expire = () => reject(new Error('deadline'));
    });
    const timer = setTimeout(() => {
      controller.abort();
      expire();
    }, this.timeout);
    try {
      const response = await Promise.race([
        this.transport(
          new Request(url, {
            method,
            headers,
            redirect: 'error',
            signal: controller.signal,
            ...(method === 'POST' ? { body } : {}),
          }),
        ),
        deadline,
      ]);
      if (response.redirected || (response.status >= 300 && response.status < 400))
        throw new StoodClientError('INVALID_RESPONSE');
      if (!response.ok) {
        const code: Code =
          response.status === 401
            ? 'UNAUTHORIZED'
            : response.status === 404
              ? 'NOT_FOUND'
              : response.status === 409
                ? 'CONFLICT'
                : response.status === 422
                  ? 'VALIDATION'
                  : 'UNAVAILABLE';
        throw new StoodClientError(code);
      }
      return await boundedJson(response);
    } catch (error) {
      if (error instanceof StoodClientError) throw error;
      throw new StoodClientError(controller.signal.aborted ? 'TIMEOUT' : 'UNKNOWN_OUTCOME');
    } finally {
      clearTimeout(timer);
    }
  }
  async createDraft(input: DraftInput, key: string): Promise<DraftView> {
    return draftView(await this.request('POST', '/allowances', input, key));
  }
  async getDraft(allowanceId: string): Promise<DraftView> {
    const v = draftView(await this.request('GET', `/allowances/${this.resource(allowanceId)}`));
    if (v.id !== allowanceId) throw new StoodClientError('INVALID_RESPONSE');
    return v;
  }
  async submitPackage(trancheId: string, input: PackageInput, key: string): Promise<PackageView> {
    return packageView(
      await this.request('POST', `/tranches/${this.resource(trancheId)}/packages`, input, key),
      trancheId,
    );
  }
  async getTranche(trancheId: string): Promise<TrancheView> {
    return trancheView(await this.request('GET', `/tranches/${this.resource(trancheId)}`), trancheId);
  }
  async getPackage(trancheId: string, packageId: string): Promise<PackageView> {
    const v = packageView(
      await this.request('GET', `/tranches/${this.resource(trancheId)}/packages/${this.resource(packageId)}`),
      trancheId,
    );
    if (v.id !== packageId) throw new StoodClientError('INVALID_RESPONSE');
    return v;
  }
}
