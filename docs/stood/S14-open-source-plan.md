# S14: Open-source plan: "how we used every tool"

**Goal:** the repo isn't just the code, it's a **lesson other builders can copy**: how to give a coding agent the right context (MCP and skills) for each sponsor, and how to give each tool *one* honest job at run-time.

## Licence

- Our code is **MIT** (or Apache-2.0). The hackathon requires a public repo with a licence file.
- **Commercial dependencies** (AG Studio / AG Grid Enterprise, Bryntum) are installed from their registries with a **trial or hackathon licence key supplied via env var**. **Never commit their packages or keys.** Say this clearly in the README so learners can reproduce it legally.

## Repo layout (planned; no code yet)

```text
stood/
├─ README.md                  ← the story + "5 MCPs, 5 jobs" table
├─ LICENSE
├─ .mcp.json                  ← the build-time MCP setup, committed (no secrets)
├─ .claude/skills/            ← Bryntum + APIMatic skills, vendored or linked
├─ openapi/stood.yaml         ← Stood's API (source for the APIMatic SDK / portal / MCP)
├─ apps/
│  ├─ web/                    ← Allowance, Decision, Receipt, Dispute, Reviewer (AG Studio), Gantt (Bryntum)
│  └─ capture/                ← the field inspector’s PWA (offline queue, nonce, in-app camera)
├─ services/
│  ├─ api/                    ← the gate (Render)
│  ├─ workflows/              ← Render Workflows: dispatch→authorise→checks→capture|void|wait
│  ├─ evidence-agent/         ← astropods.yml: vision checks, NO PayPal credentials (Astropods)
│  ├─ evidence-index/         ← Elastic mappings + seeding scripts
│  └─ approver/               ← Kernel: headless PayPal sandbox buyer approval
├─ zaps/                      ← exported Zap definitions + message templates (Zapier)
├─ fixtures/                  ← code-good / signed-tests-changed / tests-skipped / weak-tests / usage-pending; field scenarios separate
├─ postman/                   ← public collection to replay every outcome
└─ docs/
   ├─ (these research and product docs)
   └─ sponsors/
      ├─ paypal.md  apimatic.md  ag-studio.md  bryntum.md  channel3.md  render.md
      ├─ astropods.md  elastic.md  kernel.md  postman.md  zapier.md
      └─ LESSONS.md
```

## `.mcp.json` (the build-time setup to publish)

| Server | Endpoint / command | Purpose |
|---|---|---|
| paypal | `https://mcp.sandbox.paypal.com` | PayPal sandbox tools and docs while building |
| apimatic | `npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview` (skills, pin the commit) | Correct PayPal Server SDK calls (TypeScript skills) |
| ag-grid | `npx ag-mcp` | AG Grid / AG Studio docs and examples |
| bryntum | `https://mcp.bryntum.com` (HTTP) | Bryntum docs, plus the skills repo |
| channel3 | `https://mcp.trychannel3.com` | Product lookup and image search while prototyping the spec check |
| render | `https://mcp.render.com/mcp` | Deploy, logs, metrics, Postgres |
| elastic | Agent Builder MCP endpoint of our deployment (Kibana) | Evidence index tools |
| zapier | personal Zapier MCP URL (from zapier.com/mcp) | Wiring notification actions |
| postman | Postman MCP server | Workspace, collections, monitors |
| kernel | Kernel API / SDK (MCP if offered, to confirm) | Browser sessions for sandbox approval |
| astropods | Astropods Claude plugin + CLI | Deploying the evidence agent |

Note: exact endpoint and command strings are confirmed when the file is written. Keys come from env.

## Template for each `docs/sponsors/<tool>.md` page

1. **What the tool is**, in one sentence.
2. **Build-time:** which MCP or skill, how it's configured, **one before/after** example of the agent getting something wrong without it and right with it.
3. **Run-time:** the one Stood call or screen that uses it, with a screenshot and a 30–60s clip.
4. **What we refused to use it for, and why.** This is the most useful part for learners.
5. **Gotchas:** licensing, locale limits, alpha features, rate limits.
6. **Copy this:** a minimal snippet another project can reuse.

## Lessons log

Keep a running `docs/sponsors/LESSONS.md` during the build: date, tool, what the agent got wrong, what fixed it. That turns into the blog post / Devpost "what we learned" section for free.
