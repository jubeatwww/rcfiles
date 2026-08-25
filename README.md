# rcfiles

個人 dotfiles。`install.sh` 會把 repo 裡的檔案 symlink 到 `$HOME`，所以改 repo 就等於改設定。

## 安裝

```sh
git clone git@github.com:jubeatwww/rcfiles.git ~/rcfiles
cd ~/rcfiles
./install.sh          # 只建 symlink，既有檔案會備份到 ~/.rcfiles-backup/
./install.sh --deps   # 順便裝 oh-my-zsh / powerlevel10k / zsh plugins
```

## 內容

| 檔案 | 說明 |
| --- | --- |
| `.zshenv` | 所有 zsh 都會載入（cargo env） |
| `.zprofile` | login shell：Homebrew、JetBrains Toolbox |
| `.zshrc` | oh-my-zsh + powerlevel10k，再載入 `zsh/*.zsh` |
| `zsh/env.zsh` | 環境變數 |
| `zsh/aliases.zsh` | alias |
| `zsh/tools.zsh` | nvm / pnpm / cargo / sdkman，沒裝的會自動略過 |
| `zsh/local.zsh` | 機器專屬設定，git 忽略，有就載入 |
| `.p10k.zsh` | `p10k configure` 產生的 prompt 設定 |
| `.tmux.conf` | prefix `C-a`、`-` / `\|` 分割、`C-hjkl` 換 pane |
| `.vimrc` | 不依賴 plugin 的 vim 設定 |
| `.screenrc` | screen 基本設定（沒 tmux 的機器用） |

## 依賴

- zsh、[oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)
- [powerlevel10k](https://github.com/romkatv/powerlevel10k)（需要 Nerd Font）
- zsh-autosuggestions、zsh-syntax-highlighting、zsh-completions

以上 `./install.sh --deps` 都會處理。
