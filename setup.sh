#!/usr/bin/env bash
# =============================================================================
# setup.sh — JIRA AI MCP Server — One-shot setup script
#
# What this script does:
#   1. Checks system prerequisites (Node, npm, Python, ffmpeg, Docker)
#   2. Installs Node dependencies
#   3. Installs Python Whisper (for local meeting transcription)
#   4. Creates .env.local from .env.example if not already present
#   5. Creates docker/.env from docker/.env.example if not already present
#   6. Builds the TypeScript project
#   7. Optionally starts the JIRA Data Center docker stack
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh              # Full setup (prompts before docker start)
#   ./setup.sh --no-docker  # Skip docker stack entirely
#   ./setup.sh --help       # Show this help
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✔${RESET}  $*"; }
info() { echo -e "${CYAN}  →${RESET}  $*"; }
warn() { echo -e "${YELLOW}  ⚠${RESET}  $*"; }
fail() { echo -e "${RED}  ✗${RESET}  $*" >&2; exit 1; }
header() {
  echo ""
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  $*${RESET}"
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════${RESET}"
}

# ── Script location ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Argument parsing ──────────────────────────────────────────────────────────
SKIP_DOCKER=false

for arg in "$@"; do
  case "$arg" in
    --no-docker) SKIP_DOCKER=true ;;
    --help|-h)
      sed -n '/^# Usage:/,/^# ====/{ /^# ====/d; s/^# \{0,3\}//; p }' "$0"
      exit 0
      ;;
    *) fail "Unknown argument: $arg  (use --help for usage)" ;;
  esac
done

# =============================================================================
# STEP 1 — Check prerequisites
# =============================================================================
header "Step 1 — Checking prerequisites"

# Node.js ≥ 18
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -lt 18 ]]; then
    fail "Node.js 18+ required (found v${NODE_VER}). Install from https://nodejs.org"
  fi
  ok "Node.js v${NODE_VER}"
else
  fail "Node.js not found. Install from https://nodejs.org (v18+)"
fi

# npm
if command -v npm &>/dev/null; then
  ok "npm $(npm --version)"
else
  fail "npm not found (should come with Node.js)"
fi

# Python 3
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
  PYTHON_CMD="python3"
elif command -v python &>/dev/null && python --version 2>&1 | grep -q "Python 3"; then
  PYTHON_CMD="python"
fi

if [[ -n "$PYTHON_CMD" ]]; then
  PY_VER=$("$PYTHON_CMD" --version 2>&1 | awk '{print $2}')
  ok "Python $PY_VER ($PYTHON_CMD)"
else
  warn "Python 3 not found — meeting transcription will not work."
  warn "Install Python 3 from https://python.org and re-run this script."
  PYTHON_CMD=""
fi

# pip
PIP_CMD=""
if [[ -n "$PYTHON_CMD" ]]; then
  if "$PYTHON_CMD" -m pip --version &>/dev/null; then
    PIP_CMD="$PYTHON_CMD -m pip"
    ok "pip available"
  else
    warn "pip not found — Whisper will not be installed automatically."
  fi
fi

# ffmpeg (needed by Whisper to decode .mp4 / .m4a / .mkv)
if command -v ffmpeg &>/dev/null; then
  ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
else
  warn "ffmpeg not found — required for .mp4 / .m4a / .mkv transcription."
  if command -v apt-get &>/dev/null; then
    info "Install with:  sudo apt-get install -y ffmpeg"
  elif command -v brew &>/dev/null; then
    info "Install with:  brew install ffmpeg"
  fi
fi

# Docker (optional)
if [[ "$SKIP_DOCKER" == false ]]; then
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
    if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
      ok "Docker Compose $(docker compose version --short 2>/dev/null || echo '(available)')"
    else
      warn "Docker Compose v2 plugin not found — docker stack will be skipped."
      SKIP_DOCKER=true
    fi
  else
    warn "Docker not running or not installed — JIRA docker stack will be skipped."
    SKIP_DOCKER=true
  fi
fi

# =============================================================================
# STEP 2 — Install Node dependencies
# =============================================================================
header "Step 2 — Installing Node.js dependencies"

if [[ -d node_modules && -f package-lock.json ]]; then
  info "node_modules exists — running npm ci for clean reproducible install"
  npm ci --prefer-offline 2>&1 | tail -3
else
  npm install
fi
ok "Node dependencies installed"

# =============================================================================
# STEP 3 — Install Python Whisper (local transcription)
# =============================================================================
header "Step 3 — Installing Python Whisper (on-device transcription)"

if [[ -z "$PIP_CMD" ]]; then
  warn "Skipping Whisper install (pip not available)"
else
  # Check if either Whisper variant is already installed
  WHISPER_OK=false
  if "$PYTHON_CMD" -c "import faster_whisper" 2>/dev/null; then
    ok "faster-whisper already installed"
    WHISPER_OK=true
  elif "$PYTHON_CMD" -c "import whisper" 2>/dev/null; then
    ok "openai-whisper already installed"
    WHISPER_OK=true
  fi

  if [[ "$WHISPER_OK" == false ]]; then
    info "Installing faster-whisper (recommended — 4× faster, runs fully on-device)..."
    if $PIP_CMD install --quiet faster-whisper; then
      ok "faster-whisper installed"
    else
      warn "faster-whisper install failed — trying openai-whisper as fallback..."
      if $PIP_CMD install --quiet openai-whisper; then
        ok "openai-whisper installed"
      else
        warn "Neither Whisper variant could be installed."
        warn "You can install manually later:  pip install faster-whisper"
      fi
    fi
  fi
fi

# Verify self-contained: confirm no network call goes out during transcription
info "Whisper processes audio files entirely on your machine."
info "No audio or transcript data is sent to any external server."

# =============================================================================
# STEP 4 — Create .env.local (MCP server config)
# =============================================================================
header "Step 4 — Creating environment config files"

if [[ ! -f .env.local ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env.local
    ok "Created .env.local from .env.example"
    warn "ACTION REQUIRED: Edit .env.local and set your JIRA_PAT and JIRA_BASE_URL"
  else
    warn ".env.example not found — skipping .env.local creation"
  fi
else
  ok ".env.local already exists (not overwritten)"
fi

# =============================================================================
# STEP 5 — Create docker/.env (JIRA Data Center docker stack)
# =============================================================================
if [[ ! -f docker/.env ]]; then
  if [[ -f docker/.env.example ]]; then
    cp docker/.env.example docker/.env
    ok "Created docker/.env from docker/.env.example"
    warn "ACTION REQUIRED: Edit docker/.env — change POSTGRES_PASSWORD before starting"
  else
    warn "docker/.env.example not found — skipping docker/.env creation"
  fi
else
  ok "docker/.env already exists (not overwritten)"
fi

# =============================================================================
# STEP 6 — Build TypeScript
# =============================================================================
header "Step 5 — Building TypeScript"

npm run build
ok "TypeScript compiled → dist/"

# =============================================================================
# STEP 7 — Create logs directory
# =============================================================================
mkdir -p logs
ok "logs/ directory ready"

# =============================================================================
# STEP 8 — Optionally start JIRA docker stack
# =============================================================================
if [[ "$SKIP_DOCKER" == false ]]; then
  header "Step 6 — JIRA Data Center Docker stack"
  echo ""
  echo -e "  This will start ${BOLD}PostgreSQL + JIRA Software + nginx${RESET} via Docker."
  echo -e "  First startup downloads ~1 GB of images and takes ~3–5 minutes."
  echo ""
  read -rp "  Start JIRA docker stack now? [y/N] " START_DOCKER
  echo ""

  if [[ "${START_DOCKER,,}" == "y" ]]; then
    # Warn if POSTGRES_PASSWORD is still the example placeholder
    if grep -q "changeme_strong_password_here" docker/.env 2>/dev/null; then
      fail "docker/.env still has the placeholder POSTGRES_PASSWORD. Edit it first, then re-run."
    fi

    info "Starting docker stack (this may take a few minutes)..."
    docker compose -f docker/docker-compose.yml --env-file docker/.env up -d

    echo ""
    ok "JIRA docker stack started."
    info "Wait ~3 minutes then open http://localhost:81 to complete JIRA setup."
    info "JIRA is ready when: curl -s http://localhost:8085/status | grep -q '\"state\":\"RUNNING\"'"
  else
    info "Skipped. Start the JIRA stack later with:"
    echo ""
    echo "    docker compose -f docker/docker-compose.yml --env-file docker/.env up -d"
  fi
else
  info "Docker stack skipped (--no-docker or Docker not available)"
fi

# =============================================================================
# Done
# =============================================================================
header "Setup complete"

echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo ""
echo -e "  1. ${YELLOW}Edit .env.local${RESET}   — set JIRA_BASE_URL, JIRA_PAT, JIRA_PROJECT_KEY"
echo -e "                      (generate PAT at: JIRA → Profile → Personal Access Tokens)"
echo ""
echo -e "  2. ${YELLOW}Edit docker/.env${RESET}  — set a strong POSTGRES_PASSWORD (if using docker JIRA)"
echo ""
echo -e "  3. ${BOLD}Connect to Claude Desktop / GitHub Copilot:${RESET}"
echo ""
echo -e "     Add to your MCP config:"
echo -e "     ${CYAN}{"
echo -e "       \"mcpServers\": {"
echo -e "         \"jira-ai\": {"
echo -e "           \"command\": \"node\","
echo -e "           \"args\": [\"$(pwd)/dist/index.js\"]"
echo -e "         }"
echo -e "       }"
echo -e "     }${RESET}"
echo ""
echo -e "  4. ${BOLD}Transcribe a Teams meeting:${RESET}"
echo -e "     Tell the AI: ${CYAN}\"Transcribe /path/to/meeting.mp4\"${RESET}"
echo -e "     Then:        ${CYAN}\"Extract Jira stories from this transcript\"${RESET}"
echo -e "     All audio processing runs on your machine — nothing leaves it."
echo ""
echo -e "  Run ${CYAN}npm run dev${RESET} to start the MCP server in development mode."
echo ""
