# ~/.zprofile — login shells only.

# Homebrew (macOS arm64 / macOS intel / Linuxbrew)
for _brew in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
  if [[ -x "$_brew" ]]; then
    eval "$("$_brew" shellenv zsh)"
    break
  fi
done
unset _brew

# JetBrains Toolbox
_jb="$HOME/Library/Application Support/JetBrains/Toolbox/scripts"
[[ -d "$_jb" ]] && export PATH="$PATH:$_jb"
unset _jb
