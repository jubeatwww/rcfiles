#!/usr/bin/env bash
#
# Link the dotfiles in this repo into $HOME.
#
#   ./install.sh                   link only (existing files are backed up first)
#   ./install.sh --deps            also install oh-my-zsh, powerlevel10k, zsh plugins,
#                                  the MesloLGS NF font, herdr, nvm + node and the
#                                  Claude Code status line (see --statusline)
#   ./install.sh --pull-herdr-app  copy the live herdr-app config back into this repo
#
#   --statusline herdr|ccstatusline|both    the status line --deps sets up
#     herdr         agent-status (Rust): herdr-app shows Claude Code's and
#                   Codex's sessions; a plain line elsewhere
#     ccstatusline  ccstatusline (node), for machines without herdr-app
#     both          agent-status, handing off to ccstatusline outside herdr
#   Asked when run in a terminal. Otherwise RCFILES_STATUSLINE, else both
#   where herdr-app is installed and ccstatusline where it isn't.
#
# herdr-app config is copied, not linked (see copy_herdr_app).
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

# Every file under config/herdr-app, at the same path under herdr-app's home.
# The rest of that home is written by the app (state, generated types).
HERDR_APP_REPO="$RCFILES/config/herdr-app"
HERDR_APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

# herdr, ccstatusline or both; see the top of this file.
STATUSLINE="${RCFILES_STATUSLINE:-}"

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
# herdr-app: copies, not symlinks. herdr-app reloads a file when its folder
# changes; an edit through a symlink changes the target's folder instead, so
# the app would keep the old version (and report no errors) until restarted.
# ---------------------------------------------------------------------------
herdr_app_files() {
  (cd "$HERDR_APP_REPO" && find . -type f | sed 's|^\./||' | sort)
}

copy_herdr_app() {
  local rel src dst
  while IFS= read -r rel; do
    src="$HERDR_APP_REPO/$rel" dst="$HERDR_APP_HOME/$rel"
    if [[ -f "$dst" && ! -L "$dst" ]] && cmp -s "$src" "$dst"; then
      say ok "herdr-app/$rel"
      continue
    fi
    if [[ -e "$dst" || -L "$dst" ]]; then
      mkdir -p "$BACKUP_DIR/herdr-app/$(dirname "$rel")"
      mv "$dst" "$BACKUP_DIR/herdr-app/$rel"
      say backup "herdr-app/$rel -> $BACKUP_DIR/herdr-app/$rel"
    fi
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    say copy "herdr-app/$rel"
  done < <(herdr_app_files)
}

# The reverse: what the app (or you) changed since, back into the repo.
pull_herdr_app() {
  local rel src dst
  while IFS= read -r rel; do
    src="$HERDR_APP_HOME/$rel" dst="$HERDR_APP_REPO/$rel"
    if [[ ! -f "$src" ]]; then
      say missing "$src"
    elif cmp -s "$src" "$dst"; then
      say ok "herdr-app/$rel"
    else
      cp "$src" "$dst"
      say pull "herdr-app/$rel"
    fi
  done < <(herdr_app_files)
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

# agent-status: agent sessions for herdr-app (tools/agent-status). Needs cargo.
# Into ~/.local/bin, beside hc and herdr: agents started before Rust was installed
# have no ~/.cargo/bin on their PATH, so Claude Code wouldn't find it there.
install_agent_status() {
  if ! command -v cargo >/dev/null 2>&1; then
    say skip "agent-status (no cargo)"
    return
  fi
  say install "agent-status -> ~/.local/bin"
  cargo install --quiet --locked --path "$RCFILES/tools/agent-status" --root "$HOME/.local"
}

install_deps() {
  install_zsh_deps
  install_font
  install_herdr
  install_node
  if [[ "$STATUSLINE" != herdr ]]; then
    install_ccstatusline
  fi
  if [[ "$STATUSLINE" != ccstatusline ]]; then
    install_agent_status
  fi
}

# ---------------------------------------------------------------------------
# Claude Code status line
# ---------------------------------------------------------------------------
choose_statusline() {
  if [[ -z "$STATUSLINE" ]]; then
    local default=ccstatusline
    if command -v herdr-app >/dev/null 2>&1; then
      default=both
    fi
    if [[ -t 0 ]]; then
      echo "Claude Code status line:"
      echo "  herdr         agent-status: herdr-app shows it; a plain line elsewhere (no ccstatusline)"
      echo "  ccstatusline  ccstatusline, for machines without herdr-app (no cargo build)"
      echo "  both          agent-status in herdr-app, ccstatusline elsewhere"
      read -r -p "Choose [$default]: " STATUSLINE
    fi
    STATUSLINE="${STATUSLINE:-$default}"
  fi
  case "$STATUSLINE" in
    herdr|ccstatusline|both) ;;
    *)
      echo "unknown status line '$STATUSLINE': herdr, ccstatusline or both" >&2
      exit 1
      ;;
  esac
}

# Points statusLine in Claude Code's settings at the chosen command and keeps
# everything else. node does the JSON (nvm's, from install_node).
set_statusline() {
  local command="agent-status claude" file
  if [[ "$STATUSLINE" == ccstatusline ]]; then
    command=ccstatusline
  fi
  file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

  if ! command -v node >/dev/null 2>&1; then
    say skip "statusLine (no node): set \"command\": \"$command\" in $file"
    return
  fi
  local result
  result="$(node -e '
    const fs = require("fs"), path = require("path");
    const [file, command, backup] = process.argv.slice(1);
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    const cur = settings.statusLine || {};
    if (cur.command === command) { console.log("ok"); process.exit(0); }
    const existed = fs.existsSync(file);
    if (existed) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(file, backup);
    }
    settings.statusLine = { padding: 0, refreshInterval: 10, ...cur, type: "command", command };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
    console.log(existed ? "set" : "new");
  ' "$file" "$command" "$BACKUP_DIR/.claude/settings.json")"
  case "$result" in
    ok) say ok "statusLine: $command" ;;
    new) say set "statusLine: $command ($file)" ;;
    *) say set "statusLine: $command ($file, old copy in $BACKUP_DIR/.claude/)" ;;
  esac
}

# Codex has no status line command, so agent-status runs as a Codex hook. The
# entries are appended: Codex trusts each hook by its place in hooks.json, and
# new ones wait until approved with /hooks in Codex.
set_codex_hooks() {
  # Not the folder: the links above create ~/.codex/skills on every machine.
  local dir="${CODEX_HOME:-$HOME/.codex}"
  if ! command -v codex >/dev/null 2>&1; then
    say skip "Codex hooks (no codex)"
    return
  fi
  if ! command -v node >/dev/null 2>&1; then
    say skip "Codex hooks (no node): add \"agent-status codex\" for SessionStart, PostToolUse, Stop to $dir/hooks.json"
    return
  fi
  local result
  result="$(node -e '
    const fs = require("fs"), path = require("path");
    const [file, backup] = process.argv.slice(1);
    const command = "agent-status codex";
    let doc = {};
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    const hooks = (doc.hooks ??= {});
    let added = 0;
    for (const [event, matcher] of [["SessionStart", "startup|resume"], ["PostToolUse", null], ["Stop", null]]) {
      const groups = (hooks[event] ??= []);
      if (groups.some((g) => (g.hooks ?? []).some((h) => h.command === command))) continue;
      groups.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command, timeout: 5 }] });
      added++;
    }
    if (!added) { console.log("ok"); process.exit(0); }
    if (fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(file, backup);
    }
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
    console.log("set");
  ' "$dir/hooks.json" "$BACKUP_DIR/.codex/hooks.json")"
  if [[ "$result" == ok ]]; then
    say ok "hooks: agent-status codex"
  else
    say set "hooks: agent-status codex ($dir/hooks.json); approve them with /hooks in Codex"
  fi
  if ! grep -Eq '^[[:space:]]*hooks[[:space:]]*=[[:space:]]*true' "$dir/config.toml" 2>/dev/null; then
    say note "Codex runs hooks only with hooks = true under [features] in $dir/config.toml"
  fi
}

# ---------------------------------------------------------------------------
usage() {
  awk 'NR > 1 && /^# herdr-app config is copied/ { exit } NR > 1' "${BASH_SOURCE[0]}" | cut -c3-
  exit 1
}

main() {
  local deps=0
  while (($#)); do
    case "$1" in
      --deps) deps=1 ;;
      --statusline)
        (($# >= 2)) || usage
        STATUSLINE="$2"
        shift
        ;;
      --statusline=*) STATUSLINE="${1#*=}" ;;
      --pull-herdr-app)
        echo "herdr-app -> repo:"
        pull_herdr_app
        echo
        echo "Review with: git -C \"$RCFILES\" diff config/herdr-app"
        exit 0
        ;;
      *) usage ;;
    esac
    shift
  done

  if ((deps)); then
    choose_statusline
    echo "Dependencies:"
    install_deps
    echo
  fi

  echo "Dotfiles:"
  link_all
  echo
  echo "herdr-app:"
  copy_herdr_app
  echo

  if ((deps)); then
    echo "Claude Code:"
    set_statusline
    echo
    if [[ "$STATUSLINE" != ccstatusline ]]; then
      echo "Codex:"
      set_codex_hooks
      echo
    fi
  fi
  echo "Done. Restart your shell or run: exec zsh"
}

# Sourcing (tests) defines the functions without running anything.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
