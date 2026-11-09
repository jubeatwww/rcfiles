// A bar under the tabs for the agent in the shown tab (Claude Code, Codex, ...):
// its session on the left (model, effort, context, cost: what the agent reports) and
// its plan limits on the right (5-hour, weekly, ...), each with a bar, the percent used
// and, from 70%, the time until it resets. A tab without agents shows every agent's
// limits.
//
// Which session: the focused terminal's agent, else the tab's first agent pane.
//
// Data: rcfiles/tools/agent-status publishes each session's status as the terminal
// label `agent.status` (JSON with `agent`: claude, codex), read here live from
// terminals(). No polling, no files.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, panes, focused, theme } from "herdr";

const LABEL = "agent.status";
const NAMES = { claude: "Claude", codex: "Codex", pi: "pi" };
const KNOWN = Object.keys(NAMES);
// Limits in this order, others after them.
const ORDER = ["5h", "7d"];

// The program running now is that agent: herdr's program key or the agent's own report
// ("claude", "claude-code", "codex"; not "pip" for pi).
const runs = (t, agent) => [t.program?.key, t.report?.app].some((n) => n === agent || (typeof n === "string" && n.startsWith(agent + "-")));
const agentOf = (t) => KNOWN.find((a) => runs(t, a)) ?? null;

function status(t) {
  if (!t || t.state !== "live") return null;
  let s;
  try { s = JSON.parse(t.labels?.[LABEL] ?? "null"); } catch { return null; }
  return s?.agent && runs(t, s.agent) ? s : null;
}

// Sessions of one agent report the same account, each as of its own last update: an
// idle one's numbers are old. Per limit, the newest is the latest window (reset), and
// within a window use only grows.
function newestLimits(all) {
  const out = {};
  for (const limits of all) {
    for (const [key, l] of Object.entries(limits)) {
      const cur = out[key];
      if (!cur || (l.reset ?? 0) > (cur.reset ?? 0) || ((l.reset ?? 0) === (cur.reset ?? 0) && l.pct > cur.pct)) out[key] = l;
    }
  }
  return out;
}

function tokens(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}

function until(epoch) {
  const m = Math.max(0, Math.round((epoch * 1000 - Date.now()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Green, then amber from 70%, red from 90%.
const tone = (t, pct) => (pct >= 90 ? t.ansi1 : pct >= 70 ? t.ansi3 : t.ansi2);

export default class AgentUsage extends View {
  init(_props, cx) {
    // Only the reset countdowns change with time.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  bar(t, pct, width) {
    const p = Math.min(100, Math.max(0, pct));
    return div().w(width).h(5).flex_none().rounded(3).bg(t.border)
      .child(div().h(5).w((width * p) / 100).rounded(3).bg(tone(t, p)));
  }

  sep(t) {
    return div().w(1).h(14).flex_none().bg(t.border);
  }

  // The agent's name, then model and effort, context, cost: each after a divider.
  session(t, s) {
    const parts = [div().flex_none().font_medium().text_color(t.muted).child(NAMES[s.agent] ?? s.agent)];
    if (s.model || s.effort) {
      parts.push(h_flex().gap(6).items_center().flex_none()
        .when(Boolean(s.model), (el) => el.child(div().text_color(t.foreground).child(s.model)))
        .when(Boolean(s.effort), (el) => el.child(div().text_color(t.dim).child(s.effort))));
    }
    if (s.ctx) {
      const size = s.ctx.used != null && s.ctx.size ? `${tokens(s.ctx.used)}/${tokens(s.ctx.size)}` : null;
      parts.push(h_flex().gap(6).items_center().flex_none()
        .child(div().text_color(t.dim).child("ctx"))
        .child(this.bar(t, s.ctx.pct, 64))
        .child(div().text_color(t.foreground).child(`${Math.round(s.ctx.pct)}%`))
        .when(Boolean(size), (el) => el.child(div().text_color(t.dim).child(size))));
    }
    if (s.cost != null) parts.push(div().flex_none().text_color(t.foreground).child(`$${s.cost.toFixed(2)}`));
    return parts.flatMap((part, i) => (i > 1 ? [this.sep(t), part] : [part]));
  }

  limit(t, agent, key, l) {
    const reset = l.reset ? until(l.reset) : null;
    return h_flex().id(`limit-${agent}-${key}`).gap(6).items_center().flex_none()
      .when(Boolean(reset), (el) => el.tooltip(`${NAMES[agent] ?? agent} ${key}: ${Math.round(l.pct)}% used, resets in ${reset}`))
      .child(div().text_color(t.dim).child(key))
      .child(this.bar(t, l.pct, 64))
      .child(div().text_color(t.foreground).child(`${Math.round(l.pct)}%`))
      .when(l.pct >= 70 && Boolean(reset), (el) => el.child(div().text_color(t.dim).child(reset)));
  }

  // One agent's limits; named when the bar has no session saying whose they are.
  limits(t, agent, limits, named) {
    const keys = Object.keys(limits ?? {}).sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib) || a.localeCompare(b);
    });
    return h_flex().gap(14).items_center().flex_none()
      .when(named, (el) => el.child(div().flex_none().font_medium().text_color(t.muted).child(NAMES[agent] ?? agent)))
      .when(keys.length === 0, (el) => el.child(div().text_color(t.dim).child("no usage reported yet")))
      .children(keys.map((key) => this.limit(t, agent, key, limits[key])));
  }

  render() {
    const t = theme();
    const all = terminals();
    const byAddress = new Map(all.map((x) => [x.address, x]));

    const limits = {};
    for (const agent of KNOWN) {
      const reported = all.map(status).filter((s) => s?.agent === agent && s.limits).map((s) => s.limits);
      if (reported.length) limits[agent] = newestLimits(reported);
    }

    // The shown tab's agent terminals, the focused one first.
    const f = focused();
    const inTab = (f?.tab ? panes().filter((p) => p.tab === f.tab && p.terminal) : [])
      .map((p) => byAddress.get(p.terminal))
      .filter((x) => x && agentOf(x))
      .sort((a, b) => Number(b.address === f?.terminal) - Number(a.address === f?.terminal));
    const session = inTab.map(status).find(Boolean) ?? null;
    const agents = inTab.length ? [...new Set(inTab.map(agentOf))] : KNOWN.filter((a) => limits[a]);
    // The session's own agent goes unnamed: the session already says it.
    const named = (agent) => !session || agent !== session.agent;

    return h_flex()
      .id("agent-usage")
      .size_full()
      .px(14)
      .gap(12)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .when(Boolean(session), (el) => el.children(this.session(t, session)))
      .when(inTab.length > 0 && !session, (el) => el.child(div().text_color(t.dim).child(`${NAMES[agentOf(inTab[0])]}: no session reported yet`)))
      .child(div().flex_1())
      .when(agents.length === 0, (el) => el.child(div().text_color(t.dim).child("No agent usage reported yet")))
      .children(agents.flatMap((agent, i) => [
        ...(i ? [this.sep(t)] : []),
        this.limits(t, agent, limits[agent], named(agent)),
      ]));
  }
}
