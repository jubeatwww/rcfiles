#!/usr/bin/env bash
#
# Link the dotfiles in this repo into $HOME.
#
#   ./install.sh          link only (existing files are backed up first)
#   ./install.sh --deps   also install oh-my-zsh, powerlevel10k, zsh plugins,
#                         the MesloLGS NF font, herdr, nvm + node and ccstatusline
#
# On a blank machine (no zsh / git / tmux yet) run ./bootstrap.sh instead;
# it installs the packages and then calls this script with --deps.
set -euo pipefail

RCFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.rcfiles-backup/$(date +%Y%m%d-%H%M%S)"
OS="$(uname -s)"

# "<path in repo>  <path under $HOME>"
LINKS=(
  ".zshenv                            .zshenv"
  ".zprofile                          .zprofile"
  ".zshrc                             .zshrc"
  ".p10k.zsh                          .p10k.zsh"
  ".tmux.conf                         .tmux.conf"
  ".vimrc                             .vimrc"
  ".screenrc                          .screenrc"
  "config/herdr/config.toml           .config/herdr/config.toml"
  "config/ccstatusline/settings.json  .config/ccstatusline/settings.json"
  "config/nvim                        .config/nvim"
  # AI tooling: the whole dir is a Claude Code plugin; Codex only sees single skills.
  "ai                                 .claude/skills/personal"
  "ai/skills/shar0-blog               .codex/skills/shar0-blog"
)

say() { printf '  %-8s %s\n' "$1" "$2"; }

# ---------------------------------------------------------------------------
# Symlinks
# ---------------------------------------------------------------------------
link() {
  local src="$RCFILES/$1" dst="$HOME/$2"

  if [[ -L "$dst" && "$(readlink "$dst")" == "$src" ]]; then
    say ok "$2"
    return
  fi

  if [[ -e "$dst" || -L "$dst" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$2")"
    mv "$dst" "$BACKUP_DIR/$2"
    say backup "$2 -> $BACKUP_DIR/$2"
  fi

  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  say link "$2 -> $src"
}

link_all() {
  local entry src dst
  for entry in "${LINKS[@]}"; do
    read -r src dst <<<"$entry"
    link "$src" "$dst"
  done

  # Pick up the linked config if a herdr server is already running.
  if command -v herdr >/dev/null 2>&1; then
    herdr server reload-config >/dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
clone() {
  local repo="$1" dst="$2"
  if [[ -d "$dst" ]]; then
    say ok "$(basename "$dst")"
  else
    say clone "$repo"
    git clone --depth=1 --quiet "https://github.com/$repo.git" "$dst"
  fi
}

install_zsh_deps() {
  local custom="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"

  if ! command -v zsh >/dev/null 2>&1; then
    echo "zsh is not installed; run ./bootstrap.sh or install it first" >&2
    exit 1
  fi

  if [[ -d "$HOME/.oh-my-zsh" ]]; then
    say ok oh-my-zsh
  else
    say install oh-my-zsh
    local out
    if ! out="$(ZSH="$HOME/.oh-my-zsh" RUNZSH=no KEEP_ZSHRC=yes CHSH=no sh -c \
        "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" 2>&1)"; then
      printf '%s\n' "$out" >&2
      exit 1
    fi
  fi

  clone romkatv/powerlevel10k             "$custom/themes/powerlevel10k"
  clone zsh-users/zsh-autosuggestions     "$custom/plugins/zsh-autosuggestions"
  clone zsh-users/zsh-syntax-highlighting "$custom/plugins/zsh-syntax-highlighting"
  clone zsh-users/zsh-completions         "$custom/plugins/zsh-completions"
}

# MesloLGS NF: the Nerd Font powerlevel10k is configured for.
# Skipped on headless Linux — the font belongs on the machine running the terminal.
install_font() {
  local dir style
  case "$OS" in
    Darwin) dir="$HOME/Library/Fonts" ;;
    *)
      if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
        say skip "font (headless)"
        return
      fi
      dir="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
      ;;
  esac

  if [[ -f "$dir/MesloLGS NF Regular.ttf" ]]; then
    say ok "MesloLGS NF"
    return
  fi

  say install "MesloLGS NF -> $dir"
  mkdir -p "$dir"
  for style in Regular Bold Italic "Bold Italic"; do
    curl -fsSL "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20${style// /%20}.ttf" \
      -o "$dir/MesloLGS NF $style.ttf"
  done
  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f "$dir" >/dev/null
  fi
}

install_herdr() {
  if command -v herdr >/dev/null 2>&1 || [[ -x "$HOME/.local/bin/herdr" ]]; then
    say ok herdr
    return
  fi
  case "$OS" in
    Linux|Darwin) ;;
    *) say skip "herdr (no build for $OS)"; return ;;
  esac
  say install "herdr -> ~/.local/bin"
  curl -fsSL https://herdr.dev/install.sh | HERDR_INSTALL_DIR="$HOME/.local/bin" sh >/dev/null
}

NVM_VERSION="v0.40.8"

# nvm + a default node. The installer is told not to touch any profile:
# zsh/tools.zsh already loads nvm, and ~/.zshrc is a symlink into this repo.
install_node() {
  case "$OS" in
    Linux|Darwin) ;;
    *) say skip "nvm (unsupported on $OS)"; return ;;
  esac

  export NVM_DIR="$HOME/.nvm"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    say ok nvm
  else
    say install "nvm $NVM_VERSION"
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" \
      | PROFILE=/dev/null bash >/dev/null
  fi

  # nvm.sh is not safe under `set -eu`.
  set +eu
  source "$NVM_DIR/nvm.sh"
  if [[ "$(nvm version default)" == N/A ]]; then
    say install "node (lts)"
    nvm install --lts >/dev/null && nvm alias default 'lts/*' >/dev/null
  else
    say ok "node $(nvm version default)"
  fi
  nvm use default >/dev/null
  set -eu

  command -v npm >/dev/null 2>&1 || { echo "node install failed" >&2; exit 1; }
}

# ccstatusline renders the Claude Code status line. Pinned to the version
# recorded in its settings file. Global npm packages live per node version
# under nvm, so this also restores it after moving to a new default node.
install_ccstatusline() {
  local want have
  want="$(sed -n 's/.*"installedVersion": *"\([^"]*\)".*/\1/p' "$RCFILES/config/ccstatusline/settings.json")"
  have="$(npm ls -g --depth=0 ccstatusline 2>/dev/null | sed -n 's/.*ccstatusline@//p')"

  if [[ -n "$have" && ( -z "$want" || "$have" == "$want" ) ]]; then
    say ok "ccstatusline $have"
    return
  fi
  say install "ccstatusline${want:+ $want}"
  npm install -g --silent "ccstatusline${want:+@$want}" >/dev/null
}

install_deps() {
  install_zsh_deps
  install_font
  install_herdr
  install_node
  install_ccstatusline
}

# ---------------------------------------------------------------------------
main() {
  case "${1:-}" in
    --deps)
      echo "Dependencies:"
      install_deps
      echo
      ;;
    "") ;;
    *)
      sed -n '2,9p' "${BASH_SOURCE[0]}" | cut -c3-
      exit 1
      ;;
  esac

  echo "Dotfiles:"
  link_all
  echo
  echo "Done. Restart your shell or run: exec zsh"
}

main "$@"
