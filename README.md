# Aoun Backend

The backend service for **Aoun**, a donation coordination platform built with Node.js, Express, MongoDB, and Socket.IO. It provides REST APIs and real-time events for donation items, needs and offers, bookings, handovers, conversations, notifications, profiles, reports, and administration.

> Current status: the core product flows are complete. The project is undergoing cleanup, testing, and production-readiness work before a limited pilot. This repository does not ship demo credentials or a database-wiping seed script.

## Requirements

- Node.js 20.19 or newer
- Local MongoDB or MongoDB Atlas
- Cloudinary for image uploads
- Brevo for account verification and password-reset emails
- Redis for shared rate limiting when production runs more than one server instance

## Local setup

```bash
npm ci
npm run dev
```

On Windows PowerShell:

```powershell
npm run dev
```

Create a local `.env` file before starting the service. The required keys are validated centrally in `config/env.js`; configure MongoDB, authentication secrets, allowed origins, Cloudinary, and Brevo before testing flows that depend on them.

## Verification

```bash
npm run verify
```

- `check` performs a syntax check across every current JavaScript file.
- `test` runs contract, flow, security, and regression tests.
- `verify` runs both checks in sequence.
- `db:indexes` synchronizes the required MongoDB indexes using the active environment.

## Project structure

```text
app.js / server.js       Express composition and HTTP/Socket.IO startup
config/                  Environment, MongoDB, CORS, and Cloudinary
controllers/             HTTP request handlers
dtos/                    Privacy-safe response contracts
integrations/            Active third-party integrations
jobs/                    Scheduled background jobs
middlewares/             Authentication, validation, security, and uploads
models/                  Mongoose schemas
repositories/            Data access
routes/                  REST routes
services/                Business rules
socket/                  Authentication, contracts, and real-time chat
test/                    Flow and regression tests
utils/                   Shared utilities
```

## Environment variables

Local values belong in `.env`, while hosted values belong in the deployment platform's environment settings. Never commit `.env`, API keys, secrets, or runtime credentials. `config/env.js` is the source of truth for required variables and production validation rules.
