-- 左側 sidebar 仿 IDEA：上面檔案樹、下面 git 變更（LazyVim 的 ui.edgy extra 會把 neo-tree 每個 source 疊在左邊）
-- 拿掉 buffers source，sidebar 只留這兩塊；<leader>be 依賴 buffers source，一起關掉
return {
  {
    "nvim-neo-tree/neo-tree.nvim",
    keys = {
      { "<leader>be", false },
    },
    opts = function(_, opts)
      opts.sources = { "filesystem", "git_status" }
      -- 只有單一子資料夾的鏈（src/main/java/com/...）合成一行，少掉好幾層縮排，名稱比較不會被截斷
      opts.filesystem = vim.tbl_deep_extend("force", opts.filesystem or {}, { group_empty_dirs = true })
      opts.git_status = vim.tbl_deep_extend("force", opts.git_status or {}, { group_empty_dirs = true })
      -- 截斷是 neo-tree 的 "container" 元件做的：它把每行裁到視窗寬，右邊再塞 git 狀態等欄位。
      -- 檔案與資料夾改成不包 container，整行完整輸出、超出視窗的部分像 IDEA 一樣左右捲動看
      -- （觸控板／滑鼠左右滑，或 zl / zh、zL / zH、$ 跳到行尾）。git 狀態等標記改接在名稱後面。
      -- 原本靠右的 file_size / type / last_modified / created 只在很寬時才會出現，這裡不放。
      opts.renderers = vim.tbl_extend("force", opts.renderers or {}, {
        directory = {
          { "indent" },
          { "icon" },
          { "current_filter" },
          { "name" },
          { "symlink_target", highlight = "NeoTreeSymbolicLinkTarget" },
          { "clipboard" },
          { "diagnostics", errors_only = true, hide_when_expanded = true },
          { "git_status", hide_when_expanded = true },
        },
        file = {
          { "indent" },
          { "icon" },
          { "name" },
          { "symlink_target", highlight = "NeoTreeSymbolicLinkTarget" },
          { "clipboard" },
          { "bufnr" },
          { "modified" },
          { "diagnostics" },
          { "git_status" },
        },
      })
    end,
  },
  -- 左側 sidebar 寬度：edgy 只認自己的設定，滑鼠拖分隔線會被它改回去，鍵位調寬也縮不回預設寬度以下，
  -- 而 LazyVim 給的 <C-Left>/<C-Right> 在 macOS 被「切換桌面」吃掉，傳不進 nvim。
  -- 改由 vim.g.sidebar_width 決定寬度：
  --   * 滑鼠拖 sidebar 右邊的分隔線 → 記住拖完的寬度
  --   * 游標在 sidebar 裡：<C-w>> / <C-w>< 加寬／縮窄 2 欄（前面加數字就是幾欄，如 10<C-w>>），<C-w>= 回到 40
  {
    "folke/edgy.nvim",
    init = function()
      vim.g.sidebar_width = vim.g.sidebar_width or 40
      -- 要比 edgy 自己的 WinResized（載入時才註冊）先跑，edgy 接著重排時才會用新寬度
      vim.api.nvim_create_autocmd("WinResized", {
        group = vim.api.nvim_create_augroup("sidebar_width_drag", { clear = true }),
        callback = function()
          if not package.loaded["edgy"] or require("edgy.animate").is_active() then
            return
          end
          local cache = require("edgy.window").cache
          for _, win in ipairs(vim.v.event.windows) do
            local edgy_win = cache[win]
            if edgy_win and edgy_win.view.edgebar.pos == "left" and edgy_win.width and vim.api.nvim_win_is_valid(win) then
              local width = vim.api.nvim_win_get_width(win)
              if width ~= edgy_win.width then
                vim.g.sidebar_width = width
                return
              end
            end
          end
        end,
      })
    end,
    opts = function(_, opts)
      -- 只管左側 sidebar；其他 edgy 面板（下方 terminal 等）維持 edgy 原本的行為
      local function resize(delta)
        return function(win)
          if win.view.edgebar.pos ~= "left" then
            return win:resize("width", delta * 2)
          end
          local step = vim.v.count > 0 and vim.v.count or 2
          vim.g.sidebar_width = math.max(10, vim.g.sidebar_width + delta * step)
          require("edgy.layout").update()
        end
      end
      opts.options = vim.tbl_deep_extend("force", opts.options or {}, {
        left = {
          size = function()
            return vim.g.sidebar_width
          end,
        },
      })
      opts.keys = vim.tbl_extend("force", opts.keys or {}, {
        ["<c-w>>"] = resize(1),
        ["<c-w><lt>"] = resize(-1),
        ["<c-Right>"] = resize(1),
        ["<c-Left>"] = resize(-1),
        ["<c-w>="] = function(win)
          if win.view.edgebar.pos ~= "left" then
            return win.view.edgebar:equalize()
          end
          vim.g.sidebar_width = 40
          require("edgy.layout").update()
        end,
      })
    end,
  },
}
