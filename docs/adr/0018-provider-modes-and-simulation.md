# ADR-0018: Explicit provider modes and simulation boundaries

Date: 2026-10-05. Status: accepted for local implementation; sandbox qualification remains pending.

## Context

Stood and Yard must be buildable without provider keys. A mocked SDK method does not exercise OAuth, request serialization or provider HTTP responses. Real keys alone do not prove readiness or permit real-money production. The product owner requires fake, simulator and live implementations behind the same ports, without silent fallback.

## Decision

Each provider is selected explicitly as `fake`, `sim` or `live` in a server composition root. Missing or invalid configuration fails with a named, sanitised readiness error. The word `live` identifies an actual provider adapter; PayPal remains sandbox-only under ADR-0003 and the existing ground rules.

| Provider | Port / current boundary | Qualification still required |
|---|---|---|
| PayPal | PaymentExecutor, ProviderStatusReader, PayPalTransport; funding phases T-0154 | T-0222 simulator, T-0224 sandbox recordings |
| Runner | Runner report verifier, isolated execution T-0159/T-0164 | Signed execution and key rotation T-0197 |
| GitHub | Buyer repository and fixed-commit fetch T-0188 | T-0225 repository-scoped contracts |
| Render | Preview and handover T-0196 | T-0226 image identity, teardown, spend bounds |
| Secret store / KMS | Write-only credential intake T-0195 | T-0227 encryption and audited access |
| Email / notifications | Event-driven outbound delivery | T-0228/T-0213 recipient and idempotency tests |
| Object storage | Private evidence object references | T-0228 authenticated object contracts |
| Planner model | PlannerModel for Foreman T-0181 | T-0228 scripted and recorded reports |
| Search | Discovery T-0211, evidence index T-0032 | T-0228 tenant and scope tests |
| Browser QA | Qualified outside usage proof | T-0228 isolated Kernel execution |
| Stood for Yard | Public HTTP SDK and signed message verification | T-0229 full financial contracts |
| Crew endpoint | Y21 public contract, outside this repository | T-0231 simulator, external operator qualification |

Fakes are deterministic in-memory implementations. Simulators are isolated local HTTP servers with the provider's wire shape, scripted faults and an injected clock. Provider SDK source is unchanged; any endpoint redirection is explicit, bounded to a local simulator and never available in sandbox-provider mode. Simulators use synthetic identities and credentials only.

The same contract scenarios run against fake, simulator and qualified provider adapters. A pending, missing, malformed or contradictory response never becomes payment confirmation. Stateful simulator results are evidence of local compatibility only; published provider contracts and sanitised sandbox exchanges determine fidelity, not our assumptions. T-0224 remains required before claiming PayPal sandbox compatibility.

Production runtime source cannot import `/fakes/` or `/simulators/`. Test harnesses and separate local simulator packages may do so. Production release artifacts must contain neither implementation. Registry policy rejects mocked money or evidence in production and never falls back after a readiness failure. Current sandbox-only runtime boot restrictions still apply independently.

Health and public demo copy identify actual provider mode and `simulated` status without exposing keys. Synthetic demos stay synthetic even when a separate provider becomes configured. The two landing pages and README follow T-0235.

## Alternatives

SDK mocks alone are fast but miss the HTTP boundary. Running every test against the sandbox requires keys and cannot reliably reproduce lost responses. Automatically falling back from a provider to a fake conceals configuration failures and can invent payment results.

## Consequences and reversal

Full ports and runtime wiring remain incremental tasks, not implied by this ADR. Each adapter must bring its contract tests and honest health state. Simulator state is disposable, distinct from the durable payment ledger. Revisit when provider contracts change; update the simulator from sandbox evidence and retain failing scenarios. No provider endpoint or credential may be accepted from an untrusted API caller.
