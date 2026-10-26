# Kernel and wiring

What sits outside the four layers: the shared kernel, each context's entry points, the binary, configuration,
workspace lints, and where tests go.

## Kernel (D-WS-03)

Technical vocabulary every context shares, and nothing with business meaning:

| item | role |
|---|---|
| `Id<E>` | phantom-typed identity; hand-written `Clone`/`Copy`/`Eq`/`Ord`/`Hash`/serde impls so `E` needs none |
| `IdGenerator` + `SnowflakeIdGenerator` | id source; `impl dyn IdGenerator { fn next<E>() -> Id<E> }` keeps the trait object-safe and the id typed |
| `Timestamp` | UTC instant; the only time type domain code sees |
| `Clock` + `SystemClock` | wall clock, injected as `Arc<dyn Clock>` into application code |
| `ErrorCode`, `ErrorKind` | stable error code + classification, implemented by domain and use-case errors |
| pagination types | `PageRequest { limit, offset }`, `Page<T>`, added with the first list query (not in the template) |
| `http` module (feature `http`) | `HttpError<E>`, `JsonBody<T>`: presentation only, denied in domain and application (A-04) |
| fakes (feature `test-utils`) | `FakeClock` (movable), `FakeIdGenerator` (1, 2, 3, …) for other crates' tests |

The kernel follows the domain allow-list (A-04 checks its manifest; optional dependencies behind features are
exempt). A concept two contexts share (a plan, a customer) is not kernel material: each context names its own
version and the ACL translates through `published`. The full source to copy is `kernel-template.md`; the id
representation (`i64` snowflake, or `Uuid` v7) is the one per-project choice in it.

In the small variant the kernel is `src/kernel.rs` + `src/kernel/`, its fakes are `#[cfg(test)]`, and a kernel item
no context uses yet trips `dead_code`; mark such shared vocabulary `#[allow(dead_code, reason = "…")]` rather than
deleting it.

## Context entry points (D-WS-04)

Each context root exposes `wire` and `migrate` and the types they need (A-01). `wire` builds every adapter and use
case of the context and returns its handle:

```rust
pub struct BillingConfig {
    /// Length of every billing period, in days.
    pub period_days: u32,
}

pub struct BillingDeps {
    pub config: BillingConfig,
    pub pool: PgPool,
    /// Read replica for `*_readonly` reads; the primary pool is used when absent.
    pub replica: Option<PgPool>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdGenerator>,
    pub plans: Arc<dyn catalog::published::PlanQueries>,
}

pub struct Billing {
    pub router: Router,
}

pub fn wire(deps: BillingDeps) -> Billing {
    let subscriptions: Arc<dyn SubscriptionRepository> =
        Arc::new(PgSubscriptionRepository::new(deps.pool.clone(), deps.replica));
    let renewals: Arc<dyn RenewalRecorder> = Arc::new(PgRenewalRecorder::new(deps.pool));
    let plans: Arc<dyn PlanSource> = Arc::new(CatalogPlanSourceAcl::new(deps.plans));

    let handlers = SubscriptionClientHandlers {
        start: Arc::new(StartSubscriptionUseCase::new(
            subscriptions.clone(),
            plans,
            deps.ids.clone(),
            deps.clock.clone(),
            deps.config.period_days,
        )),
        renew: Arc::new(RenewSubscriptionUseCase::new(subscriptions.clone(), renewals, deps.ids, deps.clock)),
        query: Arc::new(SubscriptionClientQueryUseCase::new(subscriptions)),
    };
    Billing { router: presentation::web::subscription_client_routes(handlers) }
}
```

- `*Deps` takes shared resources (pools, `Clock`, `IdGenerator`), the context's `*Config`, and the `published`
  traits of the contexts it calls.
- The handle carries the context's `Router` and, when other contexts call in, its `published` implementations
  (`Catalog { router, plans: Arc<dyn PlanQueries> }`).
- `wire` runs inside the Tokio runtime, so it also starts the context's background loops (event consumers, scheduled
  triggers) with `tokio::spawn`.
- A context crate depends on another only to name its `published` types, declared like every internal crate:
  `catalog = { path = "crates/catalog" }` in the root `[workspace.dependencies]`, `catalog.workspace = true` in the
  dependent crate. Cargo rejects dependency cycles, so the
  context map is acyclic by construction; two contexts that need each other need an event or a third context.

## The binary (D-WS-04)

A crate named after the service holding `main.rs` (a few lines), `bootstrap.rs` (configuration, migrations, wiring,
serving), and a `lib.rs` re-exporting the bootstrap so `tests/` can build the app:

```rust
/// Runs every context's migrations. Order follows the context dependency order.
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    catalog::migrate(pool).await?;
    billing::migrate(pool).await
}

/// Wires every context. Catalog first: billing's ACL needs catalog's published interface.
pub fn app(
    pool: PgPool,
    replica: Option<PgPool>,
    clock: Arc<dyn Clock>,
    ids: Arc<dyn IdGenerator>,
    billing_period_days: u32,
) -> Router {
    let catalog = catalog::wire(catalog::CatalogDeps { pool: pool.clone() });
    let billing = billing::wire(billing::BillingDeps {
        config: billing::BillingConfig { period_days: billing_period_days },
        pool,
        replica,
        clock,
        ids,
        plans: catalog.plans,
    });
    Router::new().merge(catalog.router).merge(billing.router)
}
```

`anyhow` lives here and nowhere else.

## Configuration (D-WS-07)

The binary reads the environment once (`dotenvy` for `.env` in development, then `envy::from_env::<AppConfig>()`)
and cuts each context's `*Config` from it. No context code reads environment variables (A-05); domain settings reach
the domain as value objects through parameters or a factory.

## Workspace settings

```toml
[workspace]
resolver = "3"
members = ["crates/*"]

[workspace.package]
edition = "2024"

[workspace.lints.rust]
unsafe_code = "forbid"
unreachable_pub = "warn"   # a stray `pub` inside a context becomes a warning: use pub(crate)
```

Every crate sets `[lints] workspace = true`. CI and the pre-push hook run `cargo fmt --check`,
`cargo clippy --workspace --all-targets --all-features -- -D warnings`, then `cargo test --workspace` (the
architecture test included).

## Tests

| level | where | doubles |
|---|---|---|
| domain unit | `#[cfg(test)] mod tests` in the concept file; table-driven, synchronous | none: time and ids are parameters |
| use case | `#[cfg(test)] mod tests` in the use-case file, `#[tokio::test]` | `Fake<Trait>` from the trait's `fakes` module, `kernel::{FakeClock, FakeIdGenerator}` |
| adapter integration | in the adapter's file, `#[cfg(test)]` + `#[sqlx::test]` against a real database (a crate's `tests/` cannot see `pub(crate)` adapters) | none |
| end to end | the binary's `tests/`, `#[sqlx::test(migrations = false)]` + `pay::migrate`, requests through `tower::ServiceExt::oneshot` | `FakeClock`, `FakeIdGenerator` |
| architecture | `arch-tests` crate (standard) / `tests/architecture/` (small) | — |

Context fakes are `#[cfg(test)]`: only the context's own tests can see them. Only the kernel needs a `test-utils`
feature, because other crates' tests use its fakes.
