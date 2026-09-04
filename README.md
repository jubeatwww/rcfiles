# rcfiles

個人 dotfiles。`install.sh` 會把 repo 裡的檔案 symlink 到 `$HOME`，所以改 repo 就等於改設定。

## 安裝

### 空白機器（一行搞定）

```sh
curl -fsSL https://raw.githubusercontent.com/jubeatwww/rcfiles/master/bootstrap.sh | sh
```

`bootstrap.sh` 會依序：

1. 用系統套件管理器裝 `zsh bash git curl tmux vim`（macOS 沒有 Homebrew 會先裝）
2. clone 這個 repo 到 `~/rcfiles`（已存在就跳過）
3. 跑 `./install.sh --deps`
4. 把 login shell 改成 zsh

支援 macOS、Debian/Ubuntu、Fedora、Arch、Alpine、openSUSE、FreeBSD。
重複跑是安全的，已經裝好的步驟會直接略過。

環境變數：`RCFILES`（checkout 位置，預設 `~/rcfiles`）、`RCFILES_REPO`（clone URL）、`RCFILES_NO_CHSH=1`（不改 login shell）。

### 已經有 zsh / git 的機器

```sh
git clone git@github.com:jubeatwww/rcfiles.git ~/rcfiles
cd ~/rcfiles
./install.sh          # 只建 symlink，既有檔案會備份到 ~/.rcfiles-backup/
./install.sh --deps   # 順便裝 oh-my-zsh / powerlevel10k / zsh plugins / 字型 / herdr
```

用 bootstrap 裝的 clone 是 https，之後要 push 可以改成 ssh：
`git -C ~/rcfiles remote set-url origin git@github.com:jubeatwww/rcfiles.git`

## 內容

| repo 檔案 | 連到 | 說明 |
| --- | --- | --- |
| `.zshenv` | `~/.zshenv` | 所有 zsh 都會載入（cargo env） |
| `.zprofile` | `~/.zprofile` | login shell：Homebrew / Linuxbrew、JetBrains Toolbox |
| `.zshrc` | `~/.zshrc` | oh-my-zsh + powerlevel10k，再載入 `zsh/*.zsh` |
| `zsh/env.zsh` | — | 環境變數 |
| `zsh/aliases.zsh` | — | alias |
| `zsh/tools.zsh` | — | nvm / pnpm / sdkman / herdr completion，沒裝的會自動略過 |
| `zsh/local.zsh` | — | 機器專屬設定，git 忽略，有就載入 |
| `.p10k.zsh` | `~/.p10k.zsh` | `p10k configure` 產生的 prompt 設定 |
| `.tmux.conf` | `~/.tmux.conf` | prefix `C-a`、`-` / `\|` 分割、`C-hjkl` 換 pane |
| `config/herdr/config.toml` | `~/.config/herdr/config.toml` | [herdr](https://herdr.dev) 設定，鍵位對齊 `.tmux.conf` |
| `config/ccstatusline/settings.json` | `~/.config/ccstatusline/settings.json` | [ccstatusline](https://github.com/sirmalloc/ccstatusline) 設定，Claude Code 的 status line |
| `.vimrc` | `~/.vimrc` | 不依賴 plugin 的 vim 設定 |
| `.screenrc` | `~/.screenrc` | screen 基本設定（沒 tmux 的機器用） |

### herdr

[herdr](https://herdr.dev) 是給 AI coding agent 用的 terminal workspace manager，
這裡的設定把鍵位對到跟 tmux 一樣：

| 層級 | herdr | tmux | 鍵位 |
| --- | --- | --- | --- |
| pane | pane | pane | `C-hjkl` 移動、`Alt+Tab` 循環、`prefix+HJKL` 交換 |
| window | tab | window | `Alt+←/→`、`Alt+1..9`、`prefix+c` 新開 |
| session | space | session | `Alt+↑/↓`、`prefix+w` 選單 |

分割：`prefix+-` 上下、`prefix+|` 左右。prefix 是 `C-a`。

herdr 的 zsh completion 會在第一次開 shell 時從 binary 產生並快取到
`~/.cache/rcfiles/completions/`，`herdr update` 之後會自動重新產生。

## 依賴

`./install.sh --deps` 會處理：

- [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)、[powerlevel10k](https://github.com/romkatv/powerlevel10k)
- zsh-autosuggestions、zsh-syntax-highlighting、zsh-completions
- MesloLGS NF 字型（p10k 用；Linux 只在有桌面環境時裝）——記得在 terminal 把字型切過去
- [herdr](https://herdr.dev)（裝到 `~/.local/bin`，Linux / macOS）

zsh、bash、git、curl、tmux、vim 本身由 `bootstrap.sh` 用套件管理器裝（`bootstrap.sh` 是 POSIX sh，所以連 bash 都沒有的 Alpine / FreeBSD 也能跑）。
