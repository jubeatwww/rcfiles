// A side panel (beside Files and Changes) for the git repo of the focused pane:
//   - your pull request for the current branch and each of its checks (GitHub Actions
//     check runs and commit statuses, such as Jenkins)
//   - your other open pull requests in the repo, those with a branch here first
//     ("yours": the active gh account, `gh pr list --author @me`)
//   - worktrees: click to go to the tab showing one, or to open a tab there; × removes
//     one, Clean up removes those whose branch is merged or gone (worktrees.js)
//   - local branches: upstream state, a pull request badge; + worktree makes one
// It is the "git" child of the side panel's stack ("panel" > "panel-body"), opened with
// the tab bar's Git button (my-tabs), ctrl-a g, or by clicking the branch under a pane.
// Asks git every 15 s and GitHub (gh) every 60 s, only while shown; ↻ asks now.
// An agent's folder comes from its `agent.status` label (rcfiles/tools/agent-status).
//
// New worktrees open as a tab in the current space, not as a space (the shipped
// worktree mod's way). Opened with props { dialog: "worktree", dir, machine, space },
// this mod is the dialog that asks for the branch (my-pane's + worktree uses it too).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { panes, spaces, focused, layout, run, theme, exec, window, openOverlay, closeOverlay, props, shared, setShared } from "herdr";
import {
  slash, same, inside, tilde, repoName, agentDir, parseWorktrees, parseBranches, BRANCH_FORMAT,
  homeOf, worktreeRoot, addWorktree, baseBranch, panesIn, inspect, removeWorktree,
} from "./worktrees.js";

// Set when a dialog changed worktrees or branches: the panel asks git again.
const CHANGED = "git-sidebar.changed";

const NODE = "git";
const PANEL = "panel";
const STACK = "panel-body";
const GIT_EVERY = 15000;
const GH_EVERY = 60000;
const SHORT = { prs: 8, branches: 12 };
const PR_FIELDS = "number,title,headRefName,isDraft,reviewDecision,author,url,statusCheckRollup";
const PR_LIMIT = 50;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
// The side panel is open on this one.
const shown = () => {
  const root = layout(), panel = find(root, PANEL), stack = find(root, STACK);
  return Boolean(panel) && !panel.hidden && stack?.active === NODE;
};

const firstLine = (s) => (s ?? "").trim().split(/\r?\n/).find(Boolean) ?? "";

function ago(unix) {
  const d = Date.now() / 1000 - unix;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
}

// The focused terminal's folder, machine and space.
function focusedPlace() {
  const f = focused();
  const p = panes().find((x) => x.pane === f?.pane) ?? panes().find((x) => x.terminal && x.terminal === f?.terminal);
  if (!p?.terminal) return null;
  const space = spaces().find((s) => (s.tabs ?? []).some((t) => t.id === p.tab));
  const dir = agentDir(p.terminal) ?? p.cwd;
  return dir ? { dir, machine: space?.machine ?? null, space: space?.id ?? null } : null;
}

// One check: ok, fail, pending or skip. Check runs (Actions) have status and conclusion;
// commit statuses (Jenkins and the like) have state.
function checkState(c) {
  if (c.__typename === "CheckRun") {
    if (c.status && c.status !== "COMPLETED") return "pending";
    if (c.conclusion === "SUCCESS") return "ok";
    if (c.conclusion === "NEUTRAL" || c.conclusion === "SKIPPED") return "skip";
    return c.conclusion ? "fail" : "pending";
  }
  if (c.state === "SUCCESS") return "ok";
  if (c.state === "PENDING" || c.state === "EXPECTED") return "pending";
  return "fail";
}

function rollup(checks) {
  if (!checks?.length) return null;
  const states = checks.map(checkState);
  return states.includes("fail") ? "fail" : states.includes("pending") ? "pending" : "ok";
}

const checkName = (c) => (c.__typename === "CheckRun" ? [c.workflowName, c.name].filter(Boolean).join(" / ") : c.context) || "check";
const checkUrl = (c) => c.detailsUrl || c.targetUrl || null;

const REVIEW = { APPROVED: ["Approved", "ansi2"], CHANGES_REQUESTED: ["Changes requested", "ansi1"], REVIEW_REQUIRED: ["Review required", "dim"] };

// Opens on this computer, also for a space on another machine.
function openUrl(url) {
  if (!url) return;
  const p = window()?.platform;
  const [cmd, args] = p === "windows" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : p === "macos" ? ["open", [url]] : ["xdg-open", [url]];
  exec(cmd, args).catch(() => {});
}

export default class GitSidebar extends View {
  init(_props, cx) {
    if (props()?.dialog === "worktree") return this.initDialog(cx);
    if (props()?.dialog === "cleanup") return this.initCleanup(cx);
    this.place = null; // { dir, machine, space } of the last focused terminal
    this.key = null;
    this.repo = undefined; // undefined: not asked; null: not a repo
    this.gitAt = 0;
    this.gh = {}; // [machine, common dir] -> { at, prs, error }
    this.expanded = { prs: false, branches: false };
    this.hovered = null;
    cx.timer.every(1000, (cx) => this.check(cx));
  }

  check(cx, force = false) {
    if (!shown()) return;
    // A dialog added or removed worktrees.
    const changed = shared(CHANGED) ?? null;
    if (changed !== this.changed) {
      this.changed = changed;
      force = true;
    }
    const place = focusedPlace();
    // Focus on a mod or nothing: keep the last repo.
    if (place) this.place = place;
    if (!this.place) return;
    const key = JSON.stringify([this.place.machine, slash(this.place.dir)]);
    const moved = key !== this.key;
    if (moved) {
      this.key = key;
      this.repo = undefined;
      cx.notify();
    }
    if (force || moved || Date.now() - this.gitAt > GIT_EVERY) this.loadGit(cx, force);
  }

  loadGit(cx, force) {
    if (this.gitBusy) return;
    this.gitBusy = true;
    this.gitAt = Date.now();
    const { dir, machine } = this.place;
    const key = this.key;
    const git = (args) => exec("git", args, { cwd: dir, on: machine, timeout: 10000 });
    cx.spawn(async (cx) => {
      let repo = null;
      try {
        const head = await git(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
        if (head.code === 0) {
          const [top, common, branch] = head.stdout.trim().split(/\r?\n/);
          const [wt, refs] = await Promise.all([
            git(["worktree", "list", "--porcelain"]),
            git(["for-each-ref", "refs/heads", "--sort=-committerdate", BRANCH_FORMAT]),
          ]);
          const c = slash(common);
          repo = {
            top,
            common: c,
            machine,
            name: repoName(c),
            branch: branch && branch !== "HEAD" ? branch : null,
            worktrees: wt.code === 0 ? parseWorktrees(wt.stdout) : [],
            branches: refs.code === 0 ? parseBranches(refs.stdout) : [],
          };
        }
      } catch {
        repo = null;
      }
      this.gitBusy = false;
      // Focus moved on while git ran: that answer is for another folder.
      if (key !== this.key) return;
      this.repo = repo;
      if (repo) this.loadGh(cx, force);
      cx.notify();
    });
  }

  ghKey() {
    return this.repo ? JSON.stringify([this.repo.machine, this.repo.common]) : null;
  }

  loadGh(cx, force) {
    const repo = this.repo;
    const key = this.ghKey();
    const cached = this.gh[key];
    if (this.ghBusy || (!force && cached && Date.now() - cached.at < GH_EVERY)) return;
    this.ghBusy = true;
    const on = repo.machine;
    const gh = (args) => exec("gh", args, { cwd: repo.top, on, timeout: 20000 });
    cx.spawn(async (cx) => {
      let entry;
      try {
        // Only the gh account's own: `gh auth switch` changes whose.
        const r = await gh(["pr", "list", "--state", "open", "--author", "@me", "--limit", String(PR_LIMIT), "--json", PR_FIELDS]);
        entry = r.code === 0
          ? { prs: JSON.parse(r.stdout), error: null }
          : { prs: cached?.prs ?? null, error: firstLine(r.stderr) || "gh pr list failed" };
      } catch (e) {
        entry = { prs: cached?.prs ?? null, error: `gh: ${e?.message ?? e}` };
      }
      this.gh[key] = { ...entry, at: Date.now() };
      this.ghBusy = false;
      cx.notify();
    });
  }

  // The tab showing a worktree (a pane whose folder is in it, not in a deeper worktree;
  // this space's first), else a new tab there in this space.
  goTo(w) {
    const r = this.repo;
    const deepest = [...r.worktrees].sort((a, b) => slash(b.path).length - slash(a.path).length);
    const owner = (cwd) => deepest.find((x) => inside(cwd, x.path));
    const spaceOf = new Map(spaces().filter((s) => (s.machine ?? null) === r.machine).flatMap((s) => (s.tabs ?? []).map((t) => [t.id, s.id])));
    const hit = panes()
      .filter((p) => spaceOf.has(p.tab) && owner(agentDir(p.terminal) ?? p.cwd ?? "") === w)
      .sort((a, b) => Number(spaceOf.get(b.tab) === this.place?.space) - Number(spaceOf.get(a.tab) === this.place?.space))[0];
    if (hit) run("tab.select", { id: hit.tab });
    else run("tab.new", { space: this.place?.space, folder: w.path, name: w.branch ?? undefined });
  }

  // + in the Worktrees header: ask for the branch.
  newWorktree() {
    const { dir, machine, space } = this.place;
    openOverlay({ mod: "git-sidebar", kind: "dialog", width: 460, height: 210, props: { dialog: "worktree", dir, machine, space } });
  }

  // + worktree on a branch: no question.
  worktreeFor(branch, cx) {
    if (this.adding) return;
    this.adding = branch;
    this.addError = null;
    cx.notify();
    const { dir, machine, space } = this.place;
    cx.spawn(async (cx) => {
      let error;
      try { error = await addWorktree({ dir, machine, space, branch }); } catch (e) { error = String(e?.message ?? e); }
      this.adding = null;
      this.addError = error || null;
      this.check(cx, true);
      cx.notify();
    });
  }

  // ---------------------------------------------------------------------------
  // The dialog: props { dialog: "worktree", dir, machine, space, overlay }

  initDialog(cx) {
    const p = props();
    this.text = "";
    this.error = "";
    this.busy = false;
    this.info = undefined; // undefined: looking; null: not a repo
    this.input = InputState.new({ value: "", placeholder: "branch name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--abbrev-ref", "HEAD"], { cwd: p.dir, on: p.machine });
        if (r.code !== 0) this.info = null;
        else {
          const [common, head] = r.stdout.trim().split(/\r?\n/);
          const name = repoName(slash(common));
          const root = worktreeRoot(await homeOf(p.machine), name);
          this.info = { name, head: head === "HEAD" ? "this commit" : head, root: p.machine ? root : tilde(root) };
        }
      } catch (e) {
        this.info = null;
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  submit(cx) {
    if (this.busy || !this.info) return;
    const p = props();
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.error = await addWorktree({ dir: p.dir, machine: p.machine, space: p.space, branch: this.text }); }
      catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      if (!this.error) {
        setShared(CHANGED, Date.now());
        closeOverlay(p.overlay);
      }
      cx.notify();
    });
  }

  renderDialog(t) {
    const i = this.info;
    const detail = i === undefined ? "…" : i === null ? "Not in a git repository."
      : `Opens as a tab here, from ${i.root}/. A local branch is checked out, one only on origin is tracked, a new name starts from ${i.head}.`;
    return v_flex().id("git-worktree").size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e) => { if (e.key === "escape") closeOverlay(props().overlay); })
      .child(div().font_semibold().text_color(t.foreground).child(`New worktree${i ? ` of ${i.name}` : ""}`))
      .child(div().text_color(t.muted).child(detail))
      .when(Boolean(i), (el) => el.child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1)
        .border_color(t.accent).bg(t.background).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(this.busy, (el) => el.child(div().text_color(t.dim).child("Checking out…")));
  }

  // ---------------------------------------------------------------------------
  // Removing: props { dialog: "cleanup", dir, machine, only?, overlay }. With `only`
  // (a worktree path) it is that one; without, every worktree whose branch is merged
  // into the base branch or gone from origin, after `git fetch --prune`.

  // "Clean up" in the Worktrees header.
  cleanUp() {
    const { dir, machine } = this.place;
    openOverlay({ mod: "git-sidebar", kind: "dialog", width: 540, height: 440, props: { dialog: "cleanup", dir, machine } });
  }

  // × on a worktree row.
  removeOne(w) {
    const { dir, machine } = this.place;
    openOverlay({ mod: "git-sidebar", kind: "dialog", width: 500, height: 300, props: { dialog: "cleanup", dir, machine, only: w.path } });
  }

  initCleanup(cx) {
    const p = props();
    this.phase = p.only ? "checking" : "fetching";
    this.items = [];
    this.error = "";
    const git = (args, timeout = 30000) => exec("git", args, { cwd: p.dir, on: p.machine, timeout });
    cx.spawn(async (cx) => {
      try {
        // Branches deleted on origin show as gone only after a prune. Offline: go on.
        if (!p.only) await git(["fetch", "--prune", "--quiet", "origin"], 120000).catch(() => {});
        this.phase = "checking";
        cx.notify();
        this.all = parseWorktrees((await git(["worktree", "list", "--porcelain"])).stdout);
        this.main = this.all[0]?.path;
        this.base = await baseBranch(git);
        const merged = new Set(this.base ? (await git(["branch", "--merged", this.base, "--format=%(refname:short)"])).stdout.split(/\r?\n/).filter(Boolean) : []);
        const gone = new Set(parseBranches((await git(["for-each-ref", "refs/heads", BRANCH_FORMAT])).stdout).filter((b) => b.gone).map((b) => b.name));
        const targets = this.all.filter((w) => !w.main && (p.only ? same(w.path, p.only) : w.branch && (merged.has(w.branch) || gone.has(w.branch))));
        for (const w of targets) {
          const found = await inspect(w, { main: this.main, machine: p.machine });
          const open = panesIn(w, this.all, p.machine).length;
          // Ticked unless it would lose something or close something.
          const safe = found.dirty === 0 && !found.moduleCommits && open === 0;
          this.items.push({ w, ...found, merged: merged.has(w.branch), gone: gone.has(w.branch), on: Boolean(p.only) || safe });
          cx.notify();
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.phase = "ready";
      cx.notify();
    });
  }

  runCleanup(cx) {
    const chosen = this.items.filter((i) => i.on);
    if (this.phase !== "ready" || chosen.length === 0) return;
    const p = props();
    this.phase = "removing";
    cx.notify();
    cx.spawn(async (cx) => {
      for (const item of chosen) {
        item.state = "removing";
        cx.notify();
        try { Object.assign(item, await removeWorktree(cx, item.w, item, { main: this.main, machine: p.machine, all: this.all })); }
        catch (e) { item.removed = false; item.error = String(e?.message ?? e); }
        item.state = "done";
        cx.notify();
      }
      await exec("git", ["worktree", "prune"], { cwd: this.main, on: p.machine }).catch(() => {});
      setShared(CHANGED, Date.now());
      this.phase = "done";
      cx.notify();
    });
  }

  cleanupItem(t, item, i) {
    const w = item.w;
    const open = panesIn(w, this.all, props().machine).length;
    const warn = (text, color) => div().text_size(11.5).text_color(color).child(text);
    const reason = [item.merged && `merged into ${this.base}`, item.gone && "gone from origin"].filter(Boolean).join(", ");
    const result = item.state === "removing" ? warn("Removing…", t.dim)
      : item.state === "done" ? (item.removed
        ? warn(`Removed${item.branch ? `; branch ${item.branch}` : "; branch kept"}`, t.ansi2)
        : warn(item.error, t.ansi1))
      : null;
    return h_flex().id(`clean-${i}`).px(8).py(6).gap(10).items_start().rounded(6)
      .when(this.phase === "ready", (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { item.on = !item.on; cx.notify(); }))
      .child(div().mt(2).size(14).flex_none().rounded(3).border(1).border_color(item.on ? t.accent : t.input)
        .bg(item.on ? t.accent : t.background).text_size(10).text_color(t.accent_foreground).flex().items_center().justify_center()
        .child(item.on ? "✓" : ""))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_none().max_w(260).truncate().font_medium().text_color(t.foreground).child(w.branch ?? "detached"))
          .when(Boolean(reason), (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(reason))))
        .child(div().truncate().text_size(11).text_color(t.dim).child(tilde(w.path)))
        .when(Boolean(result), (el) => el.child(result))
        .when(!result && item.dirty > 0, (el) => el.child(warn(`${item.dirty} uncommitted change${item.dirty > 1 ? "s" : ""}: lost`, t.ansi1)))
        .when(!result && item.dirty < 0, (el) => el.child(warn("Couldn't read its changes", t.ansi3)))
        .when(!result && item.moduleCommits, (el) => el.child(warn("Submodule commits on no remote: lost", t.ansi1)))
        .when(!result && item.unpushed > 0, (el) => el.child(warn(`${item.unpushed} commit${item.unpushed > 1 ? "s" : ""} on no remote${item.merged || item.gone ? "" : ": the branch stays"}`, t.ansi3)))
        .when(!result && open > 0, (el) => el.child(warn(`Open in ${open} pane${open > 1 ? "s" : ""}: closed first`, t.ansi3)))
        .when(!result && !item.merged && !item.gone && Boolean(w.branch), (el) => el.child(warn("Branch kept: not merged", t.dim))));
  }

  renderCleanup(t) {
    const p = props();
    const only = Boolean(p.only);
    const chosen = this.items.filter((i) => i.on).length;
    const status = { fetching: "Fetching origin…", checking: "Checking worktrees…" }[this.phase];
    const button = (id, label, enabled, action, primary) => div().id(id).h(30).px(14).flex().items_center().rounded(7).text_size(12.5)
      .bg(primary && enabled ? t.solid : t.raised).text_color(primary && enabled ? t.solid_foreground : enabled ? t.foreground : t.dim)
      .when(enabled, (el) => el.cursor_pointer().on_click(action)).child(label);
    return v_flex().id("git-cleanup").size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e) => { if (e.key === "escape" && this.phase !== "removing") closeOverlay(p.overlay); })
      .child(div().font_semibold().text_color(t.foreground).child(only ? "Remove worktree" : "Clean up worktrees"))
      .child(div().text_color(t.muted).child(only
        ? "Closes its tabs, deletes the folder and, if merged or gone, the branch (git branch -d)."
        : `Worktrees whose branch is merged into ${this.base ?? "the base branch"} or gone from origin. Removing closes their tabs, deletes the folder and the branch (git branch -d keeps one that isn't merged).`))
      .when(Boolean(status), (el) => el.child(div().text_color(t.dim).child(status)))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(this.phase === "ready" && this.items.length === 0 && !this.error, (el) => el.child(div().text_color(t.dim).child("Nothing to clean up.")))
      .child(v_flex().id("clean-list").flex_1().min_h(0).overflow_y_scrollbar().children(this.items.map((item, i) => this.cleanupItem(t, item, i))))
      .child(h_flex().gap(8).justify_end()
        .when(this.phase !== "done", (el) => el
          .child(button("clean-cancel", "Cancel", this.phase !== "removing", () => closeOverlay(p.overlay), false))
          .child(button("clean-go", this.phase === "removing" ? "Removing…" : `Remove ${chosen || ""}`.trim(), this.phase === "ready" && chosen > 0, (_e, cx) => this.runCleanup(cx), true)))
        .when(this.phase === "done", (el) => el.child(button("clean-close", "Close", true, () => closeOverlay(p.overlay), true))));
  }

  // ---------------------------------------------------------------------------

  stateIcon(t, state, size = 12) {
    if (state === "ok") return div().flex_none().w(size).text_size(size).text_color(t.ansi2).child("✓");
    if (state === "fail") return div().flex_none().w(size).text_size(size).text_color(t.ansi1).child("✗");
    if (state === "pending") return svg("mods/workspace-chrome/spinner.svg").size(size - 1).flex_none().text_color(t.ansi3).spin(900);
    if (state === "skip") return div().flex_none().w(size).text_size(size).text_color(t.dim).child("–");
    return div().flex_none().w(size);
  }

  badge(t, text, color) {
    return div().flex_none().px(5).h(16).flex().items_center().rounded(4).bg(color + "26").text_size(10.5).text_color(color).child(text);
  }

  // "#123 ✓" after a worktree or branch that has a pull request.
  prBadge(t, pr, id) {
    return h_flex().id(id).flex_none().gap(4).items_center().px(4).rounded(4).hover((s) => s.bg(t.hover))
      .tooltip(pr.title)
      .on_click((_e, cx) => { cx.stop_propagation(); openUrl(pr.url); })
      .child(this.stateIcon(t, rollup(pr.statusCheckRollup), 11))
      .child(div().text_color(t.muted).child(`#${pr.number}`));
  }

  section(t, title, count, extra) {
    return h_flex().px(12).pt(12).pb(4).gap(6).items_center().text_size(11).font_medium().text_color(t.dim)
      .child(div().child(title))
      .when(count != null, (el) => el.child(div().child(String(count))))
      .child(div().flex_1())
      .when(Boolean(extra), (el) => el.child(extra));
  }

  note(t, text, color) {
    return div().px(12).py(4).text_size(11.5).text_color(color ?? t.dim).child(text);
  }

  more(t, which, hiddenCount) {
    return div().id(`more-${which}`).px(12).py(4).text_size(11.5).text_color(t.dim).cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { this.expanded[which] = !this.expanded[which]; cx.notify(); })
      .child(this.expanded[which] ? "Show fewer" : `Show ${hiddenCount} more`);
  }

  currentPr(t, pr) {
    const checks = pr.statusCheckRollup ?? [];
    const review = REVIEW[pr.reviewDecision];
    return v_flex().mx(8).mb(2).p(8).gap(6).rounded(8).bg(t.raised)
      .child(h_flex().id("pr-current").gap(6).items_center().cursor_pointer()
        .on_click(() => openUrl(pr.url))
        .child(div().flex_none().text_color(t.muted).child(`#${pr.number}`))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(pr.title)))
      .child(h_flex().gap(6).items_center()
        .when(pr.isDraft, (el) => el.child(this.badge(t, "Draft", t.dim)))
        .when(Boolean(review), (el) => el.child(this.badge(t, review[0], t[review[1]])))
        .when(checks.length === 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("No checks"))))
      .children(checks.map((c, i) => h_flex().id(`check-${i}`).gap(7).items_center().h(20).px(2).rounded(4)
        .when(Boolean(checkUrl(c)), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(checkUrl(c))))
        .child(this.stateIcon(t, checkState(c), 12))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(checkName(c)))));
  }

  prRow(t, pr, local) {
    const review = REVIEW[pr.reviewDecision];
    return h_flex().id(`pr-${pr.number}`).h(26).px(12).gap(7).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => openUrl(pr.url))
      .tooltip(pr.headRefName)
      .child(this.stateIcon(t, rollup(pr.statusCheckRollup), 12))
      .child(div().flex_none().text_color(t.dim).child(`#${pr.number}`))
      .child(div().flex_1().min_w(0).truncate().text_color(pr.isDraft ? t.muted : t.foreground).child(pr.title))
      .when(pr.isDraft, (el) => el.child(this.badge(t, "Draft", t.dim)))
      .when(!pr.isDraft && pr.reviewDecision === "APPROVED", (el) => el.child(this.badge(t, review[0], t[review[1]])))
      .when(!pr.isDraft && pr.reviewDecision === "CHANGES_REQUESTED", (el) => el.child(this.badge(t, "Changes", t[review[1]])))
      .when(local, (el) => el.child(this.badge(t, "local", t.dim)));
  }

  worktreeRow(t, w, current, pr, i) {
    const hovered = this.hovered === `wt-${i}`;
    return h_flex().id(`wt-${i}`).h(28).px(12).gap(7).items_center().cursor_pointer()
      .when(current, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => { this.hovered = on ? `wt-${i}` : this.hovered === `wt-${i}` ? null : this.hovered; cx.notify(); })
      .on_click(() => this.goTo(w))
      .tooltip(current ? "You are here" : "Go to its tab, or open one here")
      .child(svg("mods/workspace-chrome/branch.svg").size(12).flex_none().text_color(current ? t.accent : t.dim))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(t.foreground).child(w.branch ?? "detached"))
        .child(div().truncate().text_size(10.5).text_color(t.dim).child(tilde(w.path))))
      .when(w.main, (el) => el.child(this.badge(t, "main", t.dim)))
      .when(Boolean(pr), (el) => el.child(this.prBadge(t, pr, `wt-pr-${i}`)))
      // The main checkout can't be removed.
      .when(hovered && !w.main, (el) => el.child(div().id(`wt-rm-${i}`).flex_none().px(5).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.ansi1))
        .tooltip("Remove this worktree…")
        .on_click((_e, cx) => { cx.stop_propagation(); this.removeOne(w); })
        .child("×")));
  }

  branchRow(t, b, pr, current, i) {
    const hovered = this.hovered === `br-${i}`;
    return h_flex().id(`br-${i}`).h(24).px(12).gap(7).items_center()
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => { this.hovered = on ? `br-${i}` : this.hovered === `br-${i}` ? null : this.hovered; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(b.gone ? t.dim : current ? t.accent : t.foreground).child(b.name))
      .when(b.gone, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child("gone")))
      .when(b.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${b.ahead}`)))
      .when(b.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${b.behind}`)))
      .when(Boolean(pr), (el) => el.child(this.prBadge(t, pr, `br-pr-${i}`)))
      .when(hovered && !b.worktree, (el) => el.child(div().id(`br-wt-${i}`).flex_none().px(5).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Check it out in a new worktree, as a tab here")
        .on_click((_e, cx) => { cx.stop_propagation(); this.worktreeFor(b.name, cx); })
        .child("+ worktree")))
      .when(!hovered || b.worktree, (el) => el.child(div().flex_none().w(26).text_size(10.5).text_color(t.dim).text_right().child(b.at ? ago(b.at) : "")));
  }

  render() {
    const t = theme();
    if (props()?.dialog === "worktree") return this.renderDialog(t);
    if (props()?.dialog === "cleanup") return this.renderCleanup(t);
    const r = this.repo;
    const header = h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/workspace-chrome/branch.svg").size(14).flex_none().text_color(t.dim))
      .child(div().flex_none().max_w(150).truncate().font_medium().text_color(t.foreground).child(r ? r.name : "Git"))
      .when(Boolean(r?.branch), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(r.branch)))
      .when(!r?.branch, (el) => el.child(div().flex_1()))
      .child(div().id("git-refresh").flex_none().px(5).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Ask git and GitHub now")
        .on_click((_e, cx) => this.check(cx, true)).child("↻"))
      .child(div().id("git-close").flex_none().px(5).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close (ctrl-a g)")
        .on_click(() => run("layout.hide", { id: PANEL })).child("×"));

    // Framed like the Files and Changes panels.
    const root = v_flex().id("git-sidebar").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_size(12.5).child(header);
    if (r === undefined) return root.child(this.note(t, this.place ? "Reading git…" : "Focus a terminal in a git repository."));
    if (r === null) return root.child(this.note(t, "Not a git repository."));

    const gh = this.gh[this.ghKey()];
    const prs = gh?.prs ?? [];
    const byBranch = new Map(prs.map((p) => [p.headRefName, p]));
    const localNames = new Set(r.branches.map((b) => b.name));
    const current = r.branch ? byBranch.get(r.branch) : null;
    // Your other pull requests, those with a branch here first.
    const others = prs.filter((p) => p !== current)
      .map((p) => ({ p, local: localNames.has(p.headRefName) }))
      .sort((a, b) => Number(b.local) - Number(a.local) || b.p.number - a.p.number);
    const shownPrs = this.expanded.prs ? others : others.slice(0, SHORT.prs);
    const here = [...r.worktrees].sort((a, b) => slash(b.path).length - slash(a.path).length).find((w) => inside(this.place.dir, w.path));
    const loose = r.branches.filter((b) => !b.worktree);
    const shownBranches = this.expanded.branches ? loose : loose.slice(0, SHORT.branches);

    const body = v_flex().id("git-body").flex_1().min_h(0).pb(12).overflow_y_scrollbar()
      // The branch you're on.
      .child(this.section(t, "Pull request"))
      .when(!gh, (el) => el.child(this.note(t, "Asking GitHub…")))
      .when(Boolean(gh?.error), (el) => el.child(this.note(t, gh.error, t.ansi3)))
      .when(Boolean(current), (el) => el.child(this.currentPr(t, current)))
      .when(Boolean(gh) && !gh.error && !current, (el) => el.child(this.note(t, r.branch ? `None of yours open for ${r.branch}.` : "Detached HEAD.")))
      // Your others in this repo.
      .when(others.length > 0, (el) => el
        .child(this.section(t, "My pull requests", prs.length >= PR_LIMIT ? `${others.length}+` : others.length))
        .children(shownPrs.map(({ p, local }) => this.prRow(t, p, local)))
        .when(others.length > SHORT.prs, (el) => el.child(this.more(t, "prs", others.length - SHORT.prs))))
      .child(this.section(t, "Worktrees", r.worktrees.length, h_flex().gap(2).items_center()
        .when(r.worktrees.length > 1, (el) => el.child(div().id("wt-clean").px(5).rounded(4).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Remove worktrees whose branch is merged or gone…").on_click(() => this.cleanUp()).child("Clean up")))
        .child(div().id("wt-new").px(5).rounded(4).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("New worktree, as a tab here").on_click(() => this.newWorktree()).child("+"))))
      .when(Boolean(this.adding), (el) => el.child(this.note(t, `Checking out ${this.adding}…`)))
      .when(Boolean(this.addError), (el) => el.child(this.note(t, this.addError, t.ansi1)))
      .children(r.worktrees.map((w, i) => this.worktreeRow(t, w, w === here, w.branch ? byBranch.get(w.branch) : null, i)))
      .child(this.section(t, "Branches", loose.length))
      .when(loose.length === 0, (el) => el.child(this.note(t, "Every branch is in a worktree.")))
      .children(shownBranches.map((b, i) => this.branchRow(t, b, byBranch.get(b.name), b.name === r.branch, i)))
      .when(loose.length > SHORT.branches, (el) => el.child(this.more(t, "branches", loose.length - SHORT.branches)));
    return root.child(body);
  }
}
