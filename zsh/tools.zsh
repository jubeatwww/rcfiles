# Language / tool version managers and tool-specific shell hooks.
# Each block is a no-op if the tool is not installed on this machine.

# nvm
export NVM_DIR="$HOME/.nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"
[[ -s "$NVM_DIR/bash_completion" ]] && source "$NVM_DIR/bash_completion"

# pnpm
if [[ "$OSTYPE" == darwin* ]]; then
  export PNPM_HOME="$HOME/Library/pnpm"
else
  export PNPM_HOME="$HOME/.local/share/pnpm"
fi
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) [[ -d "$PNPM_HOME" ]] && export PATH="$PNPM_HOME:$PATH" ;;
esac

# rust — cargo env is sourced in .zshenv so it also applies to non-interactive shells.

# herdr — completion is generated from the binary, cached, and regenerated
# whenever the binary is newer than the cache (e.g. after `herdr update`).
if (( $+commands[herdr] && $+functions[compdef] )); then
  _rc_comp="${XDG_CACHE_HOME:-$HOME/.cache}/rcfiles/completions"
  if [[ ! -f "$_rc_comp/_herdr" || "$commands[herdr]" -nt "$_rc_comp/_herdr" ]]; then
    mkdir -p "$_rc_comp" && herdr completion zsh >| "$_rc_comp/_herdr"
  fi
  fpath+=("$_rc_comp")
  autoload -Uz _herdr && compdef _herdr herdr
  unset _rc_comp
fi

# sdkman — must be sourced last
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"
