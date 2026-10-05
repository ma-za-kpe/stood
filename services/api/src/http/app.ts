import { Hono } from 'hono';
import { missingPaymentKeys, type PaymentKeys, SETUP_GUIDANCE } from '../application/payment-readiness.js';
import type { ProviderHealth } from '../application/provider-registry.js';
import { assessmentSentence } from '../domain/assessment-sentence.js';
import { type CheckResult, decide, getProfile } from '../domain/decision.js';
import { Money } from '../domain/money.js';
import { Nonce } from '../domain/nonce.js';
import { recipientAssessment, trancheSentences } from '../domain/recipient-sentences.js';
import { Tranche } from '../domain/tranche.js';
import { type PlatformApiConfig, platformApi } from './platform-api.js';

export type AppConfig = Readonly<{
  appEnv: string;
  paypalBaseUrl: string;
  demoMode: boolean;
  paymentKeys?: PaymentKeys;
  api?: PlatformApiConfig;
  providerHealth?: () => readonly ProviderHealth[];
}>;

type Scenario = Readonly<{ profileId: string; changed?: CheckResult }>;
const codeScenarios: Readonly<Record<string, Scenario>> = Object.freeze({
  'code-good': { profileId: 'code.milestone@1' },
  'signed-tests-changed': {
    profileId: 'code.milestone@1',
    changed: {
      code: 'test_integrity',
      source: 'RULE',
      status: 'FAIL',
      namedField: 'signed_tests_changed',
      reason: 'signed_tests_changed',
    },
  },
  'tests-skipped': {
    profileId: 'code.milestone@1',
    changed: {
      code: 'test_execution',
      source: 'RULE',
      status: 'FAIL',
      namedField: 'tests_skipped',
      reason: 'tests_skipped',
    },
  },
  'weak-tests': {
    profileId: 'code.milestone@1',
    changed: { code: 'mutation_score', source: 'RULE', status: 'FAIL', namedField: 'weak_tests', reason: 'weak_tests' },
  },
  'usage-pending': {
    profileId: 'code.final@1',
    changed: { code: 'usage_release', source: 'RULE', status: 'UNCERTAIN', reason: 'usage_pending' },
  },
});

// Site-visit scenarios (and the secondary freelance fixture), retained for compatibility.
const siteVisitScenarios: Readonly<Record<string, Scenario>> = Object.freeze({
  good: { profileId: 'construction.stage@1' },
  'substituted-fitting': {
    profileId: 'construction.stage@1',
    changed: {
      code: 'classifier_label',
      source: 'MODEL',
      confidence: 0.95,
      status: 'FAIL',
      namedField: 'fixtures',
      reason: 'fitting_needs_review',
    },
  },
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
      providers: config.providerHealth?.() ?? [],
      missing: missingPaymentKeys(config.paymentKeys),
      sentence: SETUP_GUIDANCE,
    }),
  );
  if (config.api) {
    const api = platformApi(config.api);
    app.use('/v1/*', async (c, next) => {
      if (!/^\/v1\/(allowances|tranches)(?:\/|$)/.test(c.req.path)) return next();
      const url = new URL(c.req.url);
      url.pathname = url.pathname.slice(3);
      const response = await api.fetch(new Request(url, c.req.raw));
      if (
        response.status !== 404 ||
        (c.req.method === 'GET' && /^\/v1\/(allowances(?:\/[^/]+)?|tranches\/[^/]+)$/.test(c.req.path)) ||
        /^\/v1\/tranches\/[^/]+\/packages(?:\/[^/]+)?$/.test(c.req.path)
      )
        return response;
      return next();
    });
  }
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
    app.get('/v1/demo/scenarios', (c) =>
      c.json({
        default: 'signed-tests-changed',
        code: Object.keys(codeScenarios),
        site_visit: [
          ...Object.keys(siteVisitScenarios).filter((name) => name !== 'freelance-missing-screen'),
          'funding-declined',
          'hold-expiry',
        ],
        freelance: ['freelance-missing-screen'],
        evidenceTier: 'fixture',
        payment: { executed: false },
      }),
    );
    app.post('/v1/demo/scenarios/:name', (c) => {
      const name = c.req.param('name');
      if (name === 'funding-declined' || name === 'hold-expiry') {
        const tranche = new Tranche('fixture_lifecycle', new Money(400000n, 'GBP'), 'construction.stage@1', 1);
        const at = 1790985600000;
        const expiry = at + 29 * 86400000;
        if (name === 'funding-declined') tranche.fundingFailed();
        else {
          tranche.dispatch('fixture_auth', new Nonce('K7Q'), at, expiry);
          tranche.expire(expiry);
          // Simulated provider proof, not a real cancellation or a clock-only confirmation.
          tranche.settlementFailed({
            effect: 'VOID',
            authorizationId: 'fixture_auth',
            kind: 'AUTHORIZATION_EXPIRED',
            reference: 'fixture_expiry',
          });
        }
        const copy = trancheSentences(tranche, expiry);
        const sentences = {
          payer: `${copy.payer} No payment was executed.`,
          inspector: `${copy.inspector} No payment was executed.`,
        };
        return c.json({
          scenario: 'site_visit',
          outcome: 'WAIT',
          effect: 'NONE',
          namedField: name === 'funding-declined' ? 'funding' : 'expired',
          state: tranche.state,
          settlement: tranche.settlement,
          sentence: sentences.payer,
          sentences,
          evidenceTier: 'fixture',
          source: 'synthetic_domain_transitions',
          payment: { executed: false },
        });
      }
      const codeScenario = Object.hasOwn(codeScenarios, name);
      const scenario = codeScenario
        ? codeScenarios[name]
        : Object.hasOwn(siteVisitScenarios, name)
          ? siteVisitScenarios[name]
          : undefined;
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
      // Only this synthetic endpoint knows no provider call was made. Assessment copy alone cannot say this.
      const money = codeScenario && decision.outcome === 'REFUSE' ? ' Nothing was paid.' : '';
      return c.json({
        ...decision,
        scenario: codeScenario
          ? 'code_milestone'
          : scenario.profileId === 'freelance.milestone@1'
            ? 'freelance'
            : 'site_visit',
        sentence: `${assessmentSentence(decision)}${money} No payment was executed.`,
        sentences: {
          payer: `${copy.payer}${money} No payment was executed.`,
          inspector: `${copy.inspector} No payment was executed.`,
          ...(codeScenario ? { builder: `${copy.inspector} No payment was executed.` } : {}),
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
