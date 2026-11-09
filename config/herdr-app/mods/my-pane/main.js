// A pane's bar, for layouts that frame their panes; this one sits under the pane:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "my-pane" },
//                                            "position": "bottom", "height": 30 } } }
// Cloned from the shipped `pane` mod. One line: the program's icon and name, where
// the pane is (the full folder, home as ~) and its git state (branch, a mark when
// it's a linked worktree, ahead/behind, and staged (+), unstaged (~) and untracked
// (?) files); then the agent's status and, on hover, split / zoom / close buttons.
// An agent's session (model, context, ...) is in the bar under the tabs (agent-usage).
// Props from the app: { pane, terminal }.
//
// An agent's folder comes from the `agent.status` label that rcfiles/tools/agent-status
// sets (an agent can move into a worktree without the terminal's folder changing).

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, terminals, props, run, theme, home, exec, window } from "herdr";

// git is asked again this often while the window is in front, besides on a new
// folder or an agent's turn ending.
const FALLBACK = 15000;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Home as ~, on Windows too; long paths keep their start and their last three parts.
function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  const lower = (s) => s.toLowerCase();
  let path = cwd;
  if (lower(cwd) === lower(h)) path = "~";
  else if (lower(cwd).startsWith(lower(h) + "/") || lower(cwd).startsWith(lower(h) + "\\")) path = "~" + cwd.slice(h.length);
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  return path.length > 64 && parts.length > 5 ? [parts[0], "…", ...parts.slice(-3)].join(sep) : path;
}

// The session agent-status reported, while that agent still runs in the terminal
// (herdr's program key or the agent's own report: claude, claude-code, codex).
function agentStatus(terminal) {
  const t = terminal && terminals().find((x) => x.address === terminal);
  if (!t) return null;
  let s;
  try { s = JSON.parse(t.labels?.["agent.status"] ?? "null"); } catch { return null; }
  const a = s?.agent;
  const runs = Boolean(a) && [t.program?.key, t.report?.app].some((n) => n === a || (typeof n === "string" && n.startsWith(a + "-")));
  return runs ? s : null;
}

// `git status --porcelain=v2 --branch` into what the bar shows.
function parse(out) {
  const g = { branch: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0 };
  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.head ")) g.branch = line.slice(14).trim();
    else if (line.startsWith("# branch.ab ")) {
      const [a, b] = line.slice(12).trim().split(" ");
      g.ahead = Math.abs(parseInt(a, 10)) || 0;
      g.behind = Math.abs(parseInt(b, 10)) || 0;
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      if (line[2] !== ".") g.staged++;
      if (line[3] !== ".") g.unstaged++;
    } else if (line.startsWith("u ")) g.unstaged++;
    else if (line.startsWith("? ")) g.untracked++;
  }
  return g;
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.git = null; // null: not a repo (or not asked yet)
    this.asked = null; // [machine, folder] of the last look
    this.at = 0;
    this.lastStatus = null;
    // Cheap check; git only runs when something could have changed.
    cx.timer.every(2000, (cx) => this.check(cx));
    this.check(cx);
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  where(p) {
    const machine = spaces().find((s) => (s.tabs ?? []).some((t) => t.id === p.tab))?.machine ?? null;
    return [machine, agentStatus(p.terminal)?.cwd ?? p.cwd];
  }

  check(cx) {
    const p = this.me();
    if (!p?.terminal) return;
    const [machine, dir] = this.where(p);
    if (!dir) return;
    const moved = JSON.stringify([machine, dir]) !== JSON.stringify(this.asked);
    const turned = this.lastStatus !== p.status && p.status !== "working";
    this.lastStatus = p.status;
    const due = window()?.active && Date.now() - this.at > FALLBACK;
    if (moved || turned || due) this.look(machine, dir, cx);
  }

  look(machine, dir, cx) {
    if (this.busy) return;
    this.busy = true;
    this.asked = [machine, dir];
    this.at = Date.now();
    cx.spawn(async (cx) => {
      try {
        // No optional locks: a status that touched the index would race the agent's git.
        const r = await exec("git", ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], { cwd: dir, on: machine });
        if (r.code !== 0) this.git = null;
        else {
          const g = parse(r.stdout);
          const d = await exec("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { cwd: dir, on: machine });
          const [own, common] = d.stdout.trim().split(/\r?\n/);
          g.worktree = d.code === 0 && own !== common;
          this.git = g;
        }
      } catch {
        this.git = null;
      }
      this.busy = false;
      cx.notify();
    });
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/my-pane/${icon}.svg`).size(14));
  }

  gitPart(t, g) {
    const n = (text, color) => div().flex_none().text_color(color).child(text);
    return h_flex().flex_none().gap(6).items_center()
      .child(svg(`mods/workspace-chrome/branch.svg`).size(12).flex_none().text_color(g.worktree ? t.accent : t.dim))
      .child(div().flex_none().max_w(220).truncate().text_color(g.worktree ? t.accent : t.muted).child(g.branch === "(detached)" ? "detached" : g.branch ?? "?"))
      .when(g.worktree, (el) => el.child(div().flex_none().px(5).h(16).flex().items_center().rounded(4).bg(t.accent + "26").text_size(10.5).text_color(t.accent).child("worktree")))
      .when(g.ahead > 0, (el) => el.child(n(`↑${g.ahead}`, t.ansi2)))
      .when(g.behind > 0, (el) => el.child(n(`↓${g.behind}`, t.ansi1)))
      .when(g.staged > 0, (el) => el.child(n(`+${g.staged}`, t.ansi2)))
      .when(g.unstaged > 0, (el) => el.child(n(`~${g.unstaged}`, t.ansi3)))
      .when(g.untracked > 0, (el) => el.child(n(`?${g.untracked}`, t.dim)));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const dir = p.terminal ? this.where(p)[1] : p.cwd;
    // Only what was asked for this folder: a stale answer would point at the wrong repo.
    const g = this.asked?.[1] === dir ? this.git : null;

    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .min_w(0)
      .px(10)
      .gap(8)
      .items_center()
      .overflow_hidden()
      .bg(t.background)
      .border_t(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(200).font_medium().text_color(t.foreground).child(name))
      .child(div().min_w(0).flex_shrink(1).truncate().text_color(t.dim).child(folder(dir)))
      .when(Boolean(g), (el) => el.child(this.gitPart(t, g)))
      .child(div().flex_1())
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
