#!/usr/bin/env bash
#
# Install the latest Plexus release into /Applications.
#
# Plexus is ad-hoc signed but not notarized, because notarizing needs a paid
# Apple developer account. macOS therefore quarantines it on download and
# refuses to open it until you clear that by hand. This script does the whole
# thing — download, install, clear the flag — so the first launch just works.
#
#   curl -fsSL https://raw.githubusercontent.com/Ray-Hughes/plexus/main/scripts/install-macos.sh | bash
#
set -euo pipefail

REPO="Ray-Hughes/plexus"
APP="/Applications/Plexus.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is macOS only. On Windows, use the .exe from the releases page." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

echo "==> Finding the latest release"
URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -o "https://[^\"]*Plexus-[0-9.]*-${ARCH}\.dmg" | head -1)

if [[ -z "${URL}" ]]; then
  echo "Could not find a ${ARCH} .dmg in the latest release." >&2
  echo "Check https://github.com/${REPO}/releases" >&2
  exit 1
fi

VERSION=$(echo "${URL}" | sed -E 's/.*Plexus-([0-9.]+)-.*/\1/')
echo "    v${VERSION} (${ARCH})"

TMP=$(mktemp -d)
MOUNT="${TMP}/mnt"
# Always clean up, including the mount, however this exits.
cleanup() {
  [[ -d "${MOUNT}" ]] && hdiutil detach "${MOUNT}" -quiet 2>/dev/null || true
  rm -rf "${TMP}"
}
trap cleanup EXIT

echo "==> Downloading"
curl -fSL --progress-bar "${URL}" -o "${TMP}/Plexus.dmg"

echo "==> Installing to ${APP}"
mkdir -p "${MOUNT}"
# An explicit mount point, because a stale /Volumes/Plexus* from an earlier
# version will otherwise be picked up instead of the one we just downloaded.
hdiutil attach -nobrowse -quiet -mountpoint "${MOUNT}" "${TMP}/Plexus.dmg"

if [[ -d "${APP}" ]]; then
  echo "    replacing the existing install"
  rm -rf "${APP}"
fi
cp -R "${MOUNT}/Plexus.app" /Applications/

echo "==> Clearing the download quarantine"
xattr -dr com.apple.quarantine "${APP}" 2>/dev/null || true

if ! codesign --verify --deep --strict "${APP}" 2>/dev/null; then
  echo "    warning: the signature did not verify — the app may not open" >&2
fi

echo
echo "Installed Plexus ${VERSION} to ${APP}"
echo "Open it from Launchpad, or: open -a Plexus"
