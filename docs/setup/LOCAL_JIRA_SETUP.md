# Local JIRA Setup — Docker Compose

This guide walks you through spinning up a fully functional JIRA Software Data Center instance on your local machine for development.

**Time required:** ~20 minutes (most of it is JIRA's first-boot setup wizard)

---

## Prerequisites

- Docker Desktop ≥ 24 or Docker Engine + Compose plugin
- 6 GB RAM available (JIRA + PostgreSQL + nginx)
- Ports 80, 443, 8080 available

Verify:

```bash
docker --version       # ≥ 24.0
docker compose version # ≥ 2.x
```

---

## Step 1 — Clone & Configure

```bash
cd /home/arun/jiraAI

# Copy the Docker environment template
cp docker/.env.example docker/.env

# Edit — minimum: change POSTGRES_PASSWORD
nano docker/.env
```

`docker/.env` settings:

```env
POSTGRES_DB=jiradb
POSTGRES_USER=jira
POSTGRES_PASSWORD=YourStrongPasswordHere   # ← CHANGE THIS

JIRA_HOSTNAME=localhost
JIRA_PROXY_PORT=80
JIRA_SCHEME=http
```

---

## Step 2 — Start the Stack

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
```

Watch startup progress:

```bash
docker compose -f docker/docker-compose.yml logs -f jira
```

JIRA takes **2–3 minutes** on first start. Wait until you see:

```
jira-server  | JIRA started successfully in ...
```

---

## Step 3 — JIRA Setup Wizard

1. Open **http://localhost:8080** in your browser
2. Choose **"Set it up for me"** (recommended) or **"I'll set it up myself"**
3. Select **"My own database"** — enter:
   - Database: PostgreSQL
   - Hostname: `postgres`
   - Port: `5432`
   - Database: `jiradb`
   - Username: `jira`
   - Password: _(the password from docker/.env)_
4. Wait for the DB schema to be created (~2 min)

---

## Step 4 — Get a License

JIRA requires a license. Options:

### Option A: Atlassian Developer License (Free, recommended)

1. Go to https://developer.atlassian.com/platform/marketplace/timebomb-licenses-for-testing-server-apps/
2. Or: https://my.atlassian.com/license/evaluation → "JIRA Software" → "Data Center" → 10 users
3. Select **Server** or **Data Center** license type, 10 users
4. Paste the license key in the setup wizard

### Option B: 30-Day Evaluation

- The setup wizard has a "Get evaluation license" button
- Requires an Atlassian account (free to create)

### Option C: Timebomb License (for CI/testing)

- Atlassian provides timebomb licenses that expire after ~3 hours — good for automated tests, not for development.

---

## Step 5 — Complete the Wizard

Follow the remaining wizard steps:

1. Application title: `JIRA AI Dev` (or anything)
2. Mode: **Private** (only invite users later)
3. Admin account:
   - Username: `admin`
   - Password: choose a strong password
   - Email: your email
4. Click **Finish**

---

## Step 6 — Create a Project

1. **Projects → Create project**
2. Choose **Scrum** template
3. Set a project key (e.g., `PROJ`)
4. Note the board ID — you'll need it for `JIRA_BOARD_ID`

### Find the Board ID

```bash
curl -u admin:yourpassword \
  http://localhost:8080/rest/agile/1.0/board \
  | python3 -m json.tool | grep -A5 '"id"'
```

Or navigate to your board in the browser — the URL contains `rapidView=<ID>`.

---

## Step 7 — Create a Personal Access Token

1. Click your avatar (top-right) → **Profile**
2. Left sidebar → **Personal Access Tokens**
3. **Create token**:
   - Name: `jira-ai-mcp`
   - Expiry: 365 days (or no expiry for local dev)
4. **Copy the token immediately** — it won't be shown again

---

## Step 8 — Discover Custom Field IDs

```bash
export JIRA_PAT="your-token-here"
curl -sH "Authorization: Bearer $JIRA_PAT" \
  http://localhost:8080/rest/api/2/field \
  | python3 -c "
import json, sys
fields = json.load(sys.stdin)
for f in fields:
    if f.get('custom'):
        print(f['id'], '|', f['name'])
" | grep -E 'Story|Epic|Sprint|Acceptance'
```

Common output:

```
customfield_10011 | Epic Name
customfield_10014 | Epic Link
customfield_10016 | Story Points
customfield_10020 | Sprint
```

---

## Step 9 — Configure the MCP Server

```bash
cd /home/arun/jiraAI
cp .env.example .env.local
nano .env.local
```

Fill in:

```env
JIRA_BASE_URL=http://localhost:8080
JIRA_PAT=your-personal-access-token
JIRA_PROJECT_KEY=PROJ
JIRA_BOARD_ID=1
JIRA_FIELD_STORY_POINTS=customfield_10016
JIRA_FIELD_EPIC_LINK=customfield_10014
JIRA_FIELD_EPIC_NAME=customfield_10011
JIRA_FIELD_SPRINT=customfield_10020
```

Test the connection:

```bash
npm run dev &
# In another terminal — ask Claude to call jira_get_project
```

---

## SSL Setup (Optional, for HTTPS)

Generate a self-signed certificate for local use:

```bash
mkdir -p docker/nginx/ssl

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout docker/nginx/ssl/jira.key \
  -out docker/nginx/ssl/jira.crt \
  -subj "/CN=localhost/O=JIRA Dev/C=US"
```

Then edit `docker/nginx/nginx.conf`:

- Uncomment the `server { listen 443 ssl ... }` block
- Add redirect in the port 80 block

Update `docker/.env`:

```env
JIRA_PROXY_PORT=443
JIRA_SCHEME=https
```

Restart nginx: `docker compose restart nginx`

---

## Managing the Stack

```bash
# Start
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d

# Stop (preserves data)
docker compose -f docker/docker-compose.yml down

# Stop and wipe all data (nuclear reset)
docker compose -f docker/docker-compose.yml down -v

# View logs
docker compose -f docker/docker-compose.yml logs -f

# JIRA shell (for debugging)
docker exec -it jira-server bash

# PostgreSQL shell
docker exec -it jira-postgres psql -U jira -d jiradb

# Check JIRA status
curl http://localhost:8080/status
```

---

## Troubleshooting

### JIRA won't connect to PostgreSQL

- Verify `POSTGRES_PASSWORD` in `docker/.env` matches what you entered
- Check: `docker logs jira-postgres | tail -20`

### JIRA is very slow

- Increase Docker Desktop memory allocation to 8 GB
- Edit `JVM_MAXIMUM_MEMORY: 6144m` in `docker-compose.yml`

### Port 8080 already in use

- Change port: `- "9090:8080"` in docker-compose.yml
- Update `JIRA_BASE_URL=http://localhost:9090` in `.env.local`

### MCP server can't reach JIRA

```bash
curl -H "Authorization: Bearer $JIRA_PAT" \
  http://localhost:8080/rest/api/2/myself | python3 -m json.tool
```

Should return your user info. If 401: PAT is wrong or expired. If connection refused: JIRA isn't running.
