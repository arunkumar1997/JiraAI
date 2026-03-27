#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[build]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn] ${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; }

# ─── Parse flags ──────────────────────────────────────────────────────────────
SKIP_INSTALL=false
SKIP_TYPECHECK=false
PACKAGE_ONLY=false
INSTALL_VSIX=false

usage() {
  cat <<EOF
Usage: ./build.sh [options]

Options:
  --skip-install      Skip npm install (use cached node_modules)
  --skip-typecheck    Skip TypeScript type check
  --package           Compile + package .vsix (default: compile only)
  --install           Install the .vsix into VS Code after packaging
  -h, --help          Show this help
EOF
}

for arg in "$@"; do
  case $arg in
    --skip-install)   SKIP_INSTALL=true ;;
    --skip-typecheck) SKIP_TYPECHECK=true ;;
    --package)        PACKAGE_ONLY=true ;;
    --install)        INSTALL_VSIX=true; PACKAGE_ONLY=true ;;
    -h|--help)        usage; exit 0 ;;
    *) error "Unknown option: $arg"; usage; exit 1 ;;
  esac
done

# ─── Step 1: Install dependencies ─────────────────────────────────────────────
if [ "$SKIP_INSTALL" = false ]; then
  info "Installing dependencies..."
  npm install
else
  warn "Skipping npm install"
fi

# ─── Step 2: Type-check ───────────────────────────────────────────────────────
if [ "$SKIP_TYPECHECK" = false ]; then
  info "Running TypeScript type check..."
  npm run typecheck
  info "Type check passed ✓"
else
  warn "Skipping type check"
fi

# ─── Step 3: Compile ──────────────────────────────────────────────────────────
info "Compiling extension and MCP server..."
npm run compile
info "Compiled → dist/extension.js  dist/server.js ✓"

# ─── Step 4: Package .vsix (optional) ────────────────────────────────────────
if [ "$PACKAGE_ONLY" = true ]; then
  # Ensure vsce is available
  if ! command -v vsce &>/dev/null; then
    info "Installing @vscode/vsce globally..."
    npm install -g @vscode/vsce
  fi

  # Create a placeholder icon if missing (vsce requires one)
  if [ ! -f "images/icon.png" ]; then
    warn "images/icon.png not found — creating a placeholder so vsce doesn't fail"
    mkdir -p images
    # 128×128 solid blue PNG (minimal valid PNG, no external deps required)
    python3 - <<'PYEOF'
import struct, zlib, os

def png_chunk(tag, data):
    c = zlib.crc32(tag + data) & 0xffffffff
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", c)

w = h = 128
raw = b''.join(b'\x00' + b'\x3a\x85\xc7' * w for _ in range(h))  # solid #3a85c7
compressed = zlib.compress(raw)

os.makedirs("images", exist_ok=True)
with open("images/icon.png", "wb") as f:
    f.write(b'\x89PNG\r\n\x1a\n')
    f.write(png_chunk(b'IHDR', struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
    f.write(png_chunk(b'IDAT', compressed))
    f.write(png_chunk(b'IEND', b''))
print("Placeholder icon created: images/icon.png")
PYEOF
  fi

  info "Packaging .vsix..."
  vsce package --no-dependencies --no-rewrite-relative-links --allow-star-activation

  VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)
  if [ -z "$VSIX_FILE" ]; then
    error "Packaging failed — no .vsix file found"
    exit 1
  fi
  info "Package ready → ${VSIX_FILE} ✓"

  # ─── Step 5: Install into VS Code (optional) ────────────────────────────────
  if [ "$INSTALL_VSIX" = true ]; then
    if ! command -v code &>/dev/null; then
      error "'code' CLI not found in PATH. Install it via VS Code: Cmd+Shift+P → 'Install code command in PATH'"
      exit 1
    fi
    info "Installing ${VSIX_FILE} into VS Code..."
    code --install-extension "$VSIX_FILE"
    info "Extension installed ✓"
    info "Restart VS Code and set your JIRA credentials in Settings → 'JIRA AI MCP'"
  else
    echo ""
    echo "  To install manually:"
    echo "    code --install-extension ${VSIX_FILE}"
    echo "  Or: VS Code → Extensions → ··· → Install from VSIX..."
  fi
fi

echo ""
info "Build complete!"
