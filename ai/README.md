# ai

個人用的 AI 工具，一個 Claude Code plugin，名字是 `personal`。

`install.sh` 把這個目錄 symlink 到 `~/.claude/skills/personal`，裡面的 skill 在 Claude Code 以 `personal:<skill>` 出現。Codex 沒有 plugin 的概念，只認 `~/.codex/skills/<skill>`，所以每個 skill 在 `install.sh` 的 `LINKS` 各自連一條。

## 目前的 skill

| skill | 用途 | Claude | Codex |
| --- | --- | --- | --- |
| `skills/shar0-blog` | shar0.dev 技術文章的寫作與重寫: 舊文重寫、筆記產文，依 `references/editorial-standard.md` 收斂主線與去 AI 味 | `personal:shar0-blog` | `$shar0-blog` |

## 加新的 skill

1. 建 `skills/<name>/SKILL.md`，frontmatter 要有 `name` 和 `description`
2. 要給 Codex 用的話加 `skills/<name>/agents/openai.yaml`
3. 在 `install.sh` 的 `LINKS` 加一行 `ai/skills/<name>  .codex/skills/<name>`，Claude 那邊連的是整個 `ai/`，不用再加
4. 跑 `./install.sh`
