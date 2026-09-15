# Bantai

A test-case authoring swarm. Upload the requirement documents for a product, and ten
agents plan the testing and write the suite: an architect who decomposes the problem,
eight specialist writers, and a reviewer who dedupes the result and closes the gaps.

## How a run works

1. **Ingest** — pdf, docx, md, txt, csv, json, yaml and html are parsed to text.
2. **Requirements** — the corpus is broken into atomic, numbered, testable requirements
   (`REQ-001…`). Everything downstream is traceable to these.
3. **Test architect** — writes the plan (risk areas, entry and exit criteria) and a brief
   for each specialist: what to focus on, which requirements it owns, how many cases to
   aim for, and what to leave to another agent.
4. **Wave 1** — sanity, smoke, unit and functional run in parallel. They depend only on
   the plan, so there is nothing to serialise.
5. **Wave 2** — edge cases, monkey, creative and adversarial run next, each holding the
   titles of everything wave 1 wrote. That digest is what stops the second wave
   re-deriving cases the first wave already has.
6. **Reviewer** — flags duplicates, computes requirement coverage, and lists per-suite
   gaps. Any suite with gaps gets one targeted repair pass — the agent is re-invoked with
   only the gap list, not the whole brief.
7. **Export** — CSV, Markdown, JSON, Jira/Xray CSV, TestRail CSV.

## The plan gate

A run does not go straight through. It extracts requirements, writes the plan, and then
**stops**, before any writer agent has spent anything. You read the briefs — what each
agent will focus on, which requirements it owns, how many cases it intends to write, and
what it has been told to leave to someone else — and then choose:

- **Run the rest** — everything from here to the export, no further stops.
- **Run next stage only** — execute one stage, then pause again.

Stages are `requirements → plan → wave1 → wave2 → review`. Each one persists its results
before returning, which has two consequences worth knowing: a paused run survives a
server restart and can be resumed exactly where it stopped, and the projected case count
is visible before you commit to paying for it.

Cancelling from a pause closes the run out rather than leaving it waiting forever.

## The eight disciplines

| Agent | Wave | Writes |
|---|---|---|
| Sanity | 1 | One shallow pass per capability, happy path only |
| Smoke | 1 | Cross-feature journeys and integration seams — the release gate |
| Unit | 1 | Function, validator and state-machine level, every branch and rule |
| Functional | 1 | Every acceptance criterion, across the valid range of usage |
| Edge cases | 2 | Boundaries, empty states, time, concurrency, scale, unicode |
| Monkey | 2 | Rapid, out-of-order, garbage input; hostile environments |
| Creative | 2 | Persona-driven journeys the spec never modelled |
| Adversarial | 2 | Authorisation, client-trust, data integrity, injection |

Each agent's charter lives in [`src/lib/agents/roster.ts`](src/lib/agents/roster.ts) —
that file is where you tune what a discipline means for your team.

## Running it

```bash
npm install && npm run dev
```

Before the first start, set `SUPERADMIN_EMAIL` in `.env.local` (see `.env.example`).
While no admin exists, each start prints a one-time setup link for that address to the
server log — open it, set a password, and you're the super admin. No email provider is
needed for this, locally or deployed.

Tests cover the logic that is hardest to get right — recovering truncated, fence-wrapped
and prose-wrapped model output, parsing `Retry-After`, password hashing, at-rest
encryption, and the account and tenancy rules:

```bash
npm test
```

Then open **Settings**, pick a provider and paste a key, create a project, upload
documents, and click **Generate test cases**.

`examples/sample-prd.md` is a small checkout spec you can use to try a run.

## Accounts and tenancy

- **Invite-only.** A super admin invites people by email from `/admin`; there is no
  public signup. Invite links work once and expire after 7 days. Without
  `RESEND_API_KEY`, the admin page shows the link to pass on by hand.
- **A workspace is the tenant.** Everyone gets one at signup. Projects, documents, runs
  and the product model belong to it, and every API route checks that the caller belongs
  to the workspace that owns what they asked for. Someone else's project and a project
  that doesn't exist both answer 404, so ids can't be probed.
- **Super admins manage accounts, not data.** They invite, disable and re-enable people,
  but can't see anyone else's projects.
- **Keys are per workspace and encrypted at rest** (AES-256-GCM, keyed from
  `APP_SECRET`). Optionally, `PLATFORM_API_KEY` gives workspaces with no key of their own
  a daily-capped allowance on a model you choose.
- **Sessions** are random tokens in an httpOnly, SameSite=Lax cookie; only a hash is
  stored. Mutations are checked against `Origin` / `Sec-Fetch-Site`, and login, reset and
  invite endpoints are rate-limited. Invite and reset tokens travel in the URL fragment,
  so they never reach a server log.

Existing single-user installs upgrade in place: the first super admin to sign up inherits
every project and saved key from before accounts existed, with the keys re-encrypted.

## Hosting

Bantai needs one long-running Node process and a persistent disk — runs last minutes,
report over SSE, and the database is SQLite. Serverless platforms (Vercel, Netlify) don't
fit; a container host with a volume (Railway, Fly.io, Render, a VPS) does. Mount a
volume, point `BANTAI_DATA_DIR` at it, set the variables in `.env.example`, and run
`npm run build && npm start`.

## Providers

| Provider | Structured output | Effort control | Catalogue |
|---|---|---|---|
| OpenRouter | `response_format` json_schema, `strict` | `reasoning.effort`, three levels | public |
| Anthropic | `output_config.format` json_schema | `effort`, five levels | needs key |
| Google Gemini | `responseJsonSchema` + `application/json` | `thinkingLevel`, four levels | needs key |

**OpenRouter is the default.** One key reaches Claude, Gemini, GPT, DeepSeek, Qwen and
open models, which avoids setting up each vendor separately. The model picker lists only
models advertising structured-output support — around 330 of the 418 on offer — because
every agent here depends on it, and it shows output price per million tokens so the cost
of a run is visible before you start it. That catalogue is public, so the picker works
before you save a key.

Two provider-specific details worth knowing:

- Strict schema mode accepts only a subset of JSON Schema. `minItems`, `minimum` and
  `maximum` are rejected rather than ignored, so they are stripped for OpenRouter only —
  the canonical schemas in `src/lib/agents/schemas.ts` stay expressive for providers that
  accept them.
- Not every model behind OpenRouter honours `json_schema` even when it advertises it. On
  rejection the request retries once with `json_object` and the schema inlined into the
  system prompt.

You can keep a key for each and switch between them; the selected model is remembered
per provider, so flipping back does not lose your choice. The model field is free text
with a live list from your account, so a model released after this app was built still
works — nothing here hardcodes a model line-up that will go stale.

Effort is one five-step scale across providers. Gemini exposes four thinking levels, so
`xhigh` and `max` both map to its highest.

### Agents at once

A wave contains four agents. Running all four together is fastest, but free tiers reject
bursts and every suite fails with a rate-limit error. **Agents at once** in settings caps
how many run concurrently — drop to 1 or 2 on a free tier. Rate-limit retries honour the
provider's `Retry-After` header and back off rather than retrying immediately.

### Adding another provider

Implement [`Provider`](src/lib/providers/types.ts) — `json`, `verifyKey`, `listModels` —
and register it in [`src/lib/providers/index.ts`](src/lib/providers/index.ts). The
provider returns raw JSON text; parsing, schema validation and retry are handled once in
[`src/lib/llm.ts`](src/lib/llm.ts), so a new provider gets that behaviour for free.
Nothing in the agents, the orchestrator or the UI is provider-aware.

## Layout

```
src/lib/agents/roster.ts     charters — the prompt content that defines each discipline
src/lib/agents/planner.ts    requirement extraction and the test plan
src/lib/agents/writer.ts     the shared suite writer, plus the wave 2 coverage digest
src/lib/agents/reviewer.ts   dedupe, coverage arithmetic, gap detection
src/lib/orchestrator.ts      the stage machine: one stage per invocation, resumable
src/lib/llm.ts               provider-agnostic structured call, parse and retry
src/lib/providers/           one file per provider, behind a single interface
src/lib/settings.ts          per-provider keys and models, with legacy migration
src/lib/json-salvage.ts      recovery of truncated or wrapped model output
src/lib/export.ts            the five export formats
src/lib/store.ts             node:sqlite persistence — no native build step
```

## Notes

- Runs report over SSE. Reloading the page reattaches to a run in flight; the event
  backlog is replayed so nothing is missed. Because each stage persists before it
  returns, a paused run is held in the database rather than in memory and survives the
  process dying.
- Free tiers rate-limit hard, and a wave fires four agents at once. If suites fail with
  rate-limit errors, that is the cause — a pinned paid model at a few cents per run
  avoids it.
- A failed specialist does not fail the run — it is marked failed and the other agents
  continue. Only a failed extraction or plan aborts everything.
- CSV exports neutralise leading `=`, `+`, `-` and `@` so a payload written by the
  adversarial agent cannot execute when the export is opened in a spreadsheet.
- Billing and quota failures are translated into plain language. Both providers return
  them under status codes that otherwise read as request bugs (Anthropic: 400,
  Gemini: 429), which sends you looking in the wrong place.
