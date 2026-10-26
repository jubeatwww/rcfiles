# Decisions — workspace, kernel, wiring

Format per entry: Context / Decision / Rejected / Consequence, plus "Deviate when" where a sanctioned deviation
exists. Cited from `SKILL.md` and the reference files by id. "The JVM standard" is the Java/Kotlin standard this one
was ported from; it sliced `<root>.<ctx>.<layer>` packages and policed them with ArchUnit.

## D-WS-01 — one crate per bounded context, layers as modules

**Context.** A JVM package cannot choose what it exports, so the JVM standard needed a `published/` package plus an
ArchUnit rule to stop other contexts and legacy code from importing a context's internals. A Rust crate can: only
what its root marks `pub` exists for anyone else. An earlier Rust codebase took the opposite cut, one crate per
*layer* with contexts as modules inside, and needed `pub(in crate::<bc>)`, an `api.rs` re-export file and a
grep-based test to rebuild the context boundary the crate split had erased.

**Decision.** One crate per bounded context, named after it. The four layers are private modules of that crate. The
crate root exposes only `published`, `wire`, `migrate` and the wiring types (A-01). Layer direction inside the crate
is checked by the architecture test (A-02), which is as strong as the JVM standard's ArchUnit.

**Rejected.**
- One crate per layer, contexts as modules: the compiler guards layers, but the boundary that matters more, between
  contexts, falls back to visibility tricks and grep.
- One crate per context *and* layer (`billing-domain`, `billing-application`, …): both boundaries compile-checked,
  four crates per context, and a context's surface spread over several crates that other contexts could each depend on.
- Only the domain split out (`billing-domain` + `billing`): domain purity compile-checked, but any context could
  depend on `billing-domain` and skip `published`.

**Consequence.** Domain purity (no sqlx in domain) is a test, not a compile error, because the context crate depends
on sqlx for its infrastructure. A-04 covers it.

**Deviate when.** Domain purity is broken repeatedly despite A-04: split `<ctx>-domain` out and add a cargo-deny
`[[bans.deny]]` entry whose `wrappers` names only `<ctx>`, so nothing else can depend on it.

## D-WS-02 — the small variant

**Context.** A light version of DDD tends to rot: a single-context project that planned "lightweight boundaries"
ended with SQL in its HTTP handlers and plain-data entities. A lighter *rule set* is what failed; the layering itself
was cheap.

**Decision.** A project the developer judges small uses one crate. Contexts are modules (`src/<ctx>.rs` + `src/<ctx>/`)
whose root file keeps the four layer modules private and re-exports `published` and its wiring items as `pub(crate)`.
A single-context project puts the layers directly under `src/`. Every rule still applies; the repo's `CLAUDE.md`
names the variant.

**Rejected.**
- Only the domain rules for small projects: the version that rotted.
- A size threshold that switches variants automatically: size is not what makes boundaries worth a crate.
- `pub(in crate::<ctx>)` on every item: private layer modules already make `crate::<ctx>::domain::…` a compile error
  outside the context, so item-level restriction adds nothing.

**Consequence.** Cross-context isolation is compile-checked in both variants; A-03 adds the "only from
`infrastructure/acl/`" half. Moving to the standard variant is a mechanical move of each context into a crate.

## D-WS-03 — a kernel of technical vocabulary

**Context.** Every context needs typed ids, time, error codes and HTTP helpers. Copies drift; a shared crate becomes
a dumping ground once business concepts creep in.

**Decision.** One `kernel` crate (small variant: module) holding technical vocabulary only: `Id<E>`, `IdGenerator`,
`Timestamp`, `Clock`, `ErrorCode`/`ErrorKind`, pagination, and presentation helpers behind an `http` feature. It
follows the domain allow-list (A-04). Its fakes sit behind `test-utils` because other crates' tests use them.
The name is `kernel`, never `shared` or `common`.

**Rejected.**
- Per-context copies of ids, clock and error codes.
- A cross-project personal library: versioning it outweighs copying ~400 lines per project.
- Business concepts (`Money`, `Plan`) in the kernel: each context names its own and translates through `published`.

**Consequence.** `kernel::http` compiles into a context crate whenever its presentation enables the feature, so A-04
denies `kernel::http` in domain and application.

## D-WS-04 — wiring through `wire`, a thin binary

**Context.** With every adapter `pub(crate)`, a binary cannot construct a context's internals. Making adapters `pub`
to wire them centrally would reopen the surface D-WS-01 closed.

**Decision.** Each context exposes `wire(<Ctx>Deps) -> <Ctx>` and `migrate(&PgPool)`. `*Deps` carries shared
resources, the context's `*Config`, and other contexts' `published` traits; the handle carries the `Router` and the
context's own `published` implementations. The binary crate holds `main.rs`, `bootstrap.rs` and a `lib.rs` for
end-to-end tests, and wires contexts in dependency order.

**Rejected.** Public adapters wired by the binary; a DI container.

**Consequence.** Cargo forbids dependency cycles, so the context map is acyclic by construction.

## D-WS-05 — Rust 2018 module files, the concept file is the aggregate root

**Context.** A concept module holding a same-named file (`subscription/subscription.rs`) trips clippy's default
`module_inception` lint, fatal under `-D warnings`. `mod.rs` files leave editors with a row of identical tab names.

**Decision.** No `mod.rs` (A-07). `subscription.rs` holds the aggregate root, declares `subscription/` children and
re-exports their types. Layer roots only declare modules. Size thresholds (200 lines, 3 outputs, 8 events) trigger
splits, and an aggregate's behavior can move to child modules with their own `impl` blocks.

**Rejected.** `mod.rs` with the aggregate in it; `#[allow(clippy::module_inception)]`.

## D-WS-06 — a `syn` architecture test instead of ArchUnit

**Context.** Nothing in the Rust ecosystem plays ArchUnit's role. An earlier codebase grepped `use` lines, which misses
fully qualified paths (`sqlx::query(…)`) and relative ones (`super::super::infrastructure`).

**Decision.** One test parses every source file with `syn`, resolves `crate::`, `self::` and `super::` paths to
modules, reads each crate's manifest to know which first segments are external crates, and checks `A-01`…`A-14`.
The checker is copied unchanged; projects configure lists only. Workspace lints add `unreachable_pub` (a stray `pub`
inside a context warns) and `unsafe_code = "forbid"`; CI runs clippy with `-D warnings`.

**Rejected.** Grep; cargo-deny alone (crate granularity only); a compile-time proc macro (slower, more machinery).

**Consequence.** Macro bodies are checked best-effort; the template lists its limits.

## D-WS-07 — configuration enters through `wire`

**Context.** Contexts reading environment variables hide their inputs and make tests depend on the process
environment.

**Decision.** The binary reads the environment once (`dotenvy`, `envy`) into `AppConfig` and builds each context's
`*Config`. No context code reads environment variables (A-05). Domain settings reach the domain as value objects.

**Rejected.** A `config/` module per context; domain-level configuration structs bound from the environment.
