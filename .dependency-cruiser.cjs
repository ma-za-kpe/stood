module.exports = {
  forbidden: [
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
