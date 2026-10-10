import { z } from 'zod';

// T-0053: the Stood platform API (v1) as Zod schemas, the single source of the OpenAPI 3.1 document in
// openapi/stood.json (`scripts/dev openapi`). Contract tests run the real router and check every response against
// these schemas, so the document cannot drift from what the server does.
const sha40 = z.string().regex(/^[a-f0-9]{40}$/);
const sha64 = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(200);
const instant = z.string().describe('UTC ISO-8601 timestamp');

export const Money = z
  .object({ minor: z.number().int().describe('Amount in minor units (cents)'), currency: z.string().length(3) })
  .strict()
  .meta({ id: 'Money' });

export const CodeTerms = z
  .object({
    repository: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/),
    baseCommit: sha40,
    testBundleHash: sha64,
    manifestHash: sha64,
    testIds: z.array(z.string()).min(1).max(200),
    tests: z
      .array(z.object({ id: z.string(), path: z.string() }).strict())
      .min(1)
      .max(200),
    minMutation: z.number().min(0).max(1),
  })
  .strict()
  .meta({ id: 'CodeTerms', description: 'Frozen terms of a code milestone (profiles code.*), checked at draft time.' });

export const Milestone = z
  .object({
    name: z.string().min(1).max(100),
    amount: Money,
    profile: z.string().min(1).max(100).describe('Evidence profile, e.g. code.milestone@1 or code.final@1'),
    params: z
      .union([CodeTerms, z.record(z.string(), z.unknown())])
      .optional()
      .describe('CodeTerms for code.* profiles (checked); other profiles take their own parameters'),
  })
  .strict()
  .meta({ id: 'Milestone' });

export const AllowanceDraft = z
  .object({
    payee_ref: z.string().min(1).max(200),
    cap: Money,
    milestones: z.array(Milestone).max(50),
    window_days: z.number().int(),
    max_resubmits: z.number().int(),
  })
  .strict()
  .meta({ id: 'AllowanceDraft' });

export const Allowance = z
  .object({
    id,
    status: z.literal('DRAFT'),
    payee_ref: z.string(),
    cap: Money,
    milestones: z.array(Milestone),
    window_days: z.number().int(),
    max_resubmits: z.number().int(),
    tranches: z.array(z.object({ id, name: z.string() }).strict()),
  })
  .strict()
  .meta({ id: 'Allowance' });

export const CommitPackageInput = z
  .object({
    repository: z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/),
    base_commit: sha40,
    commit_sha: sha40,
    report_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*\.json$/),
    report_sha256: sha64,
  })
  .strict()
  .meta({ id: 'CommitPackageInput' });

export const CommitPackage = z
  .object({
    id,
    trancheId: id,
    status: z.literal('QUEUED'),
    waitingFor: z.enum(['HOLD', 'RENEWAL', 'RUNNER']),
    metadata: CommitPackageInput,
    createdAt: instant,
  })
  .strict()
  .meta({ id: 'CommitPackage' });

export const Mandate = z
  .object({
    key: z.string(),
    status: z.enum(['RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'TOKENIZING', 'SIGNED', 'REVOKED']),
    approve_url: z.string().nullable().describe('Only while AWAITING_APPROVAL: where the buyer approves'),
    expires_at: z.number().int().describe('When the signing request lapses, Unix milliseconds'),
  })
  .strict()
  .meta({ id: 'Mandate' });

export const FundingRequest = z
  .object({
    expected_version: z.number().int().min(0).describe('The tranche version just read'),
    nonce: z.string().regex(/^[A-HJ-NP-Z2-9]{3}$/),
  })
  .strict()
  .meta({ id: 'FundingRequest' });

export const Funding = z
  .object({
    key: z.string(),
    status: z.enum(['RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'FAILED', 'EXPIRED']),
    approve_url: z.string().nullable(),
    hold_expires_at: z.number().int().nullable().describe('Only while HELD: when the hold lapses, Unix milliseconds'),
  })
  .strict()
  .meta({ id: 'Funding' });

export const Decision = z
  .object({
    outcome: z.enum(['RELEASE', 'REFUSE', 'WAIT']),
    effect: z.enum(['CAPTURE', 'VOID', 'NONE', 'REVIEW']),
    profileId: z.string(),
    ruleSetVersion: z.string(),
    namedField: z.string().nullable(),
    reason: z.string(),
    detail: z.unknown(),
  })
  .loose()
  .meta({ id: 'Decision' });

export const Tranche = z
  .object({
    id,
    state: z.enum([
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
    ]),
    version: z.number().int().describe('Send as expected_version when funding'),
    profile: z.string(),
    amount: Money,
    decision: Decision.nullable(),
    hold: z
      .object({ age_seconds: z.number().int().min(0), expires_at: instant })
      .strict()
      .nullable(),
    settlement: z.object({ effect: z.string() }).loose().nullable(),
    safe_recovery: z.boolean(),
    pending: z.object({ effect: z.string(), status: z.string(), created_at: instant }).strict().nullable(),
    sentences: z.record(z.string(), z.unknown()).describe('Plain-language status for the payer and the inspector'),
    package_id: id.nullable(),
    resubmissions_left: z.number().int().min(0),
    provider: z.enum(['paypal-sandbox', 'simulator']),
  })
  .strict()
  .meta({ id: 'Tranche' });

export const Problem = z
  .object({
    type: z.string().describe('urn:stood:problem:<code>'),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    detail: z.string(),
  })
  .strict()
  .meta({ id: 'Problem', description: 'RFC 9457 problem details' });

type Operation = Readonly<{
  method: 'get' | 'post';
  path: string;
  id: string;
  summary: string;
  body?: z.ZodType;
  ok: Readonly<{ status: 200 | 201 | 202; schema: z.ZodType }>;
  idempotent?: boolean;
  problems: readonly number[];
}>;
export const operations: readonly Operation[] = [
  {
    method: 'post',
    path: '/allowances',
    id: 'createAllowance',
    summary: 'Draft an allowance: a payment cap split into milestones, each with an evidence profile',
    body: AllowanceDraft,
    ok: { status: 201, schema: Allowance },
    idempotent: true,
    problems: [401, 409, 413, 422, 503],
  },
  {
    method: 'get',
    path: '/allowances/{id}',
    id: 'getAllowance',
    summary: 'Read an allowance this platform owns',
    ok: { status: 200, schema: Allowance },
    problems: [401, 404],
  },
  {
    method: 'post',
    path: '/allowances/{id}/mandate',
    id: 'requestMandate',
    summary: "Start saved-PayPal signing for the allowance's current terms (send {})",
    body: z.object({}).strict(),
    ok: { status: 202, schema: Mandate },
    idempotent: true,
    problems: [401, 404, 409, 422, 503],
  },
  {
    method: 'get',
    path: '/allowances/{id}/mandate/{key}',
    id: 'getMandate',
    summary: 'Read signing status and, while awaiting the buyer, the approval link',
    ok: { status: 200, schema: Mandate },
    problems: [401, 404, 503],
  },
  {
    method: 'get',
    path: '/tranches/{id}',
    id: 'getTranche',
    summary: 'Read a tranche: state, hold, latest decision and plain-language sentences',
    ok: { status: 200, schema: Tranche },
    problems: [401, 404],
  },
  {
    method: 'post',
    path: '/tranches/{id}/funding',
    id: 'requestFunding',
    summary: 'Reserve funding (a PayPal authorization hold) for a tranche at the version just read',
    body: FundingRequest,
    ok: { status: 202, schema: Funding },
    idempotent: true,
    problems: [401, 404, 409, 422, 503],
  },
  {
    method: 'get',
    path: '/tranches/{id}/funding/{key}',
    id: 'getFunding',
    summary: 'Read funding status, the approval link when required, and the hold expiry',
    ok: { status: 200, schema: Funding },
    problems: [401, 404, 503],
  },
  {
    method: 'post',
    path: '/tranches/{id}/packages',
    id: 'submitPackage',
    summary: "Submit a commit package for Stood's runner to judge; returns QUEUED, never a result",
    body: CommitPackageInput,
    ok: { status: 202, schema: CommitPackage },
    idempotent: true,
    problems: [401, 404, 409, 422, 503],
  },
  {
    method: 'get',
    path: '/tranches/{id}/packages/{packageId}',
    id: 'getPackage',
    summary: 'Read a submitted commit package',
    ok: { status: 200, schema: CommitPackage },
    problems: [401, 404, 503],
  },
];

const ref = (s: z.ZodType) => {
  const name = z.globalRegistry.get(s)?.id;
  if (name) return { $ref: `#/components/schemas/${name}` };
  const { $schema: _schema, ...inline } = z.toJSONSchema(s, { target: 'draft-2020-12', io: 'output' });
  return inline;
};

// The contract's own version, independent of release numbers: raise it with any change to the document, and the
// major part with any breaking change (the breaking-change check compares against main).
export const API_VERSION = '1.0.0';

// The OpenAPI 3.1 document. Deterministic: the same schemas always produce the same bytes.
export function openApiDocument(version: string = API_VERSION) {
  // Every schema above that carries a meta id becomes a named component; references point at components.
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    io: 'output',
    uri: (name) => `#/components/schemas/${name}`,
  }) as { schemas: Record<string, Record<string, unknown>> };
  const components = Object.fromEntries(
    Object.entries(schemas)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, def]) => {
        const { id: _id, $id: _uri, $schema: _schema, ...rest } = def;
        return [name, rest];
      }),
  );
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    paths[op.path] ??= {};
    (paths[op.path] as Record<string, unknown>)[op.method] = {
      operationId: op.id,
      summary: op.summary,
      security: [{ platformKey: [], requestSignature: [] }],
      parameters: [
        ...params,
        ...(op.idempotent
          ? [
              {
                name: 'Idempotency-Key',
                in: 'header',
                required: true,
                description: 'Same key and body return the same response; a different body is 409',
                schema: { type: 'string', maxLength: 200 },
              },
            ]
          : []),
      ],
      ...(op.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: ref(op.body) } } } }
        : {}),
      responses: {
        [op.ok.status]: {
          description: op.ok.status === 202 ? 'Accepted (recorded, not yet done)' : 'OK',
          content: { 'application/json': { schema: ref(op.ok.schema) } },
        },
        ...Object.fromEntries(
          op.problems.map((status) => [
            status,
            {
              description: PROBLEM_TEXT[status] ?? 'Problem',
              content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
            },
          ]),
        ),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Stood platform API',
      version,
      summary: 'Milestone payments held on PayPal (sandbox) and released only on evidence',
      description:
        'Every request carries the platform key (Authorization: Bearer) and a Stood-Signature: t=<unix seconds>,v2=<hex HMAC-SHA256 over the canonical request>, within five minutes. Bodies are at most 64 KiB. Stood only talks to the PayPal sandbox.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: 'https://stood-api.onrender.com/v1', description: 'Hosted (PayPal sandbox)' }],
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        platformKey: { type: 'http', scheme: 'bearer', description: 'The platform key' },
        requestSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'Stood-Signature',
          description:
            't=<unix seconds>,v2=<hex HMAC-SHA256(secret, JSON ["stood.request@2", t, method, "/v1"+path+query, Idempotency-Key, If-Match, Content-Type, body])>',
        },
      },
    },
  };
}
const PROBLEM_TEXT: Readonly<Record<number, string>> = {
  401: 'Missing or invalid platform key or signature',
  404: 'Not found, or not owned by this platform',
  409: 'Idempotency or version conflict',
  413: 'Body over 64 KiB',
  422: 'Invalid request',
  503: 'Storage or the feature is unavailable; retry with the same idempotency key',
};
