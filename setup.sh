#!/usr/bin/env bash
# =============================================================================
# setup.sh — JIRA AI MCP Server — One-shot setup script
#
# What this script does:
#   1. Checks system prerequisites (Docker)
#   2. Creates .env from .env.example if not already present
#   3. Builds the jira-ai-mcp Docker image
#   4. Optionally launches the full stack (PostgreSQL + Ollama + jira-ai-mcp)
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh           # Full setup (prompts before stack launch)
#   ./setup.sh --help    # Show this help
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
for arg in "$@"; do
  case "$arg" in
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

# Docker (required)
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  fail "Docker not running or not installed. Install from https://docs.docker.com/get-docker/"
fi

# Docker Compose v2 (required)
if docker compose version &>/dev/null 2>&1; then
  ok "Docker Compose $(docker compose version --short 2>/dev/null || echo '(available)')"
else
  fail "Docker Compose v2 plugin not found. Update Docker Desktop or install the plugin."
fi

# =============================================================================
# STEP 2 — Create .env
# =============================================================================
header "Step 2 — Environment config"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    ok "Created .env from .env.example"
    warn "ACTION REQUIRED: Edit .env and set JIRA_BASE_URL, JIRA_PAT, JIRA_PROJECT_KEY, POSTGRES_PASSWORD"
    echo ""
    read -rp "  Press Enter once you have edited .env, or Ctrl+C to abort and edit it now... "
  else
    fail ".env.example not found — cannot create .env"
  fi
else
  ok ".env already exists"
fi

# Guard against placeholder password
if grep -qE "POSTGRES_PASSWORD=(\s*$|changeme|your_password|example)" .env 2>/dev/null; then
  fail ".env has a placeholder POSTGRES_PASSWORD. Set a real password and re-run."
fi

# =============================================================================
# STEP 3 — Build the jira-ai-mcp Docker image
# =============================================================================
header "Step 3 — Building jira-ai-mcp Docker image"

info "Running: docker compose build jira-ai-mcp"
docker compose build jira-ai-mcp
ok "Image jira-ai-mcp:local built successfully"

# =============================================================================
# STEP 4 — Launch the stack
# =============================================================================
header "Step 4 — Launch MCP stack"

echo ""
echo -e "  This will start ${BOLD}PostgreSQL (pgvector) + Ollama + jira-ai-mcp${RESET} via Docker."
echo -e "  First startup pulls images and may take a few minutes."
echo ""
read -rp "  Start stack now? [y/N] " START_STACK
echo ""

if [[ "${START_STACK,,}" == "y" ]]; then
  info "Starting stack..."
  docker compose up -d

  echo ""
  ok "Stack started."
  info "Pull the embedding model (first time only):"
  echo ""
  echo "    docker exec -it ollama ollama pull nomic-embed-text"
  echo ""
  info "Ingest project docs:"
  echo ""
  echo "    docker compose run --rm jira-ai-mcp npm run ingest-docs"
else
  info "Skipped. Start the stack later with:"
  echo ""
  echo "    docker compose up -d"
fi

# =============================================================================
# Done
# =============================================================================
header "Setup complete"

echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo ""
echo -e "  1. ${YELLOW}Edit .env${RESET}  — verify JIRA_BASE_URL, JIRA_PAT, JIRA_PROJECT_KEY"
echo -e "             (generate PAT at: JIRA → Profile → Personal Access Tokens)"
echo ""
echo -e "  2. ${BOLD}Connect to VS Code (GitHub Copilot):${RESET}"
echo ""
echo -e "     The file ${CYAN}.vscode/mcp.json${RESET} is already configured in this repo."
echo -e "     Just open this folder in VS Code — Copilot will detect it automatically."
echo ""
echo -e "     If you need to add it manually, create ${CYAN}.vscode/mcp.json${RESET}:"
echo -e "     ${CYAN}{"
echo -e "       \"servers\": {"
echo -e "         \"jira-ai\": {"
echo -e "           \"type\": \"stdio\","
echo -e "           \"command\": \"docker\","
echo -e "           \"args\": [\"compose\", \"-f\", \"$(pwd)/docker-compose.yml\", \"run\", \"-i\", \"--rm\", \"jira-ai-mcp\"]"
echo -e "         }"
echo -e "       }"
echo -e "     }${RESET}"
echo ""
echo -e "  3. ${BOLD}Connect to Claude Desktop — add to ~/Library/Application Support/Claude/claude_desktop_config.json:${RESET}"
echo ""
echo -e "     ${CYAN}{"
echo -e "       \"mcpServers\": {"
echo -e "         \"jira-ai\": {"
echo -e "           \"command\": \"docker\","
echo -e "           \"args\": [\"compose\", \"-f\", \"$(pwd)/docker-compose.yml\", \"run\", \"-i\", \"--rm\", \"jira-ai-mcp\"]"
echo -e "         }"
echo -e "       }"
echo -e "     }${RESET}"
echo ""
echo -e "  3. ${BOLD}Ingest docs (if not done above):${RESET}"
echo -e "     ${CYAN}docker compose run --rm jira-ai-mcp npm run ingest-docs${RESET}"
echo ""
echo -e "  4. ${BOLD}Transcribe a meeting (Whisper runs inside the container):${RESET}"
echo -e "     Tell the AI: ${CYAN}\"Transcribe /path/to/meeting.mp4\"${RESET}"
echo -e "     All audio processing runs inside Docker — nothing leaves your machine."
echo ""
