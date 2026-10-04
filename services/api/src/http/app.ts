import { Hono } from 'hono';
import { missingPaymentKeys, type PaymentKeys, SETUP_GUIDANCE } from '../application/payment-readiness.js';
import { assessmentSentence } from '../domain/assessment-sentence.js';
import { type CheckResult, decide, getProfile } from '../domain/decision.js';
import { recipientAssessment } from '../domain/recipient-sentences.js';

export type AppConfig = Readonly<{
  appEnv: string;
  paypalBaseUrl: string;
  demoMode: boolean;
  paymentKeys?: PaymentKeys;
}>;

const scenarios: Readonly<Record<string, { profileId: string; changed?: CheckResult }>> = Object.freeze({
  good: { profileId: 'construction.stage@1' },
  'wrong-plot': {
    profileId: 'construction.stage@1',
    changed: {
      code: 'location',
      source: 'RULE',
      status: 'FAIL',
      namedField: 'plot',
      detail: { distance_m: 1400 },
      reason: 'wrong_plot',
    },
  },
  recycled: {
    profileId: 'construction.stage@1',
    changed: {
      code: 'novelty',
      source: 'RULE',
      status: 'FAIL',
      namedField: 'reused',
      detail: { matched_package_id: 'fixture_pkg_prior' },
      reason: 'reused_evidence',
    },
  },
  'wrong-stage': {
    profileId: 'construction.stage@1',
    changed: {
      code: 'classifier_label',
      source: 'MODEL',
      confidence: 0.5,
      status: 'UNCERTAIN',
      reason: 'stage_needs_review',
    },
  },
  'nonce-unreadable': {
    profileId: 'construction.stage@1',
    changed: { code: 'nonce', source: 'MODEL', confidence: 0.5, status: 'UNCERTAIN', reason: 'unreadable_nonce' },
  },
  'mock-location': {
    profileId: 'construction.stage@1',
    changed: { code: 'attestation', source: 'RULE', status: 'UNCERTAIN', reason: 'location_signal_needs_review' },
  },
  'freelance-missing-screen': {
    profileId: 'freelance.milestone@1',
    changed: {
      code: 'required_items',
      source: 'RULE',
      status: 'FAIL',
      namedField: 'missing:screen_contact',
      reason: 'missing_required_item',
    },
  },
});

export function createApp(config: AppConfig): Hono {
  if (!['local', 'ci', 'demo'].includes(config.appEnv) || config.paypalBaseUrl !== 'https://api-m.sandbox.paypal.com') {
    throw new Error('Only explicitly configured sandbox environments are supported');
  }
  const app = new Hono();
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      paymentReady: false,
      environment: config.appEnv,
      missing: missingPaymentKeys(config.paymentKeys),
      sentence: SETUP_GUIDANCE,
    }),
  );
  app.use('/v1/*', async (c, next) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) &&
      /^\/v1\/(allowances|tranches|payments)(?:\/|$)/.test(c.req.path)
    ) {
      return c.newResponse(
        JSON.stringify({
          type: 'urn:stood:problem:payments_not_configured',
          title: 'Payments not configured',
          status: 503,
          code: 'payments_not_configured',
          detail: SETUP_GUIDANCE,
        }),
        503,
        { 'Content-Type': 'application/problem+json' },
      );
    }
    await next();
  });
  if (config.demoMode) {
    app.post('/v1/demo/scenarios/:name', (c) => {
      const name = c.req.param('name');
      const scenario = Object.hasOwn(scenarios, name) ? scenarios[name] : undefined;
      if (!scenario) {
        return c.newResponse(
          JSON.stringify({ type: 'urn:stood:problem:not_found', title: 'Unknown scenario', status: 404 }),
          404,
          { 'Content-Type': 'application/problem+json' },
        );
      }
      const checks: CheckResult[] = getProfile(scenario.profileId).checks.map(({ code, source }) =>
        scenario.changed?.code === code
          ? scenario.changed
          : {
              code,
              status: 'PASS',
              reason: 'fixture_passed',
              ...(source === 'MODEL' ? { source, confidence: 1 } : { source }),
            },
      );
      const decision = decide(scenario.profileId, checks);
      const copy = recipientAssessment(decision);
      return c.json({
        ...decision,
        sentence: `${assessmentSentence(decision)} No payment was executed.`,
        sentences: {
          payer: `${copy.payer} No payment was executed.`,
          inspector: `${copy.inspector} No payment was executed.`,
        },
        checks,
        evidenceTier: 'fixture',
        source: 'synthetic_check_results',
        payment: { executed: false },
      });
    });
  }
  return app;
}
