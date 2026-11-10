// Worktrees and branches for the git-sidebar mod: reading them, adding a worktree as a
// tab, and what removing one would lose.

import { panes, spaces, terminals, run, home, exec } from "herdr";

export const slash = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
export const same = (a, b) => slash(a).toLowerCase() === slash(b).toLowerCase();
export const inside = (path, dir) => same(path, dir) || slash(path).toLowerCase().startsWith(slash(dir).toLowerCase() + "/");
export const tilde = (p) => {
  const h = slash(home());
  return inside(p, h) ? "~" + slash(p).slice(h.length) : slash(p);
};

// Waits in a task: mods have no setTimeout.
export const sleep = (cx, ms) => new Promise((done) => cx.timer.after(ms, () => done()));

// git's own complaint: it prints progress ("Preparing worktree ...") on stderr first.
export function gitError(stderr) {
  const lines = (stderr ?? "").trim().split(/\r?\n/).filter(Boolean);
  const fatal = lines.find((l) => /^(fatal|error): /.test(l));
  return fatal ? fatal.replace(/^(fatal|error): /, "") : lines.at(-1) ?? "";
}

export const repoName = (common) => (common.endsWith("/.git") ? common.slice(0, -5).split("/").pop() : common.split("/").pop().replace(/\.git$/, ""));
const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

// The folder an agent reported (it can be in a worktree its terminal never cd'd to).
export function agentDir(terminal) {
  const t = terminal && terminals().find((x) => x.address === terminal);
  let s;
  try { s = JSON.parse(t?.labels?.["agent.status"] ?? "null"); } catch { return null; }
  const a = s?.agent;
  const runs = Boolean(a) && [t.program?.key, t.report?.app].some((n) => n === a || (typeof n === "string" && n.startsWith(a + "-")));
  return runs ? s.cwd ?? null : null;
}

// `git worktree list --porcelain`: { path, branch, main }, the main checkout first.
export function parseWorktrees(out) {
  const list = [];
  for (const block of (out ?? "").split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/);
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    list.push({ path, branch, main: list.length === 0 });
  }
  return list;
}

export const BRANCH_FORMAT = "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)%09%(worktreepath)%09%(contents:subject)";

// `git for-each-ref refs/heads` with BRANCH_FORMAT. `subject`: its last commit's.
export function parseBranches(out) {
  return (out ?? "").split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, upstream, track, at, worktree, ...subject] = line.split("\t");
    return {
      name,
      upstream: upstream || null,
      gone: track?.includes("gone") ?? false,
      ahead: Number(/ahead (\d+)/.exec(track ?? "")?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track ?? "")?.[1] ?? 0),
      at: Number(at) || 0,
      worktree: worktree || null,
      subject: subject.join("\t").trim(),
    };
  });
}

// ---------------------------------------------------------------------------
// Adding

// The user's home on a machine (this one: null), with forward slashes.
export async function homeOf(machine) {
  if (!machine) return slash(home());
  let r;
  try { r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine }); } catch {}
  if (!r || r.code !== 0 || !r.stdout.trim()) r = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: machine });
  if (r.code !== 0 || !r.stdout.trim()) throw new Error("Could not find the remote home folder.");
  return slash(r.stdout.trim());
}

// Where new worktrees go: where the shipped worktree mod puts them.
export const worktreeRoot = (userHome, name) => `${userHome}/.herdr/worktrees/${name}`;

// Checks `branch` out in a new worktree of dir's repo and opens it as a tab in `space`:
// a local branch as it is, one only on origin tracking it, a new name from dir's HEAD.
// Returns "" or what went wrong.
export async function addWorktree({ dir, machine, space, branch }) {
  branch = (branch ?? "").trim();
  if (!branch) return "Type a branch name.";
  const git = (args, timeout = 30000) => exec("git", args, { cwd: dir, on: machine, timeout });
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) return "Not a git repository.";
  const path = `${worktreeRoot(await homeOf(machine), repoName(slash(common.stdout.trim())))}/${slug(branch)}`;
  const has = async (ref) => (await git(["show-ref", "--verify", "--quiet", ref])).code === 0;
  const add = (await has(`refs/heads/${branch}`)) ? ["worktree", "add", path, branch]
    : (await has(`refs/remotes/origin/${branch}`)) ? ["worktree", "add", "--track", "-b", branch, path, `origin/${branch}`]
    : ["worktree", "add", "-b", branch, path, "HEAD"];
  const r = await git(add, 600000);
  if (r.code !== 0) return gitError(r.stderr) || "git worktree add failed.";
  run("tab.new", { space, folder: path, name: branch });
  return "";
}

// ---------------------------------------------------------------------------
// Removing

// The branch work merges into: origin's default, else a main or master.
export async function baseBranch(git) {
  const head = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const b of ["origin/main", "origin/master", "main", "master"]) {
    if ((await git(["rev-parse", "--verify", "--quiet", b])).code === 0) return b;
  }
  return null;
}

// The panes herdr shows in worktree `w` of `all` (not in a deeper one), on `machine`.
export function panesIn(w, all, machine) {
  const deepest = [...all].sort((a, b) => slash(b.path).length - slash(a.path).length);
  const owner = (cwd) => deepest.find((x) => inside(cwd, x.path));
  const tabs = new Set(spaces().filter((s) => (s.machine ?? null) === (machine ?? null)).flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  return panes().filter((p) => tabs.has(p.tab) && p.terminal && same(owner(agentDir(p.terminal) ?? p.cwd ?? "")?.path, w.path));
}

// Closes them: a whole tab when all its terminals are in the worktree, else just those
// panes (a shell sitting in the folder keeps it busy on Windows). How many it closed.
export function closeIn(w, all, machine) {
  const inW = panesIn(w, all, machine);
  for (const tab of new Set(inW.map((p) => p.tab))) {
    const terminalsInTab = panes().filter((p) => p.tab === tab && p.terminal);
    if (terminalsInTab.every((p) => inW.includes(p))) run("tab.close", { id: tab, confirmed: true });
    else inW.filter((p) => p.tab === tab).forEach((p) => run("pane.close", { pane: p.pane }));
  }
  return inW.length;
}

// What removing worktree `w` would lose: uncommitted changes (-1: couldn't look),
// commits of its branch on no remote, submodule commits on no remote.
export async function inspect(w, { main, machine }) {
  const git = (args, cwd = w.path) => exec("git", args, { cwd, on: machine, timeout: 30000 });
  const status = await git(["--no-optional-locks", "status", "--porcelain"]);
  const dirty = status.code === 0 ? status.stdout.split(/\r?\n/).filter(Boolean).length : -1;
  const unpushed = w.branch ? Number((await git(["rev-list", "--count", w.branch, "--not", "--remotes"], main)).stdout.trim()) || 0 : 0;
  const modules = (await git(["config", "--file", ".gitmodules", "--get-regexp", "\\.path$"])).code === 0;
  let moduleCommits = false;
  if (modules) {
    const m = await git(["submodule", "foreach", "--quiet", "--recursive", "git rev-list -n1 --all --not --remotes"]);
    moduleCommits = m.code !== 0 || m.stdout.trim() !== "";
  }
  return { dirty, unpushed, modules, moduleCommits };
}

// Removes worktree `w` (closing what shows it first) and, when its branch is merged
// or gone, the branch too with `git branch -d`, which refuses one that isn't merged.
// `item`: inspect()'s answer plus { merged, gone }. Returns { removed, error, branch }.
export async function removeWorktree(cx, w, item, { main, machine, all }) {
  const git = (args) => exec("git", args, { cwd: main, on: machine, timeout: 120000 });
  if (closeIn(w, all, machine) > 0) await sleep(cx, 800);
  // Submodules make git refuse without --force; inspect() saw what that loses.
  const args = ["worktree", "remove", ...(item.dirty !== 0 || item.modules ? ["--force"] : []), w.path];
  let r = await git(args);
  // A terminal that just closed may still hold the folder for a moment.
  if (r.code !== 0 && /denied|busy|being used|not empty|invalid argument/i.test(r.stderr ?? "")) {
    await sleep(cx, 2000);
    r = await git(args);
  }
  const out = { removed: r.code === 0, error: r.code === 0 ? null : gitError(r.stderr) || "git worktree remove failed.", branch: null };
  if (out.removed && w.branch && (item.merged || item.gone)) {
    const d = await git(["branch", "-d", w.branch]);
    out.branch = d.code === 0 ? "deleted" : `kept (${gitError(d.stderr)})`;
  }
  return out;
}
