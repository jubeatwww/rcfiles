# Decisions — domain layer

Format: see `workspace.md`.

## D-DOM-01 — a dependency allow-list for domain

**Context.** Domain code legitimately uses framework-level and language-standard crates that remove ceremony
(serde derives, thiserror, async_trait). Banning them all is over-engineering; allowing any crate lets IO in.

**Decision.** Domain code uses `std`, the kernel, and an allow-list: `serde`, `thiserror`, `chrono`, `uuid`,
`async_trait`, `tracing`, `rust_decimal`. Everything else is a deviation (A-04), notably `tokio`, `sqlx`, `axum`,
`reqwest`, `clickhouse`, `anyhow`, another context's crate, and `kernel::http`. Application uses a deny-list instead,
because what it needs is more varied.

**Rejected.** Absolute purity (hand-written `Error` impls, no derives); free use of any crate.

**Deviate when.** A new crate is pure vocabulary with no IO (a decimal or currency crate): add it to the list in the
architecture test's configuration and here.

## D-DOM-02 — typed ids from construction

**Context.** The JVM standard kept raw `Long` ids assigned on `save`, because typed ids cost an allocation on the JVM
and Spring Data handled Kotlin value classes poorly. Neither holds in Rust: a newtype is free, and sqlx binds the raw
value.

**Decision.** Ids are `kernel::Id<E>`, phantom-typed by the aggregate (`type SubscriptionId = Id<Subscription>`).
An aggregate has its id from construction; its own `id` is never `Option` (A-13). Application code takes new ids from
`Arc<dyn IdGenerator>` and passes them in. An aggregate of another context is referenced as `Id<Marker>` with an
uninhabited marker enum. The representation (`i64` snowflake or `Uuid` v7) is chosen once per project in the kernel.

**Rejected.** Raw ids; ids assigned by the database on insert (forces `Option<Id>` or a second type); a newtype per
aggregate written by hand.

## D-DOM-03 — time and randomness are parameters

**Context.** Code that reads the clock or a random source needs mocks to test and cannot be replayed.

**Decision.** Domain code never calls a clock or random source (A-05). Behavior methods take `at: Timestamp`; ids
arrive as arguments. The use case reads `Arc<dyn Clock>` and `Arc<dyn IdGenerator>`.

**Rejected.** Calling `Utc::now()` in domain; injecting `Clock` into every domain service (two more collaborators for
the same benefit).

## D-DOM-04 — the traits the domain needs live in domain; `async_trait` + `Arc<dyn>`

**Context.** One Rust codebase declared every outbound trait in `application/<bc>/ports/`. A type-named folder is what
the JVM standard bans in domain, and a domain service could not use those traits without importing application.

**Decision.** A trait sits beside the concept that needs it, named for the need, not the mechanism; context-wide
traits sit at the `domain` root; read-model traits (`*QueryRepository`) in their application scenario. Traits are
`#[async_trait]` with `Send + Sync`, and collaborators are held as `Arc<dyn Trait>`, never as generic parameters.
Repository methods follow the vocabulary in `naming.md`.

**Rejected.**
- `ports/` in application.
- Native `async fn` in traits: such traits cannot be used as `dyn Trait` objects, and generic use cases would
  spread type parameters through every constructor and the wiring.

**Consequence.** Domain depends on `async_trait`, which the allow-list permits.

**Deviate when.** `dyn`-compatible async functions in traits are stable: drop `async_trait` and revisit this entry.

## D-DOM-05 — aggregate shape

**Context.** Rust offers several ways to protect invariants: private fields, consuming methods, typestate.

**Decision.** Private fields with getters, no setters (A-12). Behavior methods take `&mut self` and return
`Result<Event, Error>`. Lifecycles are enums whose variants carry per-state data. Creation is an associated function
named for the business moment returning the aggregate and its event; reconstitution is a `pub(crate)
from_persisted` used only by repositories. Cross-aggregate references are ids.

**Rejected.**
- `fn renew(self) -> Result<Self, _>`: a refused command consumes the aggregate the caller still needs.
- Typestate (`Subscription<Active>`): a loaded aggregate's state is known only at runtime, so it is wrapped back into
  an enum anyway. Allowed for in-memory builders.
- Public fields "because Rust has no Lombok": the invariant would live nowhere.

## D-DOM-06 — validation by parsing

**Context.** The JVM standard put format rules in jakarta annotations on `*Input`. Rust has no annotation
validation; a validator crate would re-check what types can guarantee.

**Decision.** Format rules live in value-object constructors. `*Input` fields are value objects that deserialize
through `serde(try_from = …)`, so a malformed request fails at the edge and use cases receive parsed input. Business
invariants live in aggregate behavior and domain services. Two homes, never a third.

**Rejected.** The `validator` crate on Inputs; checks in use-case bodies.

## D-DOM-07 — atomicity without a unit of work

**Context.** The JVM standard opened transactions in use cases and let domain services use a `UnitOfWork` port. In
Rust a sqlx transaction is a mutable borrow with a lifetime: sharing it across repository calls means either putting
the transaction type into every trait signature or a unit-of-work handle that hands out transaction-bound
repositories, both fighting `Arc<dyn>` and the borrow checker.

**Decision.** The aggregate is the transaction boundary: `save` is atomic inside its adapter. When two aggregates must
be written together, a single-method trait named for the business moment (`RenewalRecorder::record(&subscription,
&invoice)`) does it, and its adapter opens and commits the transaction internally. A repository may also expose an
intent-named atomic method (`mark_expired(id)`) whose SQL guard carries the invariant the aggregate would have
checked. No transaction, connection or pool type appears in any trait (A-04 denies sqlx in application).

**Rejected.** A `UnitOfWork` trait; `&mut Transaction` through repository traits; use-case-level transactions.

**Consequence.** A wrongly drawn aggregate boundary shows up as a growing family of recorders: redesign the
boundary instead of adding a generic abstraction.

## D-DOM-08 — events are returned, published only when someone listens

**Context.** Behavior methods that return their event make every state change visible at the call site. A publisher
with no consumer is ceremony.

**Decision.** Events are past-tense structs in the concept's `events.rs`, `#[must_use]` (A-14) and `Serialize`.
Behavior methods return them. Until an event has a consumer outside the use case, the use case drops it explicitly
(`_issued`). Once one exists, a `DomainEventPublisher` trait at the `domain` root takes a `<Ctx>Event` enum, every
event of the context goes through it, and the use case publishes after persisting. The adapter picks the transport.

**Rejected.** An event bus by default; a publisher method per event type; aggregates collecting pending events
(revisit when an outbox is needed).

**Consequence.** In-process delivery is at most once. A publish failure after persistence is logged and the use case
still succeeds: the change is committed, and returning an error would misreport it. A consumer that must never miss an
event needs an outbox, which needs its own decision entry.

## D-DOM-09 — explicit replica reads

**Decision.** A repository exposes `find_…` (primary) and `find_…_readonly` (replica) as separate methods, and so does
a `*QueryRepository` (`list_by_customer_readonly`); the call
site decides whether a stale read is acceptable, visibly. The adapter falls back to the primary pool when no replica
is configured.

**Rejected.** Routing by a task-local or an annotation: it hides a consistency decision.

## D-DOM-10 — concurrency control on demand

**Decision.** None by default. When concurrent writes are real: optimistic `version` checked in `save`, surfacing a
`Conflict`; the use case decides on retry. A `<Concept>LockRegistry` trait only when the critical section spans an
external side effect, acquired before any transaction opens (a transaction holds a pooled connection; waiting on a
lock inside it starves the pool).

## D-DOM-11 — errors

**Context.** The JVM standard used one company-wide error-code enum. A personal project has no such contract, and
Rust's `Result` makes every error a type anyway.

**Decision.** `thiserror` enums per layer: per concept in domain, per trait for adapters (one boxed variant: `Backend(Box<dyn
Error + Send + Sync>)` for storage, `Unavailable(…)` for a remote source; never a leaked `sqlx::Error`), per use case in application, wrapping the others with `#[from]`.
Domain and use-case errors implement `kernel::ErrorCode` with stable `"<concept>.<reason>"` codes and an
`ErrorKind`. `anyhow` only in the binary. Published errors carry no internal type.

**Rejected.** One error enum per context; one central HTTP error with a `From` per use-case error; `anyhow` in
application code.
