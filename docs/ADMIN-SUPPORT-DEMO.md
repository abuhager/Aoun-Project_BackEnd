# Admin operations, private support, and portfolio demo

## Behavior

- Settings → `donationRequestsEnabled` defaults to true. When false, every donation-request endpoint returns `403 DONATION_REQUESTS_DISABLED`. Existing records remain stored. Item donations, bookings, and their chats continue normally. Background expiration policies are unchanged.
- Admin items now include the booking user, booking date, and ordered waitlist with profile links. These fields are exposed through the authenticated admin DTO only.
- `POST /api/admin/users/:id/conversation` opens a private administrative thread without requiring an item booking. Knowing a conversation ID or having an admin role does not grant access to other participants' private messages.
- `POST /api/support` takes `{ subject }` and opens/reopens one support thread per user. Users send the problem details through the existing Socket.IO chat.
- `GET /api/support?page=1` returns the user's own ticket metadata, for every signed-in account, including admins. `GET /api/support/inbox?page=1` exposes the administrative inbox behind requireAdmin. The inbox never returns message bodies.
- `POST /api/support/:id/claim` assigns the thread to an admin using an atomic owner comparison. Another active real admin's assignment cannot be stolen. A ticket whose assigned account is unavailable, demoted, or a demo can be reclaimed.
- `POST /api/support/:id/resolve` is restricted to the assigned admin. Resolved support is readable; sending is rejected until reopened.
- Administrative chat openings, support claims, and support resolutions are recorded in the append-only audit log in the same transaction as the change. Audit failures abort the operation.
- New chat kinds reuse the existing message pagination, participant checks, unread counts, and Socket.IO delivery. Booking eligibility is unchanged for old conversations.

## Demo account

Set `DEMO_ADMIN_EMAIL` on the backend to the SAME email configured on the frontend, or persist `isDemo: true` on the intended account. The flag is resolved from the database/configuration, never from client input or token role claims. The demo keeps its admin role for browsing.

Authenticated POST/PUT/PATCH/DELETE requests are blocked centrally with `403 DEMO_READ_ONLY`, except logout. Socket sending and read receipts are also blocked; joining rooms only reads history. Login, token refresh, and logout still maintain authentication sessions. Password-reset requests do not enqueue emails for demo accounts.

The existing mock seed marks `mock.admin@aoun.test` as demo and includes a sample support thread. **Do not run the reset seed against an existing/live database.** It is only for a separately provisioned disposable showcase database. Use synthetic users in a public portfolio deployment: read-only permissions do not anonymize existing data.

Keep a separate real admin account; never configure its email as `DEMO_ADMIN_EMAIL`.

## Coordinated rollout

1. Deploy backend changes in a maintenance window, before enabling new conversations.
2. Run `npm run db:indexes`, then `npm run db:indexes:verify` with the target database configuration. The existing index utility replaces the old unconditional `(item, owner, requester)` unique index with an ObjectId-only partial index, and adds the partial unique `threadKey` index. Existing booking records need no rewrite. This index migration is required before support/direct threads can coexist.
3. Set backend `DEMO_ADMIN_EMAIL` or the persisted demo flag, restart backend processes to clear cached identities, then deploy the frontend.
4. Check real-admin setting changes, booking queue visibility, private contact, support claim/reply/resolve/reopen, and the demo's blocked writes on staging before production traffic.

A rollback to old application code after support threads are created is unsafe without excluding these item-less threads and reviewing indexes first.

## Validation in this change

Backend `npm run verify` passes: typecheck, 212 passing unit/contract tests with one pre-existing integration skip, and production TypeScript build. New tests cover demo API/socket denial, real-admin write allowance, feature gating, support privacy, concurrent claim conflict, assigned-owner resolution, and queue ordering. The mock dataset is schema-validated without writing it to a database.

No live database migration, seed, user messaging, or production deployment was performed. A live MongoDB/Socket.IO end-to-end run remains a staging check.
