# Shared Stood scenarios

The JSON files define deterministic inputs, named steps and expected money state independently of a provider adapter. `scenario-contract.ts` validates and freezes each definition and compares domain, ledger and provider state/reference evidence. `runScenario` dispatches only known step names; no arbitrary domain method can be selected by a file.

`AUTHORIZE_FIXTURE` and `ASSESS_FIXTURE` explicitly mean synthetic setup and synthetic check results. They do not demonstrate the payer-approval API, a signed runner or a live financial HTTP surface. Sandbox drivers, Yard flows, browser page objects and the full expected event timeline are still planned. The initial mock integration driver exercises real Postgres and HTTP where the public interfaces already exist, keeping these gaps visible.

Every mock response must stay labelled simulated. Any future sandbox driver consumes these same definitions but must report its own evidence mode and qualified provider exchanges; these fixture files alone are not sandbox evidence. No driver may execute real money.
