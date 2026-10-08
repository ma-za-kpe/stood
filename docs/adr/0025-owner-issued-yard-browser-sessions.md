# ADR-0025: Owner-issued browser sessions for the hosted Yard pilot

- Status: accepted for the hosted sandbox pilot
- Date: 2026-10-08
- Tasks: T-0266, T-0267

## Context

The hosted Board already authenticates signed operator requests. The local browser helper selects a synthetic buyer or builder; mounting it on Render would grant any visitor that identity. The owner requested a private hosted app before live planner integration. Existing operator configuration, signed-request proxy, session-generation guards and private intake storage can be reused without adding an identity service.

## Decision

For this single-instance sandbox pilot, the owner generates an unpredictable access code per operator and shares it privately. The browser exchanges that code for an opaque, eight-hour session cookie: Secure, HttpOnly, SameSite=Strict, scoped to `/app/api`. Mutations require the configured page origin. Session responses are private/no-store; failed guesses and in-memory entries are bounded. Signing secrets remain server-side; the proxy uses the existing signature-v2 contract and path allow-list. Retired operators cannot sign in or retain access. Sign-out removes server session and private query state.

The release image serves the app from `/app/` with a strict CSP. Its directory URL redirects before relative assets resolve. The production runtime never mounts the local role picker. Tests reuse Chromium, axe and disposable Postgres, with synthetic test codes and no deployed database or payment keys.

## Alternatives

A new external identity provider would add an account, dependency and migration before a pilot login is needed. Public role selection would grant the wrong authority. Neither is adopted here.

## Risks and controls

An access code is a bearer secret; the owner must distribute it privately. Sessions are held in memory; restarts sign everyone out. The design supports one service instance, not a multi-instance public identity system. Rotation changes the configured code and deploys, revoking existing sessions. Imported research remains untrusted data; it cannot grant identity, consent or payment authority.

## Reversal

Before public self-registration, multiple service instances or real-money operation, replace code distribution with a qualified identity provider and shared revocable session storage. Preserve server-owned operator identity and the same signed-command boundary.
