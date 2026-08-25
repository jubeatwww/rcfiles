#!/usr/bin/env bash
#
# Symlink dotfiles from this repo into $HOME.
#
#   ./install.sh          link dotfiles (existing files are backed up)
#   ./install.sh --deps   also install oh-my-zsh, powerlevel10k and zsh plugins
#
set -euo pipefail

RCFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.rcfiles-backup/$(date +%Y%m%d-%H%M%S)"

DOTFILES=(
  .zshenv
  .zprofile
  .zshrc
  .p10k.zsh
  .tmux.conf
  .vimrc
  .screenrc
)

link() {
  local src="$RCFILES/$1" dst="$HOME/$1"

  if [[ -L "$dst" && "$(readlink "$dst")" == "$src" ]]; then
    echo "  ok       $1"
    return
  fi

  if [[ -e "$dst" || -L "$dst" ]]; then
    mkdir -p "$BACKUP_DIR"
    mv "$dst" "$BACKUP_DIR/$1"
    echo "  backup   $1 -> $BACKUP_DIR/$1"
  fi

  ln -s "$src" "$dst"
  echo "  link     $1 -> $src"
}

install_deps() {
  local custom="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"

  if ! command -v zsh >/dev/null; then
    echo "zsh is not installed; install it first (brew install zsh / apt install zsh)" >&2
    exit 1
  fi

  if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
    echo "  installing oh-my-zsh"
    RUNZSH=no KEEP_ZSHRC=yes sh -c \
      "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
  fi

  clone() {
    local repo="$1" dst="$2"
    if [[ -d "$dst" ]]; then
      echo "  ok       $(basename "$dst")"
    else
      echo "  clone    $repo"
      git clone --depth=1 "https://github.com/$repo.git" "$dst"
    fi
  }

  clone romkatv/powerlevel10k          "$custom/themes/powerlevel10k"
  clone zsh-users/zsh-autosuggestions  "$custom/plugins/zsh-autosuggestions"
  clone zsh-users/zsh-syntax-highlighting "$custom/plugins/zsh-syntax-highlighting"
  clone zsh-users/zsh-completions      "$custom/plugins/zsh-completions"
}

if [[ "${1:-}" == "--deps" ]]; then
  echo "Dependencies:"
  install_deps
fi

echo "Dotfiles:"
for f in "${DOTFILES[@]}"; do
  link "$f"
done

echo
echo "Done. Restart your shell or run: exec zsh"
