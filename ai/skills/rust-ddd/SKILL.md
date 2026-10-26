---
name: rust-ddd
description: "Personal Rust DDD standard: context crates, kernel, published + ACL, naming, syn architecture test. Scaffold or review a Rust repo that opted in. 觸發: rust ddd、Rust DDD 分層、加 context / aggregate / use case / adapter、review DDD 合規。"
disable-model-invocation: true
---

# Rust DDD Implementation Standard

The standard for Rust DDD codebases: one ruling per question, not a survey of options. Anything in an opted-in repo
that differs from a rule here is a **deviation**, something to scan out and fix, not a style choice. Every rule carries
a **signal** (an architecture-test id `A-xx`, `compiler`, or `review` when it can only be judged by reading) and,
where the ruling was a real trade-off, a **decision id** (`D-DOM-01`, …) pointing into `references/decisions/`.

Assumed known: DDD tactical vocabulary (aggregate, entity, value object, repository, domain service, domain event,
bounded context), hexagonal architecture, and Rust (traits, visibility, `async_trait`, `thiserror`, sqlx, axum).

Example domain throughout: **subscription billing**, service `pay`, contexts `billing` (Subscription, Invoice) and
`catalog` (Plan). Every snippet comes from a sample workspace that compiles under `clippy -D warnings` and passes the
architecture test; map the names onto your own contexts.

Names carry the domain, not the technique: no `Port`, `Adapter`, `Impl`, `TransactionalWriter`, `UnitOfWork`.
A trait is named for what the domain needs (`SubscriptionRepository`, `PlanSource`, `RenewalRecorder`).

**Adoption.** User-invoked only. A repo opts in with one line in its `CLAUDE.md`, naming the variant:
"Before writing or reviewing code in a bounded context, invoke `/personal:rust-ddd` (variant: standard)." — or
`(variant: small)`. Without that line the repo is not governed by this standard. The variant decides which tree in
`layers-and-modules.md` applies; every other rule is shared.

## Variants

| variant | shape | pick when |
|---|---|---|
| standard | a workspace: one crate per bounded context, a `kernel` crate, one binary crate, an `arch-tests` crate | default |
| small | one crate: contexts are modules (or the four layers sit directly under `src/` for a single context) | the developer judges the project small (D-WS-02) |

Both keep the four layers. Neither is a lighter rule set: the small variant changes where the boundaries are drawn,
not which rules apply.

## Modes

Pick the mode from the request. Both modes read `references/layers-and-modules.md` and `references/naming.md` first.

### Scaffold — add a context, aggregate, use case, adapter, or handler

0. Read the per-layer deep dive (`references/<layer>.md`) for each layer being touched. A new workspace or context
   also reads `references/kernel-and-wiring.md`; a new workspace copies `references/kernel-template.md` and
   `references/arch-test-template.md`, an existing one only registers the context in the architecture test.
1. Locate the context (standard: `crates/<ctx>`; small: `src/<ctx>`). A new context gets all four layer modules and
   its `wire` / `migrate` entry points even when a layer starts empty, and is added to the architecture test's
   `contexts` (A-01 reports it until then).
2. Place each new file using the trees in `layers-and-modules.md`. A file with no place in those trees is a design
   smell: resolve the placement before writing it, never invent a module.
3. Name each type from `naming.md`. A suffix absent from that table is banned.
4. Run the architecture test and `cargo clippy --all-targets -- -D warnings`, then the review mode on the new files.
   Done when every rule passes or the remaining failures are listed with their rule id.

### Review — check a context or a diff for compliance

1. If the repo has the architecture test, run it (`cargo test -p arch-tests` / `cargo test --test architecture`).
   Otherwise apply each `A-xx` check by hand (file listing + targeted grep). Record failures as `R-xx: <file>:<line>`.
2. Read the per-layer deep dive for each layer under review. For `review`-signal rules, judge each touched layer
   against the rule text and its decision.
3. Report deviations grouped by rule id, each with file path and a one-line fix. Passing rules are not listed. Done
   when every rule id in the index has been applied: the report is exhaustive, not a sample. One file can break
   several rules (a `SubscriptionRepositoryImpl` under `domain/repository/` breaks R-07 and R-13); cite each rule
   separately. Rules the material cannot show (a listing without bodies, a partial diff) go in a short "not
   checkable here" list instead of being skipped silently.

## Layer map

```
<ctx>  (standard: crate `<ctx>`, src/lib.rs is the root; small: module `src/<ctx>.rs`)
├── domain          aggregates, value objects, domain services, the traits the domain needs; no IO crates
├── application     use cases with their Input/Error, Outputs, AppServices, query repositories, published
├── infrastructure  every trait implementation that touches the outside, sliced by tech concept
└── presentation    inbound HTTP / WebSocket handlers
```

Dependency rule: `presentation → application → domain ← infrastructure`; infrastructure and presentation never
reference each other. Another context is reached only through its `published` module, only from
`infrastructure/acl/<ctx>/`.

## Rule index

| id | rule | signal | decision |
|---|---|---|---|
| R-01 | Standard: one crate per context; its root exposes only `published`, `wire`, `migrate`, `<Ctx>Deps`, `<Ctx>Config`, `<Ctx>`; layer modules are private. Every context is listed in the architecture test | A-01 | D-WS-01 |
| R-02 | Small: one crate; each context root (`src/<ctx>.rs`) keeps its layer modules private and re-exports only `published` and its wiring items | compiler + A-03 | D-WS-02 |
| R-03 | Layer direction: domain references no other layer; application neither infrastructure nor presentation; infrastructure and presentation never each other | A-02 | — |
| R-04 | Another context is reached only through its `published` module, only from `infrastructure/acl/<ctx>/` (and from the root's `wire`) | A-03 | D-APP-05 |
| R-05 | Domain uses only allow-listed crates; application and presentation avoid their deny-lists (no `sqlx` in either); the kernel follows the domain list; `anyhow` only in the binary | A-04 | D-DOM-01, D-WS-03 |
| R-06 | Domain reads no clock and no randomness (it receives `at: Timestamp` and ids); no context code reads environment variables | A-05 | D-DOM-03, D-WS-07 |
| R-07 | Domain modules name concepts; application modules name scenarios then actors; infrastructure and presentation use their fixed module sets; a file is the snake_case of its main type | A-06 + review | D-APP-01, D-INF-01 |
| R-08 | No `mod.rs`; a concept file (`subscription.rs`) holds the aggregate root and declares `subscription/` children | A-07 + review | D-WS-05 |
| R-09 | Traits the domain needs sit beside their concept in `domain/`; context-wide ones at the `domain` root; `*QueryRepository` in its application scenario | review | D-DOM-04, D-APP-04 |
| R-10 | One use case per file, holding the use case, its `*Input` and its `*Error`; a multi-method use case only under the grouping rules | review | D-APP-02 |
| R-11 | An application type with a public `execute` or `handle` is named `*UseCase`, and never holds `handle` beside another public method; `handle` takes an `*Input` | A-08 + review | D-APP-02 |
| R-12 | Presentation calls `*UseCase` only (never a repository or AppService); `*AppService` is called only from use cases | A-09 + review | D-APP-03 |
| R-13 | Repository trait methods are `find_by_*`, `list_*`, `save`, `delete`, `exists` (+ intent-named atomic ones). Banned suffixes (`Impl`, `Adapter`, `Port`, `Mapper`, `Converter`, `Dto`, `Po`, `Dao`, `Entity`, `Vo`, `TransactionalWriter`, `DomainService`, `UnitOfWork`; `Manager`, `Helper`, `Util` in domain and application) | A-10 | — |
| R-14 | An infrastructure implementation of a context trait is `<Tech><Trait>`, or `<Target><Trait>Acl` under `acl/` | A-11 | — |
| R-15 | Aggregate fields are private; no `set_*`; state changes through named behavior methods returning `Result<Event, Error>` | A-12 + review | D-DOM-05 |
| R-16 | Ids are `kernel::Id<E>`; an aggregate's id is never `Option`; new ids come from `IdGenerator` in application | A-13 + review | D-DOM-02 |
| R-17 | Domain events are past-tense structs, `#[must_use]`, `Serialize` | A-14 + review | D-DOM-08 |
| R-18 | Format validation is parsing: `*Input` fields are value objects with smart constructors and `serde(try_from)`; business invariants live in aggregate behavior | review | D-DOM-06 |
| R-19 | No transaction type crosses a trait; multi-aggregate atomic writes go through one single-method, intent-named trait; no unit of work | A-04 + review | D-DOM-07 |
| R-20 | `DomainEventPublisher` exists only once an event has a consumer; the use case publishes after persisting | review | D-DOM-08 |
| R-21 | Replica reads are explicit `*_readonly` trait methods, query repositories included | review | D-DOM-09 |
| R-22 | No concurrency control by default; optimistic `version` first; a lock trait only for side-effect-spanning sections, acquired before the transaction | review | D-DOM-10 |
| R-23 | `thiserror` enums per layer; trait errors box the underlying failure in one variant (`Backend(Box<dyn Error + Send + Sync>)` for storage, `Unavailable(…)` for a remote source); domain and use-case errors implement `kernel::ErrorCode`; published errors expose no internal type | review | D-DOM-11 |
| R-24 | Pure conversions are `From` / `TryFrom`; `*OutputAssembler` only when output needs gathering from collaborators | A-10 + review | D-APP-06 |
| R-25 | Persistence rows are private `*Row` structs in the adapter file; domain and application types never derive `FromRow` | A-04 + review | D-INF-02 |
| R-26 | Migrations live in the owning context crate with timestamp versions and `set_ignore_missing(true)`; tables are context-prefixed; no foreign key across contexts | review | D-INF-03 |
| R-27 | One presentation module per (scenario, actor) with a state struct holding only that scenario's use cases; bodies bind `JsonBody<*Input>`; an `Err` only inside `TryFrom<*Request>` | review | D-PRE-01 |
| R-28 | Handlers return `Result<Json<*Output>, HttpError<E>>`; errors render as `{code, message}`; success is the bare Output | review | D-PRE-02 |
| R-29 | Each context exposes `wire(deps)` and `migrate(pool)`; the binary holds `main.rs` + `bootstrap.rs` (+ `lib.rs` for end-to-end tests) and builds every `<Ctx>Config` from `AppConfig` | A-01 + review | D-WS-04, D-WS-07 |
| R-30 | Size thresholds in `layers-and-modules.md` (200 lines, 3 outputs, 8 events) | review | D-WS-05 |

`A-xx` checks are in `references/arch-test-template.md`. Decision ids are in `references/decisions/<area>.md`.

## References

- `references/layers-and-modules.md` — both workspace shapes, the per-layer trees, module style, size thresholds.
- `references/naming.md` — type, file and method names; banned names; the domain-service naming procedure.
- `references/domain.md`, `application.md`, `infrastructure.md`, `presentation.md` — how each layer's types are
  written, with snippets.
- `references/kernel-and-wiring.md` — kernel contents, `wire` / `migrate`, the binary, configuration, workspace lints,
  test layout.
- `references/kernel-template.md` — the kernel crate source to copy.
- `references/arch-test-template.md` — `A-01`…`A-14` as a `syn`-based test, configuration for both variants
  (D-WS-06).
- `references/decisions/` — recorded trade-offs per area, cited by `D-*` ids.
- `evals/evals.json` — the tasks this skill is measured against.
