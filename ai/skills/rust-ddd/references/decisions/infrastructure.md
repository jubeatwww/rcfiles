# Decisions — infrastructure layer

Format: see `workspace.md`.

## D-INF-01 — sliced by tech concept

**Context.** Slicing by backend (`postgres/`, `clickhouse/`, `in_memory/`) groups a repository with unrelated
adapters on the same technology; a catch-all `config/` or `context/` accumulates whatever has no obvious home.

**Decision.** First-level modules come from a fixed set (A-06): `repository/`, `cache/`, `lock/`, `mq/`, `event/`,
`scheduling/`, `acl/<target>/`, `storage/`. The technology is in the adapter's name (`PgSubscriptionRepository`), not
its module. No `config/` (D-WS-07), no `persistence/` (D-INF-02), no `context/`, no `adapters/`.

**Rejected.** Backend slicing; a free-form module per adapter.

**Deviate when.** A tech concept fits no module: add it to the set by a new decision entry and to `checker.rs`'s
`INFRASTRUCTURE_MODULES`.

## D-INF-02 — rows live beside their repository

**Context.** The JVM standard used `*Po` classes, `*PoMapper`s and `*Dao` interfaces under a `persistence/` tree.
With sqlx there is no DAO layer, and a row type is used by exactly one adapter.

**Decision.** Each repository file keeps private `*Row` structs (`#[derive(sqlx::FromRow)]`) and converts with
`TryFrom<Row> for Aggregate`, calling `from_persisted`. Writes bind from aggregate getters. Domain and application
types never derive `FromRow` or a ClickHouse row trait.

**Rejected.** `FromRow` on aggregates (the table would shape the model); a `persistence/{row,mapper}/` tree.

## D-INF-03 — each context owns its migrations

**Context.** Tables are a context's infrastructure, but contexts in one workspace usually share one database, and
sqlx records every applied version in one `_sqlx_migrations` table. Run naively, the second context's migrator sees
the first one's versions and fails with `VersionMissing`.

**Decision.** Each context crate owns `migrations/` with only its tables, prefixed with the context name. Versions are
timestamps. The context's `migrate` calls `set_ignore_missing(true)` before `run`; the binary runs contexts in
dependency order. No foreign key points into another context's table. The small variant keeps one `migrations/`; with a single
context the prefix is optional.

**Rejected.** One `migrations/` in the binary for all contexts (tables leave the context that owns them); a Postgres
schema per context (more machinery than a prefix for the same separation).

**Consequence.** Two contexts adding a migration in the same second would collide; timestamps make it unlikely and
the collision fails loudly (`VersionMismatch`).
