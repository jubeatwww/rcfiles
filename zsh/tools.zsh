# Language / tool version managers. Each block is a no-op if the tool
# is not installed on this machine.

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

# rust (cargo env is also sourced in .zshenv for non-interactive shells)
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"

# sdkman — must be sourced last
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"
