# CareTrack — healthcare medication management MVP

CareTrack is a functional demonstration project for medication records, prescription management, dose tracking, patient-controlled caregiver access, sourced medication checks, alerts, and nearby facility search. It is not a clinical service. Use only synthetic demo data.

## Implementation status against the supplied project brief

| Area | Status |
| --- | --- |
| Node/Express/Mongoose backend, validation, error responses, security headers, rate limits | Implemented |
| Registration/login, bcrypt password hashing, database-backed sessions, role checks | Implemented and exercised against an isolated local MongoDB; deployment needs a configured database |
| Patient profiles, allergies, history, prescriptions, audit history | Implemented |
| Doctor verification and patient-authorized record access | Implemented, including an administrator review screen |
| Caregiver access, permission changes, revocation, in-app notifications | Implemented |
| Dose generation, history, status transitions, adherence, missed-dose monitoring | Implemented |
| Medication checks using RxNorm, patient-recorded allergies, and FDA label text | Implemented as a clearly limited prototype, not a comprehensive interaction checker |
| Facility lookup using OpenStreetMap services | Implemented; requires internet access and may be unavailable or incomplete |
| Responsive dashboard, medication catalog, dose calendar, Leaflet facility map, prescription cards/wizard, and mobile navigation | Implemented |
| Hashed, 15-minute password-reset codes with a five-attempt limit, delivered by configured SMTP | Implemented |
| Opt-in SMTP email and Twilio SMS notification delivery | Implemented; requires provider configuration |
| Paginated list APIs and patient-facing activity history | Implemented |
| Utility tests and focused MongoDB-backed API integration checks | Implemented |
| Exhaustive API integration coverage, clinical-grade interaction data, and production notification operations | Remaining / not included |

This is an engineering status summary, not a clinical readiness or production-readiness claim. The integration suite is focused rather than exhaustive, and the interaction checker remains a limited prototype. Configure and validate messaging providers before enabling external delivery.

## Requirements

- Node.js 20.6 or later (Node.js 22+ recommended)
- pnpm
- MongoDB local or hosted connection
- Internet access for RxNorm, openFDA, and OpenStreetMap lookups

## Run on Windows PowerShell

From the project folder:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
notepad .env
```

Set `MONGODB_URI` to your MongoDB connection and replace `SESSION_SECRET` with a long random value. For a local demo seed, set `DEMO_PASSWORD` to a unique password of at least eight characters containing a letter and a number. Optionally set both `ADMIN_EMAIL` and `ADMIN_PASSWORD` to create a local administrator account.

Generate a random session secret if needed:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the configured accounts and start the app:

```powershell
pnpm seed
pnpm dev
```

Password reset email and opted-in email notifications require `SMTP_URL` and `SMTP_FROM`. Opted-in SMS requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`. Email/SMS notification preferences are off by default and can be changed in **Notifications**; SMS requires a mobile number in international E.164 format. Per-channel delivery outcomes are recorded on each notification.

Open [http://localhost:3000](http://localhost:3000). When `DEMO_PASSWORD` is set, demo account emails are `patient@example.test`, `doctor@example.test`, and `caregiver@example.test`; each uses the local `DEMO_PASSWORD` value. The seed creates a verified demonstration doctor and patient-approved access for the demo doctor/caregiver. When only `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, it creates just the administrator and does not require a demo password. It does not add fictitious prescriptions or claim clinical results.

To verify a newly registered doctor, create an administrator account via `ADMIN_EMAIL` and `ADMIN_PASSWORD` before running `pnpm seed`, then log in and use the **Doctor review** screen. Review license details against the appropriate professional registry; CareTrack does not perform external license validation.

## Tests and health status

```powershell
pnpm test
pnpm test:integration
```

Unit tests cover date/time validation, timezone scheduling, Mongoose filter sanitization, request-origin validation, and pagination. The integration checks use a uniquely named local MongoDB database and verify authentication, patient profile/allergy updates, secure reset codes, patient-scoped audit history, pagination, notification preference/status handling, prescription creation and validation, and patient-authorized doctor access; they drop only their own test database. For a read-only, authenticated API smoke check after seeding and starting the server, run this in another PowerShell window:

```powershell
pnpm smoke
```

The smoke check signs in as all three seeded roles and verifies their record-access endpoints; it does not change patient records. It does not replace a comprehensive automated API test suite. The backend health endpoint is `GET /api/health`; the server refuses to start without MongoDB.

## Notes and limitations

- In development, session cookies use `SameSite=Lax` and do not require HTTPS. Production cookies are `Secure` and `SameSite=None` for HTTPS deployments that embed the app cross-site.
- State-changing API requests with an `Origin` header are limited to the app origin or an exact origin configured in `CORS_ORIGINS`; configure that list for cross-origin deployments.
- The frontend is served by Express from `frontend/`; no separate frontend development server is required.
- Patients can enable browser dose reminders from the dashboard. Notifications require browser permission and the CareTrack page to remain open; they are not push notifications and do not run while the app is closed.
- Facility search supports manual locations or browser geolocation, with a map from OpenStreetMap. Location is used for the requested facility search; map and search data are provided by external services.
- Medicine search and prescription autocomplete use the RxNorm catalog. Search results do not indicate availability, inventory, or suitability for a particular patient.
- Medication interaction checks use ingredients from RxNorm and text matches in FDA drug labels, which are **not** a comprehensive clinical interaction source. The interface displays source status, limitations, and a professional-judgment disclaimer; an unavailable service is not reported as a clean result.
- Pharmacy and hospital information comes from community-maintained OpenStreetMap data. No inventory/stock is represented.
- In-app notifications are database-backed. SMTP email/Twilio SMS delivery is optional, requires server credentials and user opt-in, and records per-channel success/failure. Password reset is unavailable until SMTP is configured.
- Demo accounts and patient records are synthetic. Do not use real patient information.
