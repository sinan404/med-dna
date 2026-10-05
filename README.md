# MED-DNA

**Medical Device Command Center: behavioral DNA for connected devices, and signed, tamper-evident readings for temperature-controlled medicine.**


> Simulated devices, sensors, users, and telemetry only. No real devices, networks, hospital systems, or patient data are used or attacked.

**Contents:** [Project Name](#project-name) · [Team Name](#team-name) · [Selected Track](#selected-track) · [Challenge](#challenge-number--title) · [Problem](#problem-statement) · [Solution](#proposed-solution) · [Features](#key-features) · [Tech Stack](#technology-stack) · [Architecture](#system-architecture) · [Setup](#setupinstallation-steps) · [Usage](#usage-instructions) · [Demo](#demo-instructions) · [Testing](#testingevaluation-results) · [Limitations](#limitations) · [Team](#team-members) · [Third-party](#third-party-components) · [Final version](#final-version-for-judging)

---

## Project Name

MED-DNA (Medical Device Command Center)

## Team Name
sablaski

## Selected Track
2


## Challenge Number & Title
Medical Devices + Cyber-Physical Safety

## Problem Statement

Hospitals depend on two kinds of things that attackers, faults, and mistakes can quietly change.

**1. Connected medical devices.** Infusion pumps, patient monitors, ventilators, and imaging systems are hard to patch and cannot simply be switched off. When one starts behaving differently (new destinations, unusual commands, odd traffic), security staff need to see it, understand why it was flagged, and respond without interrupting patient care.

**2. Temperature-controlled medicine.** Vaccines, insulin, and blood units must stay within a strict temperature range. If a sensor reading is spoofed or a log is edited, spoiled stock can be given to patients and nobody notices, because the record looks fine.

**Cyber risks addressed**

| Risk | Where it applies |
| --- | --- |
| Behavior drift or compromise of a connected device (data exfiltration, command injection, tampered firmware) | Medical devices |
| Falsified or replayed temperature data | Cold chain sensors |
| Edited logs | Cold chain ledger and audit trail |
| A compromised sensor gateway | Cold chain sensors |
| Unapproved or unaccountable responses | Every consequential action |

## Proposed Solution

MED-DNA gives a hospital security operator one console for both problems.

- **Device DNA.** Each device has a trusted behavioral baseline across five attributes. The backend scores how closely live behavior matches that baseline (0 to 100), classifies the risk, and explains which attributes caused the drop. A response such as network isolation happens only when an operator approves it, and clinical operation always continues.
- **Signed cold chain.** Each sensor reading is signed (HMAC-SHA256) and added to a hash-chained ledger. The system detects forged signatures, replayed readings, physically impossible readings, and edited logs, and keeps a real temperature excursion separate from an integrity failure. A pharmacist must approve before any batch is quarantined.
- **Security console.** One place to review detections, alerts, the audit log, and users and roles. Four roles (Security Operator, Pharmacist, Admin, Auditor) are enforced by the backend.

A guiding rule throughout: **risk is not proof of compromise.** The system reports "behavior differs from baseline" or "a reading failed a check", never a verdict.

## Key Features

- **DNA scoring** from five weighted attributes (unknown destinations, unusual commands, packets per minute, response time, connection duration), with a plain-language explanation of every deviation and its point impact.
- **Four mutation presets** (combined, exfiltration, injection, firmware) that each produce a different deviation pattern.
- **Operator-approved response:** two-step isolation, restore, acknowledge, and reset. Nothing runs automatically.
- **Signed sensor readings** with HMAC-SHA256 and constant-time verification; keys generated at startup and never exposed.
- **Five integrity checks per unit:** signature, sequence and freshness, plausibility, ledger chain, and temperature range.
- **Per-unit hash-chained reading ledger** with verification that points to the first broken entry.
- **Five simulated cold-chain attacks:** forged reading (`spoof`), replayed readings (`replay`), edited log (`log_edit`), impossible swings (`impossible`), and a real temperature rise (`excursion`, the control case).
- **Pharmacist-approved quarantine** with an optional note; the system only recommends and never quarantines or discards stock.
- **Security console:** detections and alerts from both modules, an alert lifecycle (Open, Acknowledged, Resolved), an audit log with actor and role, and a users and roles page with a permissions matrix.
- **Hash-chained audit log** covering every state change, sign-in, failed sign-in, denied action, and role change.
- **Accessible, responsive UI:** keyboard operation, text labels for every status, live announcements, and layouts that work from 360 px wide.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Backend | Python 3.11+, FastAPI, Pydantic v2, Uvicorn |
| Cryptography and auth | Standard library: `hmac`, `hashlib` (SHA-256, scrypt), `secrets` |
| Storage | In-memory (MVP) |
| Frontend | React 18, Vite, JavaScript, CSS, React Router (hash routing), Lucide icons |
| Testing | pytest, httpx `TestClient` |
| API style | REST, JSON, session token in the `Authorization` header |

**AI/ML:** none. Scoring and detection are rule-based (fixed weights, tolerances, and thresholds). See [AI Use and Human Oversight](#ai-use-and-human-oversight).

## System Architecture

```
┌─────────────────────────────┐        REST / JSON (polling every 2 s)       ┌────────────────────────────────────┐
│  React frontend (Vite)      │  <────────────────────────────────────────>  │  FastAPI backend                   │
│                             │      Authorization: Bearer <token>           │                                    │
│  Login                      │                                              │  Auth and roles  (auth.py)         │
│  Fleet view (device DNA)    │                                              │  DNA engine      (engine.py)       │
│  Cold Chain view            │                                              │  Cold-chain      (signing.py,      │
│  Security Console           │                                              │                   coldchain.py,    │
│                             │                                              │                   ledger.py)       │
│  Renders only what the      │                                              │  Detections + alerts               │
│  backend returns            │                                              │  Event / audit log (hash chain)    │
└─────────────────────────────┘                                              │  Simulator (background tick, 2 s)  │
                                                                             │  In-memory store + asyncio lock    │
                                                                             └────────────────────────────────────┘
```

**Data flow (cold chain).** Each tick, the simulator creates one signed reading per storage unit. The verifier checks the signature, sequence and freshness, plausibility, and temperature range; the reading is appended to the unit's hash-chained ledger; the ledger is re-verified; the unit status is derived; and detections, alerts, and audit events are created. Batches are only ever *recommended* for quarantine. A pharmacist's approved request is the only thing that changes batch state.

**Key points**

- **The backend is the single source of truth.** It owns baselines, telemetry, scores, risk, explanations, signed readings, check results, detections, alerts, roles, and hashes. The frontend contains no scoring, signature, or simulation logic.
- **Two kinds of hash chain:** one global chain for the audit log, and one chain per storage unit for readings.
- **A single lock** protects every read-modify-write, so ticks and requests never interleave.

### Security approach

| Control | How it is done |
| --- | --- |
| Reading authenticity | HMAC-SHA256 over a canonical payload; constant-time comparison |
| Replay protection | Strictly increasing sequence numbers plus a timestamp freshness window |
| Plausibility | Physical range and maximum step change between readings |
| Tamper evidence | SHA-256 hash chains for readings (per unit) and for the audit log; verification reports the first broken entry |
| Access control | Four roles, permissions enforced by the backend on every state-changing endpoint; the UI only reflects them |
| Authentication | Scrypt-hashed passwords with per-user salts, signed session tokens with expiry, lockout after repeated failures |
| Accountability | Every sign-in, failed sign-in, denied action, state change, and role change is audited with actor and role |
| Secrets | Keys and secrets are generated at startup or read from environment variables; none are committed (see `.env.example`) |

### Healthcare safety

- All devices, sensors, batches, users, and telemetry are synthetic and generated by the backend.
- Nothing connects to a real device, hospital system, or network, and nothing scans or attacks any target.
- **Human approval for consequential actions:** isolation needs a Security Operator or Admin and a two-step confirmation; quarantine and release need a Pharmacist and a two-step confirmation. No action runs automatically.
- Isolation never changes clinical operation: the response states that clinical operation continues.
- Responses separate "behavior deviates" or "a reading failed a check" from "compromised". The system never claims proof of tampering.

Full details are in `docs/MED-DNA_Backend_Specification.md` and `docs/MED-DNA_Frontend_Specification.md`.

## Setup/Installation Steps

### Repository layout

```
med-dna/
├── README.md
├── LICENSE
├── .gitignore
├── .env.example
├── docs/
│   ├── MED-DNA_Backend_Specification.md
│   ├── MED-DNA_Frontend_Specification.md
│   └── screenshots/
├── backend/            FastAPI service (app/ and tests/)
└── frontend/           React app (src/ and public/)
```

### Prerequisites

- Python 3.11 or newer
- Node.js 18 or newer and npm

### Backend

```
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install fastapi "uvicorn[standard]" pydantic pytest httpx
cp ../.env.example .env          # then edit the values; never commit .env
uvicorn app.main:app --reload --port 8000
```

Environment variables (placeholders are in `.env.example`; real values go only in your local `.env`):

| Variable | Purpose |
| --- | --- |
| `ALLOWED_ORIGINS` | Allowed CORS origins (default: `http://localhost:5173`, `http://127.0.0.1:5173`) |
| `SESSION_SECRET` | Signs session tokens. If unset, one is generated at startup and sessions end on restart. |
| `SENSOR_KEY_SEED` | Optional. Makes simulated sensor keys reproducible (used by tests). |
| `DEMO_OPERATOR_PASSWORD`, `DEMO_PHARMACIST_PASSWORD`, `DEMO_ADMIN_PASSWORD`, `DEMO_AUDITOR_PASSWORD` | Passwords for the four simulated demo users. Choose your own for each run. |

### Frontend

```
cd frontend
npm install
echo "VITE_API_BASE=http://localhost:8000/api" > .env
npm run dev
```

The app opens at `http://localhost:5173`.

## Usage Instructions

1. Open `http://localhost:5173` and sign in with one of the four simulated demo accounts (passwords are the ones you set in your backend `.env`). The login page lists the usernames and can fill the username field for you:

   | Username | Role | Can do |
   | --- | --- | --- |
   | `demo.operator` | Security Operator | Simulate, isolate, restore, reset, acknowledge and resolve alerts |
   | `demo.pharmacist` | Pharmacist | Approve quarantine and release batches, acknowledge and resolve alerts |
   | `demo.admin` | Admin | Operator actions plus user and role management |
   | `demo.auditor` | Auditor | Read-only access to everything, including the audit log and users |

2. **Fleet view:** select a device to see its DNA score, attribute tracks, and explanation. Choose a mutation preset and use **Simulate mutation**. Use **Approve isolation** then **Confirm isolation** to respond, and **Reset DNA** to recover.
3. **Cold Chain view:** select a storage unit to see its temperature chart, the five integrity checks, its batches, and the reading ledger. Use **Simulate attack** and **Reset unit**. As a Pharmacist, use **Approve quarantine** then **Confirm quarantine**, and **Release batch** once the unit is Normal.
4. **Security Console:** use the tabs for Detections, Alerts, Audit log, and Users and Roles. Filters narrow each table. The audit log shows whether its hash chain verifies.
5. If a control is unavailable for your role, the page says why in plain text.

## Demo Instructions

The demo runs entirely on simulated data in a local, controlled environment. A short script that shows the whole story in a few minutes:

1. Sign in as **Demo Operator**. The Fleet view shows four Trusted devices, fleet match about 97%.
2. Select **Infusion Pump 17**, choose **Combined**, and click **Simulate mutation**. The score falls to about 43 and the status turns Critical, with an explanation of why.
3. Click **Approve isolation**, then **Confirm isolation**. The badge shows Isolated, and the page says clinical operation continues. Click **Reset DNA**.
4. Open **Cold Chain**. Select **Vaccine Fridge 01** and simulate **Forged reading (spoof)**. The status becomes Integrity risk, the signature check fails, and the batches show "Quarantine recommended". Nothing is quarantined.
5. Try **Approve quarantine** as the operator: it is unavailable because it requires the Pharmacist role.
6. Sign out, sign in as **Demo Pharmacist**, approve and confirm quarantine with a note. The batch is held and no stock is discarded.
7. As the operator, reset the unit. On **Insulin Cabinet 03** simulate **Real temperature rise (excursion)**: status is Excursion with every integrity check passing. On **Blood Bank Fridge 02** simulate **Edited log (log_edit)**: the ledger shows where the chain breaks.
8. Open **Security Console**: review detections and alerts, try resolving an alert while its condition is still active, then check the **Audit log** for the denied quarantine and the pharmacist approval.
9. Sign in as **Demo Admin** to change a role (with confirmation) and view the permissions matrix. Sign in as **Demo Auditor** to see the same pages read-only.

Demo URL (if hosted): [Fill in, or write "Not hosted; run locally"]

## Testing/Evaluation Results

All tests run locally against simulated data. From `backend/`:

```
pytest
```

The suite covers the scoring engine, the event hash chain, signing and verification, every cold-chain attack, the ledger, role enforcement, authentication, detections and alerts, and the audit log.

**Sample input and expected output** (from the specification; replace with your captured output):

```
POST /api/simulate/infusion-pump-17      {"preset": "combined"}      (jitter disabled)
-> dna_score 43, risk CRITICAL, status CRITICAL
   deviations: dest -18.0 points, cmd -12.5 points, pkt ..., resp ..., dur ...

POST /api/coldchain/simulate/vaccine-fridge-01      {"attack": "spoof"}
-> status INTEGRITY_RISK, signature check "fail", batches QUARANTINE_RECOMMENDED

POST /api/coldchain/actions      {"batch_id": "VAC-2026-0412", "action": "quarantine"}   (as demo.operator)
-> 403 {"detail": "Your role can't approve quarantine. Ask a pharmacist."}
```

**Results** (fill in after running; the Target column comes from the specifications, and targets are not results):

| Check | Target | Result |
| --- | --- | --- |
| Weights sum to 1.0 | Pass | [Fill in] |
| `combined` on Infusion Pump 17, jitter off | Score 43, CRITICAL | [Fill in] |
| Healthy devices with jitter, 200 samples | All scores between 94 and 100 | [Fill in] |
| Every preset drops its device below 85 | Pass | [Fill in] |
| Healthy units, 100 ticks with noise | NORMAL, no detections, alerts, or events | [Fill in] |
| `spoof`, `replay`, `impossible`, `log_edit` | Each fails a different check | [Fill in] |
| `excursion` | Only the temperature range check fails | [Fill in] |
| Edited ledger entry | Verification fails at that entry | [Fill in] |
| Quarantine as non-pharmacist | 403 and an `access_denied` event | [Fill in] |
| No automatic quarantine after any attack | Pass | [Fill in] |
| Last Admin demotion | 409 | [Fill in] |
| `GET /api/health` after the demo sequence | `chain_valid` and `ledgers_valid` both true | [Fill in] |

The frontend is evaluated against acceptance criteria FE-01 to FE-25 and the backend against BE-01 to BE-21 in the specifications in `docs/`. [Fill in: overall pass count and date tested.]

**Screenshots and logs:** [Fill in: add images to `docs/screenshots/` and link them here, for example the Fleet view after a mutation, a failing check panel, the broken-ledger view, and the audit log.]

## Limitations

- **Everything is simulated.** No real devices, sensors, networks, patient data, or credentials. Scores and readings come from a generator, not from hospital systems.
- **Shared-secret signing.** HMAC-SHA256 uses one secret per sensor, and in this prototype the backend plays both the sensor and the verifier. A real deployment would use asymmetric signatures such as Ed25519, key rotation, and hardware-backed keys.
- **Rule-based detection.** Scoring and checks use fixed weights and thresholds, with no machine learning and no adaptive baselines.
- **Possible false positives and false negatives.** A legitimate change (a configuration update, a busy period, a door left open) can lower a score or cause an excursion alert. A slow, small, or well-crafted change can stay inside the tolerances and go unflagged. Flatline detection and per-product excursion limits based on time above threshold are not included.
- **Demo authentication.** Seeded users, simple sign-in with session tokens, and brute-force lockout only. No external identity provider, multi-factor sign-in, or persistent sessions.
- **In-memory storage.** All data resets when the backend restarts. Each unit ledger keeps its latest 1,000 readings.
- **Polling, not push.** The frontend refreshes every 2 seconds instead of using WebSockets.
- **Single process.** One backend instance with one lock; not designed for horizontal scaling.
- **Risk, not verdict.** The system can say a reading failed a check or behavior differs from baseline. It cannot prove tampering or compromise, and it does not replace clinical, pharmacy, or security judgment.

### AI Use and Human Oversight

This project does **not** use AI or machine learning in the product. Scores, checks, and detections are deterministic rules. Output is a risk indication to support a human decision, not a guaranteed clinical or security decision, and every consequential action (isolation, quarantine, release, role change) needs an authorized person's approval. Claude (an AI assistant) was used while writing the specifications and documentation. [Fill in: describe any other AI assistance, and have the team review all AI-assisted text and code.]

## Team Members

| Member | Role and contributions |
| --- | --- |
| [Fill in: name] | [Fill in: for example, Backend and Security] |
| [Fill in: name] | [Fill in: for example, Frontend] |
| [Fill in: name] | [Fill in: for example, Research and Documentation] |

## Third-Party Components

No external APIs, hosted AI models, or datasets are used. All data is synthetic and generated by the project.

| Component | Use | License (verify before submitting) |
| --- | --- | --- |
| FastAPI | Backend web framework | MIT |
| Pydantic | Request and response models | MIT |
| Uvicorn | ASGI server | BSD-3-Clause |
| pytest | Backend tests | MIT |
| httpx | Test client | BSD-3-Clause |
| React and React DOM | Frontend UI | MIT |
| Vite | Frontend build and dev server | MIT |
| React Router | Frontend routing | MIT |
| Lucide | Icons | ISC |
| Python standard library (`hmac`, `hashlib`, `secrets`) | Signing, hashing, key generation | PSF License |
