# ~/.zprofile — login shells only.

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv zsh)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv zsh)"
fi

# JetBrains Toolbox
_jb="$HOME/Library/Application Support/JetBrains/Toolbox/scripts"
[[ -d "$_jb" ]] && export PATH="$PATH:$_jb"
unset _jb
