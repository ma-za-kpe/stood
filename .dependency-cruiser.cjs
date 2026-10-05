module.exports = {
  forbidden: [
    {
      name: 'platform-sdk-is-server-only',
      severity: 'error',
      from: { path: '^apps/yard-web/' },
      to: { path: '^packages/stood-sdk/' },
    },
    {
      name: 'pure-yard-domain',
      severity: 'error',
      from: { path: '^packages/yard-domain/src/' },
      to: { pathNot: '^packages/yard-domain/src/' },
    },
    {
      name: 'real-crew-is-external',
      severity: 'error',
      from: { path: '^(services|packages|apps)/.*crew', pathNot: '/(fakes|contracts)/' },
      to: {},
    },
    {
      name: 'no-internal-crew-imports',
      severity: 'error',
      from: {},
      to: { path: '^(services|packages|apps)/.*crew', pathNot: '/(fakes|contracts)/' },
    },
    {
      name: 'yard-calls-stood-over-http',
      severity: 'error',
      from: { path: '^(services/yard-[^/]+/|apps/yard-web/|packages/stood-sdk/)' },
      to: { path: '^services/api/' },
    },
    {
      name: 'foreman-plans-only',
      severity: 'error',
      from: { path: '^services/yard-foreman/' },
      to: {
        path: '^(services/(api|yard-api|yard-crew)/|packages/stood-sdk/|(@paypal/)|(node:)?(child_process|fs|http|https|net|tls|worker_threads)(/|$))',
      },
    },
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'pure-domain',
      severity: 'error',
      from: { path: '^services/api/src/domain/' },
      to: { pathNot: '^services/api/src/domain/' },
    },
    {
      name: 'paypal-only-in-payments',
      severity: 'error',
      from: { pathNot: '^services/api/src/adapters/payments-paypal/' },
      to: { path: '(^|/)@paypal/' },
    },
    {
      name: 'evidence-cannot-pay',
      severity: 'error',
      from: { path: '^services/evidence-agent/' },
      to: { path: '^services/api/' },
    },
    {
      name: 'application-uses-ports',
      severity: 'error',
      from: { path: '^services/api/src/application/' },
      to: { path: '^services/api/src/(adapters|http)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: '(\\.test\\.ts$|/dist/)',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
