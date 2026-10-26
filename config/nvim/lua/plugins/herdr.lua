-- herdr-nvim 的 nvim 端：annotation（<leader>a 系列），herdr 端的鍵位在 config/herdr/config.toml
--
-- sidebar daemon 會在 VimEnter 再呼叫一次 require("herdr-nvim").setup()，
-- 用預設 keymaps = true 的話每個鍵位都會跳 "not overriding existing map" 警告。
-- 這裡關掉預設鍵位自己綁；第二次 setup() 沒帶參數，會沿用這裡的 keymaps = false。
local function herdr(fn, ...)
  local args = { ... }
  return function()
    require("herdr-nvim")[fn](unpack(args))
  end
end

-- sidebar daemon 是 headless 啟動、之後才由 sidebar pane 接上 remote UI；
-- 平常在 pane 裡開 nvim 時 TUI 在載入 config 前就接上了
local function is_herdr_sidebar()
  return vim.env.HERDR_TAB_ID ~= nil and #vim.api.nvim_list_uis() == 0
end

-- herdr-nvim 用 workspace 的目錄啟動 daemon，tab 裡的 agent 在 worktree 時 sidebar 不會跟過去，
-- 所以改看同一個 tab 裡 agent pane 的 cwd
local function tab_agent_cwd()
  local ok, res = pcall(function()
    return vim.system({ "herdr", "pane", "list" }, { text = true }):wait(2000)
  end)
  if not ok or res.code ~= 0 then
    return nil
  end
  local decoded, data = pcall(vim.json.decode, res.stdout, { luanil = { object = true } })
  if not decoded then
    return nil
  end
  for _, pane in ipairs(data.result.panes) do
    if pane.tab_id == vim.env.HERDR_TAB_ID and pane.agent then
      return pane.foreground_cwd
    end
  end
end

local function buf_is_empty(buf)
  return vim.api.nvim_buf_get_name(buf) == ""
    and vim.api.nvim_buf_line_count(buf) == 1
    and vim.api.nvim_buf_get_lines(buf, 0, 1, false)[1] == ""
end

-- LazyVim 的 neo-tree 關了 bind_to_cwd，git_status 也只記得打開時的目錄，cd 之後不會自己跟過去，
-- 所以把已經開著的檔案樹和 git 變更都指到新目錄
local function retarget_neo_tree(dir)
  if not package.loaded["neo-tree"] then
    return
  end
  local manager = require("neo-tree.sources.manager")
  for _, source in ipairs({ "filesystem", "git_status" }) do
    local state = manager.get_state(source)
    if state.winid and vim.api.nvim_win_is_valid(state.winid) then
      manager.navigate(state, dir)
    end
  end
end

return {
  {
    "ChmaraX/herdr-nvim",
    lazy = false,
    opts = { keymaps = false },
    keys = {
      { "<leader>ac", herdr("comment_line"), desc = "Comment line" },
      { "<leader>ac", herdr("comment_selection"), mode = "x", desc = "Comment selection" },
      { "<leader>al", herdr("list_comments"), desc = "List comments" },
      { "<leader>as", herdr("send_all", { submit = false }), desc = "Paste comments to agent" },
      { "<leader>aS", herdr("send_all", { submit = true }), desc = "Send comments to agent" },
      { "<leader>ai", herdr("ref_line"), desc = "Reference line at agent" },
      { "<leader>ai", herdr("ref_selection"), mode = "x", desc = "Reference selection at agent" },
    },
    init = function()
      if not is_herdr_sidebar() then
        return
      end
      -- 每次打開 sidebar 都跟到 agent 的目錄（只在 agent 換目錄時才 cd，不蓋掉你在 nvim 裡自己 cd 的結果）；
      -- 第一次打開時開左側 edgy（檔案樹 + git 變更，dashboard 在下面的 snacks spec 關掉）
      local synced_cwd
      local opened = false
      vim.api.nvim_create_autocmd("UIEnter", {
        callback = function()
          vim.schedule(function()
            local cwd = tab_agent_cwd()
            if cwd and cwd ~= synced_cwd then
              synced_cwd = cwd
              vim.cmd.cd(vim.fn.fnameescape(cwd))
              retarget_neo_tree(cwd)
            end
            if not opened then
              opened = true
              if buf_is_empty(vim.api.nvim_get_current_buf()) then
                require("edgy").open("left")
              end
            end
          end)
        end,
      })
    end,
  },
  {
    "folke/snacks.nvim",
    opts = function(_, opts)
      if is_herdr_sidebar() then
        opts.dashboard = vim.tbl_extend("force", opts.dashboard or {}, { enabled = false })
      end
    end,
  },
  { "folke/which-key.nvim", opts = { spec = { { "<leader>a", group = "herdr" } } } },
}
