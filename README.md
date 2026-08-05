# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout and then validates the Sites artifact. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build, validate, and verify the rendered development-preview metadata
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build and validation commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
## Governance & descent-reliability additions (v41 · 2026-08)

### Trusted anonymous identity
`app/network-identity.ts` issues a persistent device-bound bearer key
(localStorage), replacing the day-scoped actor key in shared-network payloads.
Its public face is the server-derived `kc-xxxxxxxx` tag; the key itself never
appears in any public payload. This is what makes retraction ownership,
blocking and rate limiting hold together across days.

### Governance backend (`lib/governance.ts`, `lib/moderation.ts`)
New D1 tables ride the existing idempotent bootstrap: `network_authors`,
`network_reports`, `network_blocks`, `moderation_items`, `audit_log`,
`place_cache`. On POST, bodies are classified: contact info / spam → rejected;
hostile → stored `pending_review` (visible only to the author until a human
approves); crisis language → **stays visible** and is auto-escalated for
priority human review — a person reaching out is never silently muted. GET
filters per viewer (banned authors globally, blocked authors per blocker) and
labels self-visible in-review items via `reviewStatus`.

API: `DELETE /api/network` (author retraction), `POST /api/report`,
`POST /api/block`, `GET/POST /api/admin/moderation` (disabled until the
`KINDCHAIN_ADMIN_TOKEN` env var ≥16 chars is set; authenticate with the
`x-kindchain-admin` header; decisions and author bans are audit-logged).
`/api/place` now caches Nominatim results in D1 for 30 days and answers with a
named built-in continent/ocean hierarchy instead of 503 when the geocoder is
unreachable.

### Map descent readiness (P0 root cause)
`revealMap()` previously ran unconditionally 900 ms after mount, so the
descent could claim readiness over a fully failed tile layer — the exact
empty-dark-layer failure in the v40 audit screenshot. The descent now probes
an OSM tile on the same network path first: probe ok → reveal as before;
probe fails → the honest "online map still arriving" state with the built-in
atlas, plus an explicit Back-to-Earth / zoom toolbar either way.

### Frontend governance UI
The story panel shows a fact label (LIVE NETWORK / IN REVIEW / DEMO) and, for
shared content, report (5 reasons), block-author, or withdraw-own-light
actions wired to the new API.

### Tests
`npm run test:unit` — 18 governance/moderation tests (better-sqlite3 shim runs
the production SQL verbatim). `npm test` chains unit tests, the production
build, artifact validation and the original 33-test suite.

## v42 · Community map & "Light this community" (2026-08)

- **OpenFreeMap community layer** (free, keyless, non-profit hosted): the
  descent still boots from the guaranteed raster composite; ~1.5 s later the
  Liberty vector style is fetched (4.5 s timeout) and adopted only after its
  JSON has arrived and the style is verifiably live in the map. Esri satellite
  rides on top as a veil that is strong at province/city scales and fades out
  by z8.2, revealing crisp streets, names and boundaries at community scale.
  Building footprints, house numbers and POI layers are force-hidden (privacy
  floor). Wholesale tile failures after adoption revert to the raster
  composite; a failed fetch changes nothing.
- **"照亮这片社区" / Light this community**: a map-toolbar action that opens
  the pinned compose flow targeting the current map centre (coarsened to the
  0.1° grid) and publishes into the real shared network through the v41
  governance pipeline.
- The domain test that previously banned tiles.openfreemap.org now asserts the
  new contract instead: raster-first boot, adopt-only-after-arrival, and an
  explicit revert path.
