# rcfiles

個人 dotfiles。`install.sh` 會把 repo 裡的檔案 symlink 到 `$HOME`，所以改 repo 就等於改設定。
例外是 herdr-app 的設定：用複製的，見 [herdr-app](#herdr-app)。

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

環境變數：`RCFILES`（checkout 位置，預設 `~/rcfiles`）、`RCFILES_REPO`（clone URL）、`RCFILES_NO_CHSH=1`（不改 login shell）、
`RCFILES_STATUSLINE`（`herdr` / `ccstatusline` / `both`，見 [Claude Code status line](#claude-code-status-line)）。

### 已經有 zsh / git 的機器

```sh
git clone git@github.com:jubeatwww/rcfiles.git ~/rcfiles
cd ~/rcfiles
./install.sh          # 只建 symlink，既有檔案會備份到 ~/.rcfiles-backup/
./install.sh --deps   # 順便裝 oh-my-zsh / powerlevel10k / zsh plugins / 字型 / herdr / Claude Code status line
./install.sh --deps --statusline both   # 不問，直接指定 status line（herdr / ccstatusline / both）
./install.sh --pull-herdr-app   # 把目前的 herdr-app 設定複製回 repo
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
| `config/herdr-app/` | `~/.config/herdr-app/`（複製） | herdr-app（桌面版）的按鍵、設定、layout 和 sidebar mod，見下方 |
| `config/ccstatusline/settings.json` | `~/.config/ccstatusline/settings.json` | [ccstatusline](https://github.com/sirmalloc/ccstatusline) 設定，Claude Code 的 status line |
| `.vimrc` | `~/.vimrc` | 不依賴 plugin 的 vim 設定 |
| `.screenrc` | `~/.screenrc` | screen 基本設定（沒 tmux 的機器用） |
| `ai/` | `~/.claude/skills/personal` | Claude Code plugin `personal`，個人用 AI 工具，skill 以 `personal:<name>` 出現。說明見 [`ai/README.md`](ai/README.md) |
| `ai/skills/shar0-blog` | `~/.codex/skills/shar0-blog` | 同一個 skill 給 Codex 用，Codex 沒有 plugin，逐個 skill 連 |

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

### herdr-app

herdr-app 是 herdr 的桌面版，設定在 `~/.config/herdr-app/`（`HERDR_APP_HOME` 可以改位置）。
那個資料夾大部分是 app 自己寫的（狀態、產生的型別檔），只追蹤自己改過的：

| 檔案 | 內容 |
| --- | --- |
| `keys.json` | 鍵位，從上面 herdr 的設定搬過來；prefix 寫成兩段按鍵，例如 `ctrl-a c` |
| `settings.json` | 縮放、主題（`atom-one-dark`）等 |
| `layouts/my-main.json` | 內建 `main` layout 的複本，換成下面這些 mod，tab 列下方多一條 `agent-usage`，pane 的標題列移到下面，右邊的 Files / Changes 面板多一個 Git |
| `mods/my-tabs/` | 內建 tab 列的複本，Files、Changes 旁邊多一個 Git 按鈕；`my-tabs.files` / `changes` / `git` 指令切換那個面板（`ctrl-a g` 用的就是 `my-tabs.git`） |
| `mods/my-spaces/` | Spaces 清單：只有狀態圖示和名稱，不顯示 branch / ahead-behind |
| `mods/my-agents/` | Agents 清單：每個 agent 三行（狀態、agent 名稱依種類上色；在做什麼；space · tab） |
| `mods/my-pane/` | pane 下方一行：程式名稱、完整路徑（家目錄縮成 `~`；agent 用它自己回報的目錄）、git branch、worktree 標記、ahead/behind、`+` staged `~` unstaged `?` untracked；在 repo 裡滑過去有 `+ worktree` |
| `mods/git-sidebar/` | 右邊面板的 Git（tab 列的 Git 按鈕、`ctrl-a g`，或點 pane 下方的 branch），跟 Files / Changes 同一個位置：焦點 pane 所在 repo 裡你的 PR——只列目前 `gh` 帳號開的（`--author @me`，`gh auth switch` 切換）：目前 branch 那個的每個 check（GitHub Actions、Jenkins 這類 commit status），和其他 open 的（本機有 branch 的排前面）、worktree（點了切到開著它的 tab，沒有就在這個 space 開一個；`×` 刪除一個；`Clean up` 先 `git fetch --prune`，列出 branch 已合併進主線或遠端已刪 gone 的，乾淨又沒開著的預設勾選，確認後一次刪）、本機 branch（`+ worktree` 直接開）。刪除會先關掉開在裡面的 tab，再 `git worktree remove`（有改動或 submodule 時加 `--force`，確認視窗會先列出會失去什麼），已合併 / gone 的 branch 用 `git branch -d` 一起刪（沒合併的 git 會拒絕，就保留），最後 `git worktree prune`。git 15 秒、`gh` 60 秒問一次，只在打開時。新 worktree 開成目前 space 的 tab（以 branch 命名），放在 `~/.herdr/worktrees/<repo>/<branch>`：本機 branch 直接 checkout，只在 origin 的追蹤 `origin/<branch>`，新名字從目前的 HEAD 開 |
| `mods/agent-usage/` | tab 列下方那條：左邊是這個 tab 的 agent（Claude Code、Codex）的 session——model、effort、context、費用；右邊是它的帳號用量（5 小時 / 每週），只看這個 tab 所在機器的 session（不同機器常登入不同帳號）。沒有 agent 的 tab 只顯示所有 agent 的用量 |

**用複製，不用 symlink**：herdr-app 偵測不到 symlink 目標的變動，連過去的檔案改了不會生效，寫錯也不會報錯，要重開 app 才讀得到。所以：

- `./install.sh` 把 repo 的版本複製過去（不同的話先備份到 `~/.rcfiles-backup/`）
- 在 app 裡改了設定（或直接改 `~/.config/herdr-app/` 的檔案）之後，跑 `./install.sh --pull-herdr-app` 複製回 repo 再 commit
- 要追蹤新檔案（例如新的 mod），先手動複製一份到 `config/herdr-app/` 的同樣位置，之後 pull 就會一起更新

新機器裝完後，按 `ctrl-shift-l` 切到 `my-main` layout，或執行 `herdr-app do layout.switch --name my-main`。
`my-*` 是從 herdr-app 0.1.14 內建版本複製出來改的，之後不會跟著 herdr-app 更新。

### Claude Code status line

`./install.sh --deps` 會問要用哪個（在 terminal 裡跑才會問），再把 `~/.claude/settings.json` 的 `statusLine` 指過去，
其他設定不動，改之前備份到 `~/.rcfiles-backup/`：

| 選項 | 裝什麼 | statusLine |
| --- | --- | --- |
| `herdr` | `agent-status`（cargo） | `agent-status claude`，不在 herdr 裡印一行簡單的文字 |
| `ccstatusline` | ccstatusline（npm） | `ccstatusline`，給沒有 herdr-app 的機器 |
| `both` | 兩個都裝 | `agent-status claude`，不在 herdr 裡交給 ccstatusline 畫 |

不問的時候（例如 `bootstrap.sh`）：有 `--statusline <選項>` 或 `RCFILES_STATUSLINE` 就照它，
否則有 `herdr-app` 的機器用 `both`，沒有的用 `ccstatusline`。

選 `herdr` 或 `both`、而且有裝 Codex 的話，也會在 `~/.codex/hooks.json` 的 `SessionStart`、`PostToolUse`、`Stop`
加上 `agent-status codex`（加在既有 hook 後面，先備份）。**新 hook 要在 Codex 裡用 `/hooks` 核准一次才會跑**，
`~/.codex/config.toml` 的 `[features]` 也要有 `hooks = true`。

### agent-status：`tools/agent-status`

Rust 寫的小程式，把 agent 的 session 狀態寫成終端機 label `agent.status`
（`hc label $HC_TERMINAL_ID agent.status=...`，內容沒變就不寫），herdr-app 的 `agent-usage` 和 `my-pane` 即時讀它。
內容是一個 JSON，一定有 `agent`，其他是 agent 有回報的才有：

```json
{"agent":"claude","model":"Opus 5.5","effort":"xhigh","ctx":{"pct":21.3,"used":213010,"size":1000000},
 "cost":4.85,"limits":{"5h":{"pct":12,"reset":1762700000},"7d":{"pct":31,"reset":1763000000}},"cwd":"…"}
```

| | 怎麼被呼叫 | 資料來源 | 不在 herdr 裡 |
| --- | --- | --- | --- |
| `agent-status claude` | Claude Code 的 `statusLine` | Claude Code 從 stdin 給的 session JSON | 有 ccstatusline 就交給它畫，沒有就印一行，例如 `Opus 5.5 · xhigh \| ctx 21% (213k/1.0M) \| $4.85 \| 5h 12% · 7d 31%` |
| `agent-status codex` | Codex 的 hook | hook JSON 裡 `transcript_path` 指的 rollout 檔：最後一筆 `turn_context`（model、effort、資料夾）和 `token_count`（context、5 小時 / 每週用量）；Codex 沒有 session 費用 | 什麼都不做，Codex 有自己的 status line |

資料全部來自 agent 自己給的東西：不連網、不讀 token。在 herdr 裡 Claude Code 本身的 status line 是空的。
要支援別的 agent（例如 pi），就是寫一個同樣格式的 `agent.status`，mod 不用改（`agent-usage` 的 `NAMES` 加上名字）。

## 依賴

`./install.sh --deps` 會處理：

- [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)、[powerlevel10k](https://github.com/romkatv/powerlevel10k)
- zsh-autosuggestions、zsh-syntax-highlighting、zsh-completions
- MesloLGS NF 字型（p10k 用；Linux 只在有桌面環境時裝）——記得在 terminal 把字型切過去
- [herdr](https://herdr.dev)（裝到 `~/.local/bin`，Linux / macOS）
- Claude Code 的 status line（見 [Claude Code status line](#claude-code-status-line)）：
  ccstatusline 用 npm 裝；`agent-status` 用 cargo 裝到 `~/.local/bin`（跟 `hc`、`herdr` 同一處：
  裝 Rust 之前就開著的 agent，PATH 裡沒有 `~/.cargo/bin`），沒有 cargo 就略過——先裝
  [rustup](https://rustup.rs)：`curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --no-modify-path`
  （`.zshenv` 會自己載入 `~/.cargo/env`）

zsh、bash、git、curl、tmux、vim 本身由 `bootstrap.sh` 用套件管理器裝（`bootstrap.sh` 是 POSIX sh，所以連 bash 都沒有的 Alpine / FreeBSD 也能跑）。
