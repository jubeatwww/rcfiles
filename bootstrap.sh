#!/bin/sh
#
# Bootstrap a blank machine (macOS / Debian / Fedora / Arch / Alpine / openSUSE / FreeBSD):
#
#   1. install zsh, bash, git, curl, tmux, vim with the system package manager
#      (Homebrew is installed first on macOS if missing)
#   2. clone this repo to ~/rcfiles unless it is already there
#   3. ./install.sh --deps   -> oh-my-zsh, powerlevel10k, plugins, font, herdr, symlinks
#   4. make zsh the login shell
#
# POSIX sh on purpose: it must run before bash exists. One-liner:
#   curl -fsSL https://raw.githubusercontent.com/jubeatwww/rcfiles/master/bootstrap.sh | sh
#
# Env overrides:
#   RCFILES           checkout directory   (default: ~/rcfiles)
#   RCFILES_REPO      clone URL            (default: https://github.com/jubeatwww/rcfiles.git)
#   RCFILES_NO_CHSH=1 skip changing the login shell
set -eu

REPO_URL="${RCFILES_REPO:-https://github.com/jubeatwww/rcfiles.git}"
PACKAGES="zsh bash git curl tmux vim"
OS="$(uname -s)"

# When run from a checkout, use that checkout; otherwise (curl | sh) clone to $RCFILES.
if [ -f "$0" ] && [ -f "$(dirname "$0")/install.sh" ]; then
  RCFILES="$(cd "$(dirname "$0")" && pwd)"
else
  RCFILES="${RCFILES:-$HOME/rcfiles}"
fi

say() { printf '  %-8s %s\n' "$1" "$2"; }
die() { echo "error: $*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if has sudo; then SUDO="sudo"; elif has doas; then SUDO="doas"; fi
fi

# ---------------------------------------------------------------------------
# 1. Packages
# ---------------------------------------------------------------------------
install_homebrew() {
  if has brew; then
    say ok homebrew
    return
  fi
  say install homebrew
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_packages() {
  missing=""
  for p in $PACKAGES; do
    has "$p" || missing="$missing $p"
  done
  # busybox has no chsh; Alpine ships it in the shadow package.
  if has apk && ! has chsh; then
    missing="$missing shadow"
  fi
  missing="${missing# }"

  if [ -z "$missing" ]; then
    say ok "$PACKAGES"
    return
  fi
  say install "$missing"

  if [ "$OS" = Darwin ]; then
    install_homebrew
    # shellcheck disable=SC2086
    brew install $missing
    return
  fi

  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    die "need root or sudo to install: $missing"
  fi

  # shellcheck disable=SC2086
  if has apt-get; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ca-certificates $missing
  elif has dnf; then
    $SUDO dnf install -y -q $missing
  elif has yum; then
    $SUDO yum install -y -q $missing
  elif has pacman; then
    $SUDO pacman -Sy --noconfirm --needed $missing
  elif has apk; then
    $SUDO apk add --no-cache $missing
  elif has zypper; then
    $SUDO zypper --non-interactive install $missing
  elif has pkg; then
    $SUDO pkg install -y $missing
  else
    die "unknown package manager; install manually: $missing"
  fi
}

# ---------------------------------------------------------------------------
# 2. Repo
# ---------------------------------------------------------------------------
clone_repo() {
  if [ -f "$RCFILES/install.sh" ]; then
    say ok "$RCFILES"
  elif [ -e "$RCFILES" ]; then
    die "$RCFILES exists but is not an rcfiles checkout"
  else
    say clone "$REPO_URL -> $RCFILES"
    git clone --quiet "$REPO_URL" "$RCFILES"
  fi
}

# ---------------------------------------------------------------------------
# 4. Login shell
# ---------------------------------------------------------------------------
current_login_shell() {
  user="$(id -un)"
  if has getent; then
    getent passwd "$user" | cut -d: -f7
  elif has dscl; then
    dscl . -read "/Users/$user" UserShell 2>/dev/null | awk '{print $2}'
  else
    echo "${SHELL:-}"
  fi
}

set_login_shell() {
  zsh_path="$(command -v zsh)"
  current="$(current_login_shell)"

  if [ "$(basename "${current:-none}")" = zsh ]; then
    say ok "login shell is zsh"
    return
  fi

  if [ -f /etc/shells ] && ! grep -qx "$zsh_path" /etc/shells; then
    echo "$zsh_path" | $SUDO tee -a /etc/shells >/dev/null
  fi

  if has chsh && chsh -s "$zsh_path"; then
    say chsh "$zsh_path"
  elif has usermod && $SUDO usermod -s "$zsh_path" "$(id -un)"; then
    say usermod "$zsh_path"
  else
    say warn "could not change the login shell; run: chsh -s $zsh_path"
  fi
}

# ---------------------------------------------------------------------------
main() {
  echo "Packages:"
  install_packages
  echo
  echo "Repo:"
  clone_repo
  echo
  bash "$RCFILES/install.sh" --deps
  echo
  echo "Login shell:"
  if [ "${RCFILES_NO_CHSH:-}" = 1 ]; then
    say skip "RCFILES_NO_CHSH=1"
  else
    set_login_shell
  fi
  echo
  echo "All set. Open a new terminal (font: MesloLGS NF) or run: exec zsh"
}

main "$@"
