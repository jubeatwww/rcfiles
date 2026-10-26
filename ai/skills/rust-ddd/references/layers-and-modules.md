# Layers and modules

The placement map: which crate, module and file every kind of type goes in. How each type is *written* lives in the
per-layer deep dives (`domain.md`, `application.md`, `infrastructure.md`, `presentation.md`); the kernel, wiring and
binary in `kernel-and-wiring.md`.

## Workspace shapes

### Standard variant (D-WS-01)

```
pay/                                  the service
├── Cargo.toml                        [workspace], [workspace.dependencies], [workspace.lints]
└── crates/
    ├── kernel/                       technical vocabulary shared by every context (kernel-and-wiring.md)
    ├── catalog/                      one crate per bounded context, named after the context
    │   ├── Cargo.toml
    │   ├── migrations/               this context's tables only (D-INF-03)
    │   └── src/
    │       ├── lib.rs                the context root: private layer modules + the public surface
    │       ├── domain.rs  domain/
    │       ├── application.rs  application/
    │       ├── infrastructure.rs  infrastructure/
    │       └── presentation.rs  presentation/
    ├── billing/                      depends on `catalog` for `catalog::published` only
    ├── pay/                          the binary: main.rs, bootstrap.rs, lib.rs (for end-to-end tests), tests/
    └── arch-tests/                   src/lib.rs (empty) + tests/architecture/{main.rs, checker.rs}
```

The context crate root is the only file with `pub` items, and only these (A-01):

```rust
mod application;
mod domain;
mod infrastructure;
mod presentation;

pub use application::published;      // the only door for other contexts (omit when nobody calls in)

pub struct BillingConfig { /* … */ } // values cut from the binary's AppConfig
pub struct BillingDeps { /* … */ }   // pools, Clock, IdGenerator, other contexts' published traits, config
pub struct Billing { pub router: Router }

pub fn wire(deps: BillingDeps) -> Billing { /* … */ }
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> { /* … */ }
```

When the context shares its name with an aggregate (context `reward`, aggregate `Reward`), the handle is still
`Reward`; `lib.rs` names the aggregate by path (`domain::reward::Reward`) instead of importing it.

Everything below the root is `pub(crate)`; the workspace lint `unreachable_pub` turns a stray `pub` into a warning.
The exception is what `published` re-exports: those items are `pub` because another crate names them.

### Small variant (D-WS-02)

```
pay/
├── Cargo.toml
├── migrations/                       one sequence for the whole crate
├── src/
│   ├── main.rs                       calls `pay::run()`
│   ├── lib.rs                        mod billing; mod bootstrap; mod catalog; mod kernel; pub use bootstrap::run;
│   ├── bootstrap.rs                  AppConfig, migrate, app wiring
│   ├── kernel.rs  kernel/
│   ├── catalog.rs  catalog/          context root + its four layer modules
│   └── billing.rs  billing/
└── tests/architecture/{main.rs, checker.rs}
```

A single-context project drops the context level: `src/{domain,application,infrastructure,presentation}.rs` sit
beside `kernel.rs` and `bootstrap.rs`. `lib.rs` is then the context root (layer modules private, no `published`), and
`bootstrap.rs` does what `wire` does, building adapters and use cases directly; no `*Deps` / `*Config` types.

The context root file (`src/billing.rs`) mirrors the standard crate root, one visibility step down:

```rust
mod application;
mod domain;
mod infrastructure;
mod presentation;

pub(crate) use application::published;

pub(crate) struct BillingDeps { /* … */ }
pub(crate) fn wire(deps: BillingDeps) -> Billing { /* … */ }
```

Because the layer modules are private to `billing`, `crate::billing::domain::…` does not compile anywhere outside
`billing`: the compiler enforces the published-only door exactly as a crate boundary would. Inside the context use
`pub(crate)`; `pub(in crate::billing)` adds nothing.

## Module style (D-WS-05)

- Rust 2018 module files, never `mod.rs` (A-07): `subscription.rs` beside a `subscription/` directory.
- A **layer root** (`domain.rs`, `application.rs`, …) only declares its child modules. It re-exports nothing.
- A **module file below it** (`client.rs`, `web.rs`, `repository.rs`, `acl/catalog.rs`) declares its children and
  re-exports what its callers need (`pub(crate) use subscription_client::routes as subscription_client_routes`).
- A **concept file** holds the concept's main type (its aggregate root when it has one, otherwise its main value
  object, as for a `metadata_candidate` concept) and declares the concept's other files as private children,
  re-exporting their types with `pub(crate) use`. Callers write `domain::subscription::BillingPeriod`, never
  `domain::subscription::billing_period::BillingPeriod`.
- Naming a file after its module's parent (`domain/subscription/subscription.rs`) trips clippy's
  `module_inception`; the concept file *is* the aggregate root, so this never comes up.
- One file per aggregate, entity, trait, and significant value object. Events of one concept share `events.rs`;
  its error enum is `error.rs`. Test fakes sit in the trait's file under `#[cfg(test)] pub(crate) mod fakes`.

## domain

Sliced by **concept**: one module per aggregate or ubiquitous-language notion, holding everything the concept owns:
the aggregate root, entities, value objects, enums, domain services, policies, events, its error, and the traits it
needs from the outside. A sub-concept module opens when a concept has its own aggregate root, its own trait, or a
family of polymorphic types large enough to deserve a name (`subscription/proration/`); it is named after the
concept, never after a type family. Sharing a name prefix is not a reason to open one.

Context-wide traits that belong to no single concept (`DomainEventPublisher`, an intent-named recorder spanning two
aggregates) and context-wide value objects (`Money`) sit at the `domain` root under their own names. A concept two
subdomains share also lives at the root under the combined projection's name, never in `shared/`.

```
billing/src/domain.rs                     pub(crate) mod invoice; pub(crate) mod money; … (declarations only)
billing/src/domain/
├── money.rs                              context-wide value object
├── renewal_recorder.rs                   trait spanning Subscription + Invoice (D-DOM-07)
├── subscription.rs                       aggregate root Subscription, SubscriptionId, re-exports of children
├── subscription/
│   ├── billing_period.rs                 value object
│   ├── error.rs                          SubscriptionError
│   ├── events.rs                         SubscriptionStarted, SubscriptionRenewed
│   ├── plan_code.rs                      value object (billing's own name for a catalog plan)
│   ├── plan_source.rs                    trait implemented by the catalog ACL
│   ├── subscription_repository.rs        trait (+ #[cfg(test)] fakes)
│   └── subscription_status.rs            enum with per-state data
├── invoice.rs                            aggregate root Invoice
└── invoice/
    └── events.rs
```

Banned module names at any depth (A-06): `model(s)`, `entity`/`entities`, `service(s)`, `repository`/`repositories`,
`port(s)`, `adapter(s)`, `policies`, `rules`, `factories`, `vo(s)`, `value_objects`, `enums`, `types`, `shared`,
`common`, `util(s)`, `helpers`. Not here: rows, SQL, HTTP types, use cases, DTOs.

## application

First level is the **scenario** produced by use-case analysis, not a mirror of `domain/`:

1. List the actors of the context: end user (`client`), back office (`management`), scheduled job, message consumer.
2. If one actor spans scenarios with different concepts, split by scenario first, then actor
   (`subscription/client/`, `subscription/management/`). An actor with one scenario is a single level (`client/`).
   A job-only scenario is its own module (`settlement/`), so a `job/` module never becomes a bag of concepts.
3. Names are actor names or ubiquitous-language nouns. `common`, `core`, `util(s)`, `helpers`, `ports`, `use_cases`,
   `dto(s)`, `service(s)` are not names (A-06). `shared` is a last resort for a genuinely cross-subdomain scenario
   after naming the combination has failed, never a utility bucket (D-APP-01).

```
billing/src/application.rs                pub(crate) mod client; (pub mod published; when other contexts call in)
billing/src/application/
├── published.rs                          inbound traits for other contexts (D-APP-05)
├── client.rs                             declares the scenario's files, re-exports their types
└── client/
    ├── output.rs                         SubscriptionOutput + From<&Subscription>
    ├── renew_subscription.rs             RenewSubscriptionUseCase + RenewSubscriptionInput + RenewSubscriptionError
    ├── start_subscription.rs             StartSubscriptionUseCase + StartSubscriptionInput + StartSubscriptionError
    └── subscription_client_query.rs      SubscriptionClientQueryUseCase (+ its *QueryRepository when it needs one)
```

With several scenarios and actors:

```
application/
├── published.rs
├── subscription/
│   ├── client/        renew_subscription.rs, subscription_client_query.rs, output.rs
│   └── management/    subscription_suspension.rs, subscription_management_query.rs,
│                      subscription_notification_app_service.rs, output.rs
└── settlement/        settle_invoices.rs
```

## infrastructure

Sliced by **tech concept**; the first-level module is one of a fixed set (A-06). Below it, one file per adapter,
named after the adapter type.

| module | holds |
|---|---|
| `repository/` | `Pg*Repository`, `Ch*Repository`, `Pg*QueryRepository`, intent-named atomic writers (`PgRenewalRecorder`); each file keeps its private `*Row` structs |
| `cache/` | `Redis*Cache`, `InMemory*Cache`, `Cached*` decorators |
| `lock/` | `Redis*LockRegistry` and other lock-trait implementations |
| `mq/` | `DomainEventPublisher` implementations over a broker; consumers that call event-driven use cases |
| `event/` | in-process publishers (`InMemoryDomainEventPublisher` over `tokio::sync::broadcast`) |
| `scheduling/` | tasks that call job use cases on an interval or cron |
| `acl/<target>/` | adapters onto another context's `published`, legacy code, or an external system; one sub-module per target |
| `storage/` | file and object storage (`Fs*`, `S3*`) |

No `config/` (configuration arrives through `wire`, D-WS-07), no `persistence/` (rows live beside their repository,
D-INF-02), no `context/`, no `adapters/`. A tech concept missing from the table is added by a decision record, not by
a new module.

```
billing/src/infrastructure/
├── repository.rs
├── repository/
│   ├── pg_renewal_recorder.rs            PgRenewalRecorder: one transaction, two aggregates
│   └── pg_subscription_repository.rs     PgSubscriptionRepository + SubscriptionRow
├── acl.rs
└── acl/
    ├── catalog.rs
    └── catalog/
        └── catalog_plan_source_acl.rs    CatalogPlanSourceAcl: billing's PlanSource over catalog::published
```

## presentation

Three first-level modules (A-06): `web/` for end users, `rpc/` for internal callers (service-to-service, a back-office
server that supplies `operator`), `ws/` for WebSocket. One module per (scenario, actor), named after it; it holds the
handlers, their state struct and its `routes()`. Request and response DTOs, when they exist (D-PRE-01), sit in the
same module.

```
billing/src/presentation/
├── web.rs
└── web/
    └── subscription_client.rs            SubscriptionClientHandlers, routes(), start/renew/find handlers
```

## Size thresholds (R-30)

| from | to | when |
|---|---|---|
| aggregate root file | behavior split into child modules, `impl Subscription` per business action (`subscription/renewal.rs`) | over 200 lines, test module excluded |
| `#[cfg(test)] mod tests` in a file | `<concept>/tests.rs` | over 200 lines |
| `events.rs` | `events/`, one file per event | more than 8 events |
| scenario `output.rs` | `output/` with `<aggregate>_output.rs` files and `output/assembler/` | more than 3 Outputs, or over 200 lines |
| use case file | `<use_case>.rs` + `<use_case>/{input.rs, error.rs}` | over 200 lines |
| small variant | standard variant | the developer's call (D-WS-02) |

Splitting an aggregate's behavior across files costs no visibility: child modules see their parent's private fields.
