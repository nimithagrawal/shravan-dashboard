# Shravan Dashboard

AyushPay call intelligence dashboard — 3-tab React app reading from Airtable CALL_LOG.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Airtable credentials
npm run dev
```

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_AIRTABLE_PAT` | Airtable Personal Access Token |
| `VITE_AIRTABLE_BASE_ID` | Airtable Base ID (e.g. `appC3a0Xi7ecuoAwC`) |
| `VITE_AIRTABLE_TABLE` | Table name (default: `CALL_LOG`) |

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the `shravan-dashboard` repo
4. In **Environment Variables**, add:
   - `VITE_AIRTABLE_PAT` = your Airtable PAT
   - `VITE_AIRTABLE_BASE_ID` = `appC3a0Xi7ecuoAwC`
   - `VITE_AIRTABLE_TABLE` = `CALL_LOG`
5. Framework Preset: **Vite**
6. Click **Deploy**

## Tabs

- **Overview** — KPIs, Agent QA chart, recent call log
- **Vikas Queue** — Callback queue + QA review
- **Samir Queue** — Hot leads, loan signals, churn risk
