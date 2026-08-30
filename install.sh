#!/usr/bin/env bash
# ============================================================================
# LUPIN-007 — All-in-One Installer
# Builds, packages, and installs LUPIN-007 as a native Linux desktop app.
# Usage:
#   ./install.sh            Build and install
#   ./install.sh --uninstall  Remove desktop entries, binary symlink, and icons
# ============================================================================
set -euo pipefail

APP_NAME="LUPIN-007"
APP_ID="lupin-007"
APP_COMMENT="AI-Powered SRE Incident Remediation & Control Plane"
MIN_NODE_VERSION=20

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APPS_DIR="${HOME}/.local/share/applications"
ICONS_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"
DATA_DIR="${HOME}/.config/${APP_ID}/data"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║           LUPIN-007  INSTALLER               ║"
  echo "  ║     Incident Command Deck · TrueForge        ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${NC}"
}

info()    { echo -e "  ${CYAN}▸${NC} $*"; }
success() { echo -e "  ${GREEN}✔${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail()    { echo -e "  ${RED}✖${NC} $*"; exit 1; }

# ============================================================================
# Uninstall
# ============================================================================
uninstall() {
  banner
  echo -e "  ${YELLOW}Uninstalling ${APP_NAME}…${NC}"
  echo ""

  rm -f "${BIN_DIR}/${APP_ID}" && success "Removed ${BIN_DIR}/${APP_ID}" || true
  rm -f "${APPS_DIR}/${APP_ID}.desktop" && success "Removed desktop entry" || true
  rm -f "${ICONS_DIR}/${APP_ID}.png" && success "Removed app icon" || true

  if command -v update-desktop-database &>/dev/null; then
    update-desktop-database "${APPS_DIR}" 2>/dev/null || true
  fi

  echo ""
  echo -e "  ${GREEN}${BOLD}${APP_NAME} uninstalled.${NC}"
  echo -e "  User data in ${DATA_DIR} was ${YELLOW}NOT${NC} removed."
  echo -e "  To remove data: ${BOLD}rm -rf ${HOME}/.config/${APP_ID}${NC}"
  echo ""
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

# ============================================================================
# Prerequisites
# ============================================================================
banner
echo -e "  ${BOLD}Checking prerequisites…${NC}"
echo ""

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Please install Node.js >= ${MIN_NODE_VERSION}."
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if (( NODE_VER < MIN_NODE_VERSION )); then
  fail "Node.js ${MIN_NODE_VERSION}+ required (found v${NODE_VER}). Please upgrade."
fi
success "Node.js v$(node --version | tr -d 'v')"

# npm
command -v npm &>/dev/null && success "npm $(npm --version)" || fail "npm not found"

# pnpm (install if missing)
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found — installing via npm…"
  npm install -g pnpm || fail "Failed to install pnpm"
fi
success "pnpm $(pnpm --version)"

# Container runtimes (optional)
echo ""
info "Optional container runtimes:"
command -v docker &>/dev/null && success "Docker $(docker --version 2>/dev/null | head -c 40)" || warn "Docker not found (demo cluster requires it)"
command -v podman &>/dev/null && success "Podman $(podman --version 2>/dev/null | head -c 40)" || info "Podman not found (optional)"

# TrueForge
echo ""
info "Checking TrueForge availability…"
if npx @truefoundry/trueforge --version &>/dev/null 2>&1; then
  success "TrueForge CLI available via npx"
else
  warn "TrueForge CLI not cached yet — will be downloaded on first launch"
fi

# ============================================================================
# Build
# ============================================================================
echo ""
echo -e "  ${BOLD}Building ${APP_NAME}…${NC}"
echo ""

cd "${SCRIPT_DIR}"

# Backend control plane
info "Installing backend dependencies…"
npm install --no-audit --no-fund 2>&1 | tail -1
success "Backend dependencies installed"

info "Compiling backend (TypeScript)…"
npm run build 2>&1 | tail -1
success "Backend compiled → dist/"

# Dashboard frontend
info "Installing dashboard dependencies…"
cd "${SCRIPT_DIR}/dashboard"
pnpm install --no-frozen-lockfile 2>&1 | tail -1
success "Dashboard dependencies installed"

info "Building dashboard (Vite + esbuild)…"
pnpm run build 2>&1 | tail -1
success "Dashboard compiled → dashboard/dist/"

# Electron packaging
info "Packaging Electron application…"
pnpm electron:pack 2>&1 | tail -3
success "Electron app packaged"

cd "${SCRIPT_DIR}"

# ============================================================================
# Locate packaged output
# ============================================================================
RELEASE_DIR="${SCRIPT_DIR}/dashboard/release"

# electron-builder --dir produces linux-unpacked/
UNPACKED_DIR="${RELEASE_DIR}/linux-unpacked"
APPIMAGE=$(find "${RELEASE_DIR}" -maxdepth 1 -name "*.AppImage" -type f 2>/dev/null | head -1)

if [[ -d "${UNPACKED_DIR}" ]]; then
  LAUNCH_BIN="${UNPACKED_DIR}/${APP_NAME}"
  # electron-builder names the binary after productName
  if [[ ! -f "${LAUNCH_BIN}" ]]; then
    # Fallback: find the main executable
    LAUNCH_BIN=$(find "${UNPACKED_DIR}" -maxdepth 1 -type f -executable | head -1)
  fi
elif [[ -n "${APPIMAGE}" ]]; then
  LAUNCH_BIN="${APPIMAGE}"
else
  fail "No packaged output found in ${RELEASE_DIR}. Check electron-builder logs."
fi

[[ -f "${LAUNCH_BIN}" ]] || fail "Executable not found: ${LAUNCH_BIN}"
success "Packaged executable: ${LAUNCH_BIN}"

# ============================================================================
# Install
# ============================================================================
echo ""
echo -e "  ${BOLD}Installing to desktop environment…${NC}"
echo ""

# Ensure directories
mkdir -p "${BIN_DIR}" "${APPS_DIR}" "${ICONS_DIR}" "${DATA_DIR}"

# Symlink binary
ln -sf "${LAUNCH_BIN}" "${BIN_DIR}/${APP_ID}"
chmod +x "${BIN_DIR}/${APP_ID}"
success "Binary linked → ${BIN_DIR}/${APP_ID}"

# Icon
ICON_SRC="${SCRIPT_DIR}/dashboard/client/public/favicon.png"
if [[ -f "${ICON_SRC}" ]]; then
  cp "${ICON_SRC}" "${ICONS_DIR}/${APP_ID}.png"
  success "Icon installed → ${ICONS_DIR}/${APP_ID}.png"
else
  warn "No icon found at ${ICON_SRC}"
fi

# Desktop entry
cat > "${APPS_DIR}/${APP_ID}.desktop" << DESKTOP
[Desktop Entry]
Name=${APP_NAME}
GenericName=Incident Command Deck
Comment=${APP_COMMENT}
Exec=${BIN_DIR}/${APP_ID} %U
Icon=${APP_ID}
Terminal=false
Type=Application
Categories=Development;System;Utility;
StartupWMClass=${APP_ID}
DESKTOP
chmod +x "${APPS_DIR}/${APP_ID}.desktop"
success "Desktop entry → ${APPS_DIR}/${APP_ID}.desktop"

# Update desktop database
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "${APPS_DIR}" 2>/dev/null || true
fi

# ============================================================================
# Done
# ============================================================================
echo ""
echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}  ║       ${APP_NAME} installed successfully!      ║${NC}"
echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Launch from:"
echo -e "    ${BOLD}Terminal:${NC}       ${APP_ID}"
echo -e "    ${BOLD}App Menu:${NC}       Search for '${APP_NAME}'"
echo ""
echo -e "  Data stored in: ${CYAN}${DATA_DIR}${NC}"
echo -e "  Uninstall:      ${BOLD}./install.sh --uninstall${NC}"
echo ""
