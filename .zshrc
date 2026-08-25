# ~/.zshrc  (symlinked from rcfiles)

# Powerlevel10k instant prompt — must stay near the top.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Directory of this repo, resolved through the symlink.
export RCFILES="${${(%):-%x}:A:h}"

# ---------------------------------------------------------------------------
# Oh My Zsh
# ---------------------------------------------------------------------------
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"

plugins=(
  git
  zsh-autosuggestions
  zsh-syntax-highlighting
)

# zsh-completions is added to fpath only; oh-my-zsh runs compinit itself.
fpath+="${ZSH_CUSTOM:-$ZSH/custom}/plugins/zsh-completions/src"

[[ -f "$ZSH/oh-my-zsh.sh" ]] && source "$ZSH/oh-my-zsh.sh"

# ---------------------------------------------------------------------------
# Modular config
# ---------------------------------------------------------------------------
for f in env aliases tools; do
  [[ -f "$RCFILES/zsh/$f.zsh" ]] && source "$RCFILES/zsh/$f.zsh"
done

# Machine-specific overrides (git-ignored).
[[ -f "$RCFILES/zsh/local.zsh" ]] && source "$RCFILES/zsh/local.zsh"

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------
[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh
