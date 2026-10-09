# Full review corrections — 2026-10-09

| Review | Implemented correction | Verification |
|---|---|---|
| R01 | Settings PATCH includes the donation request feature switch | Browser switch-only/mixed save + real API/audit/feature gate |
| R02 | Persisted `trustLevelOverride` overrides student/phone evidence; login, re-registration, email activation and profile writes honor the current DB override atomically; phone verification uses a retryable transaction | Demote → login → refresh → phone → promote; stale upgrade/profile write; pending email activation |
| R03 | Offer acceptance uses sequential session queries and `runMongoTransaction` retries | Real competing accepts and hub deactivation race |
| R04 | A banned recipient passes a public booking to the first eligible waiter. A banned donor hides the public item. Request-linked exchanges cancel Request/Offer and hide Item; conversations are archived. Notifications publish after commit | Real queue and both request-linked ban cases; audit rollback |
| R05 | Shared job state, last-success time, consecutive failures and overdue booking age. Separate `/health/jobs` business probe and Prometheus gauges | Health policy tests + shared leader state integration |
| R06 | Stale exhausted processing events move to `dead` with `OUTBOX_EXHAUSTED_DELIVERY_UNKNOWN` | Stale versus live final-attempt locks with MongoDB |
| R07 | Named switches, associated input labels/descriptions, stable chat label; numeric drafts resync after conflict reload | DOM assertions, keyboard switching, targeted axe rules |
| R08 | Dashboard exposes actual active bookings / limit and all requests created this Amman month / limit. Remaining counts and eligibility come from the API. Actions and Socket lifecycle events refresh these counts; failed refresh hides stale allowances | Rendered card, browser cancellation/failed refresh + real booking quota race |
| R09 | Node 24 LTS declared in both engines, `.node-version` and CI | Build/typecheck/unit/integration and browser CI |
| R10 | Real API/Socket/DB use-case suite + browser settings and paired full-stack frontend suite | Synthetic loopback-only replica set and isolated Redis |
| R11 | Fixed-TTL bounded LRU session cache; next-unrated-item aggregation returns at most one result with stable order and indexed rating lookup; support inbox compound indexes | Cache stress/TTL, two-party rating integration and index verification |

## Product rules

Administrative promotion/demotion remains authoritative until the next administrative decision. Email/student/phone verification facts are preserved. The monthly request limit counts every request created that month, including cancelled/expired requests, matching the existing creation service. Quota reward fields remain legacy accounting information; no new spending rule was added.

For request-linked moderation, an unfinished exchange is cancelled and archived rather than placed in public bookings. Already-delivered exchanges retain their history. Ordinary `admin` can inspect settings; `super_admin` can save them. Demo identities are enforced as read-only by the backend and Socket handlers.

## Deployment

1. Use Node 24 LTS on Render and Vercel. Both repositories declare Node 24; CI reads `.node-version`.
2. Apply the additional indexes with `npm run db:indexes`, then `npm run db:indexes:verify`. On Render without Shell, temporarily use `MONGO_SYNC_INDEXES_ON_STARTUP=true`, deploy once, confirm the index success log, then reset it to `false`. Keep `MONGO_INDEXES_REQUIRED=true`.
3. For administrative trust decisions made before this release, run `npm run db:trust:check`. It previews counts without printing account data. If legacy decisions exist, `npm run db:trust:apply` restores the most recent recorded administrative decision, skips accounts that already have an override, and invalidates affected sessions. Records with no administrative decision retain the normal policy.
4. Deploy backend first, then frontend. Exercise feature toggling, queue promotion after a synthetic ban, private support and the read-only demo with synthetic accounts.

No production settings or data are modified by the tests. `test:seed:e2e` explicitly requires `NODE_ENV=test`, loopback MongoDB and database `aoun_review_e2e`. The integration suite uses its own `aoun_review_ci_<pid>` database.

## Monitoring

Use `/health/live` for process liveness and `/health/ready` for HTTP routing. `/health/jobs` returns 503 for unhealthy business jobs, and `/health/ready` includes the degraded job state without causing a restart loop. Observations cache for at most 30 seconds. Shared MongoDB job results prevent idle followers from reporting false failures.

The hourly job success threshold is two hours, the monthly reset threshold is 35 days; a failed run, two consecutive failures, a run longer than 30 minutes, a missed due time plus 20 minutes, or an expired-booking backlog older than two hours produce explicit reasons. Protect `/metrics` with `METRICS_TOKEN` in production and attach the supplied alert rules to the monitoring system.

Outbox events with unknown delivery outcome require operator review: the provider might have acted before the worker stopped. Do not automatically replay email events, because this can duplicate delivery. Cloudinary deletion is generally idempotent, but review the stored event first.

## Limits

Tests establish behavior on synthetic data and local/CI infrastructure. They do not establish production capacity, external alert delivery, production runtime settings, backup restoration or a complete accessibility certification. The axe suite specifically covers form names and ARIA validity in the corrected settings screen.

## Verification performed locally

On 2026-10-09, backend typecheck and production build passed; its test run reported 228 passed, zero failures and two skipped integration suites. Frontend lint/typecheck and all 127 tests passed; its production build and 18 critical Playwright browser cases passed. Production dependency audits reported zero vulnerabilities in both repositories.

The real MongoDB suites ran successfully in [Backend CI](https://github.com/abuhager/Aoun-Project_BackEnd/actions/runs/37983059541): 241 tests passed with zero failures or skips, including real HTTP/Socket scenarios, index verification and dependency audit. They remain unavailable locally because this workspace has no isolated MongoDB/Redis. The local browser check used a temporary Chromium executable with the production frontend and mocked API; no production accounts, settings or data were used.

Paired full-stack browser cases are configured in frontend CI and must pass before the frontend merge. Production indexes, historical trust backfill, deployment runtime changes and attaching external alert rules are separate deployment operations and have not been performed by these tests.
