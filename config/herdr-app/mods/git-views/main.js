// The switch at the top of the Git panel: Overview (git-sidebar: your pull requests,
// worktrees and branches) or Graph (git-graph, rabeeh-ta/herdr-git-graph: the commit
// graph). It picks the child of the "git-body" stack under it (layouts/my-main.json).

import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme } from "herdr";

const STACK = "git-body";
const VIEWS = [
  { id: "git-overview", label: "Overview", icon: "mods/git-sidebar/icons/branch.svg" },
  { id: "git-graph", label: "Graph", icon: "mods/git-graph/icons/graph.svg" },
];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class GitViews extends View {
  render() {
    const t = theme();
    const active = find(layout(), STACK)?.active ?? VIEWS[0].id;
    return h_flex().id("git-views").size_full().items_center()
      .child(h_flex().w_full().p(2).gap(2).rounded(8).bg(t.chrome).border_1().border_color(t.border)
        .children(VIEWS.map((v) => {
          const on = v.id === active;
          return h_flex().id(`view-${v.id}`).flex_1().h(24).gap(6).items_center().justify_center().rounded(6)
            .text_size(12).cursor_pointer()
            .when(on, (el) => el.bg(t.raised).border_1().border_color(t.border).text_color(t.foreground).font_medium())
            .when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
            .on_click(() => run("layout.select", { stack: STACK, child: v.id }))
            .child(svg(v.icon).size(13).flex_none())
            .child(v.label);
        })));
  }
}
