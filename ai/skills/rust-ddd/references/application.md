# Application layer

Placement: `layers-and-modules.md`. Granularity: D-APP-02. This file owns how a use case is written.

## Dependencies

Application code uses the domain, the kernel, `serde`, `thiserror`, `async_trait`, `tracing`, and `tokio`'s
concurrency tools (`join!`, `sync`, `time::timeout`). Denied (A-04): `sqlx`, `axum`, `reqwest`, `clickhouse`,
`anyhow`, `kernel::http`, and `tokio`'s IO modules (`fs`, `io`, `net`, `process`).

## Command use case anatomy

One intent, one public method, one file. The file holds the use case, its `*Input` and its `*Error`:

```rust
#[derive(Debug, Deserialize)]
pub(crate) struct RenewSubscriptionInput {
    pub(crate) subscription_id: SubscriptionId,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum RenewSubscriptionError {
    #[error("subscription {0} not found")]
    NotFound(SubscriptionId),
    #[error(transparent)]
    Subscription(#[from] SubscriptionError),
    #[error(transparent)]
    Repository(#[from] SubscriptionRepositoryError),
    #[error(transparent)]
    Recorder(#[from] RenewalRecorderError),
}

impl ErrorCode for RenewSubscriptionError {
    fn code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "subscription.not_found",
            Self::Subscription(e) => e.code(),
            Self::Repository(_) | Self::Recorder(_) => "billing.unavailable",
        }
    }

    fn kind(&self) -> ErrorKind {
        match self {
            Self::NotFound(_) => ErrorKind::NotFound,
            Self::Subscription(e) => e.kind(),
            Self::Repository(_) | Self::Recorder(_) => ErrorKind::Unavailable,
        }
    }
}

pub(crate) struct RenewSubscriptionUseCase {
    subscriptions: Arc<dyn SubscriptionRepository>,
    renewals: Arc<dyn RenewalRecorder>,
    ids: Arc<dyn IdGenerator>,
    clock: Arc<dyn Clock>,
}

impl RenewSubscriptionUseCase {
    pub(crate) fn new(/* the four collaborators */) -> Self { /* … */ }

    #[tracing::instrument(name = "use_case.renew_subscription", skip(self))]
    pub(crate) async fn execute(
        &self,
        input: RenewSubscriptionInput,
    ) -> Result<SubscriptionOutput, RenewSubscriptionError> {
        // 1. load
        let mut subscription = self
            .subscriptions
            .find_by_id(input.subscription_id)
            .await?
            .ok_or(RenewSubscriptionError::NotFound(input.subscription_id))?;
        // 2. domain behavior
        let renewed = subscription.renew(self.clock.now())?;
        let (invoice, _issued) = Invoice::issue_for(&renewed, self.ids.next());
        // 3. persist both aggregates atomically through the intent-named trait
        self.renewals.record(&subscription, &invoice).await?;
        // 4. side effects would go here (cache, DomainEventPublisher once a consumer exists)
        // 5. output
        Ok(SubscriptionOutput::from(&subscription))
    }
}
```

The body is orchestration in a fixed order; anything that reads like business policy sinks into the domain:

1. receive an `*Input` whose fields are already-parsed value objects (D-DOM-06); it also carries audit fields such
   as `operator`;
2. load aggregates through their repositories;
3. read the clock and take new ids here, then invoke domain behavior (aggregate method or domain service);
4. persist: `save` for one aggregate, the intent-named trait for several (D-DOM-07). No transaction opens here;
5. side effects: cache maintenance, event publishing (D-DOM-08), after persistence;
6. build the `*Output` (D-APP-06).

Collaborators are `Arc<dyn Trait>`, never generics (D-DOM-04). Every use-case error implements `kernel::ErrorCode`,
delegating to the domain error where one is wrapped; backend failures map to `ErrorKind::Unavailable` with a
context-level code (`"billing.unavailable"`).

Cache maintenance in step 5 is the use case's call: `put` when masking replica lag matters and the cached value is
cheap to build from the aggregate in hand; evict when the cached shape needs nontrivial computation, so the query
path's loader owns the refresh. The adapter only executes the chosen operation.

## Grouping rules (D-APP-02)

A multi-method use case is allowed when every method operates on the same aggregate, the methods share real flow
(private helpers or the same collaborators), and the name states the grouping rationale in the context's language.
Never grouped together:

- a command with a message handler: a consumer drives its own use case with a single `handle` (A-08);
- a command with a side-effect-free predicate: that is a query use case or a domain service;
- a method that writes a second aggregate: that write belongs to the other aggregate's use case, or to an
  intent-named trait when it must be atomic.

## Query side (D-APP-04)

`*QueryUseCase` groups the scenario's reads freely and never mutates state; a "query" that touches a counter or
writes a projection is a command. Two sources:

- a by-id read of an aggregate reuses the domain repository, through its `*_readonly` method when lag is fine;
- a read-model shape the domain has no reason to know gets a `*QueryRepository` trait declared in the same scenario
  module, returning the `*Output` directly or an intermediate the use case composes:

```rust
/// Read model for the client scenario. Returns `*Output` directly; the domain never sees this shape.
#[async_trait]
pub(crate) trait PlanClientQueryRepository: Send + Sync {
    async fn find_by_code(&self, code: &PlanCode) -> Result<Option<PlanOutput>, PlanClientQueryRepositoryError>;
}
```

A query may also read through a domain trait that reaches an external source (`MetadataSource`); concurrent reads use
`tokio::join!`.

When one trait has an implementation per external source, a domain enum names the source and the use case holds
`HashMap<MetadataProvider, Arc<dyn MetadataSource>>`, built in wiring.

The adapter (`PgPlanClientQueryRepository`, in `infrastructure/repository/`) maps its own row into the Output with
`From`. Outputs never derive `sqlx::FromRow`: application does not depend on sqlx.

## Outputs and conversions (D-APP-06)

A scenario's Outputs live in its `output.rs`; a pure conversion is a `From` impl beside the Output:

```rust
#[derive(Debug, Serialize)]
pub(crate) struct SubscriptionOutput {
    id: SubscriptionId,
    customer_id: CustomerId,
    plan_code: String,
    price_cents: i64,
    period_starts_at: Timestamp,
    period_ends_at: Timestamp,
    status: &'static str,
}

impl From<&Subscription> for SubscriptionOutput {
    fn from(subscription: &Subscription) -> Self {
        Self {
            id: subscription.id(),
            customer_id: subscription.customer_id(),
            plan_code: subscription.plan_code().as_str().to_owned(),
            price_cents: subscription.price().cents(),
            period_starts_at: subscription.period().starts_at(),
            period_ends_at: subscription.period().ends_at(),
            status: subscription.status().as_str(),
        }
    }
}
```

Each scenario owns its Outputs. When a second scenario returns the same shape, it uses the first scenario's Output by
path (`super::client::PlanOutput`) instead of copying it; `published` re-exports the Output from the scenario whose
use case implements the published trait.

When building an Output means gathering from collaborators (another repository, a trait call), that work is a
`<Aggregate>OutputAssembler` struct holding `Arc<dyn …>` collaborators, in `output/assembler/` once the scenario
crosses the size threshold. `*Mapper` and `*Converter` do not exist (A-10).

## AppService (D-APP-03)

Reusable application-level steps shared by several use cases (side-effect fan-out, enrichment) live in a
`<Concept>AppService` in the scenario that owns them. Called only by use cases (A-09), opens no transaction, holds no
business rule. Standing review question: "would this read better as a domain service?"

## Event-driven use cases

A consumer (`infrastructure/mq/` for a broker, `infrastructure/acl/<producer>/` for another context's in-process
events) translates the message into the use case's `*Input` and calls its single `handle(&self, input)`; retry and
dead-letter policy stay in the consumer, the business reaction in the use case.

## published (D-APP-05)

The context's in-process inbound door, and the only thing other contexts can name. Capability-grouped traits, sized
like a good SDK; their parameters and returns are Inputs, Outputs, primitives and behavior-less domain enums or
value objects:

```rust
//! The only door into the catalog context for other contexts. Everything here is a contract:
//! inputs and outputs are DTOs or primitives, never domain behavior.

pub use super::client::{PlanOutput, PlanQueryError};

#[async_trait]
pub trait PlanQueries: Send + Sync {
    async fn find_plan(&self, code: &str) -> Result<PlanOutput, PlanQueryError>;
}
```

- A query trait is implemented by the `*QueryUseCase` directly; a command trait by a zero-logic `Default<Trait>`
  delegator in `published.rs`.
- Everything `published` names is `pub` (standard) or `pub(crate)` (small) and re-exported from `published.rs`.
- A published error is its own contract: it is the implementing use case's error (`PlanQueryError`, defined in the
  use-case file and re-exported), wraps internal failures as `Unavailable(Box<dyn Error + Send + Sync>)` and never
  contains an internal type.
- Published Outputs are data: `pub` fields, no getters.
- Published enums are not `#[non_exhaustive]`: inside one workspace, a new variant breaking every caller's `match`
  is the point. The caller's ACL must decide what the new case means.
- `wire` returns the published implementation (`Arc<dyn PlanQueries>`) on the context's handle so the binary can
  pass it into the next context's `*Deps`.
- An event another context consumes crosses as a **published message type** (`published::InvoiceSettledMessage`:
  ids as primitives, no domain behavior), never as the domain event struct. The publisher adapter translates the
  domain event into the message. For in-process delivery, the producer's handle exposes a subscription
  (`invoice_settled: broadcast::Sender<published::InvoiceSettledMessage>`, consumers call `.subscribe()`), the binary
  passes it into the consumer's `*Deps`, and the consumer context's `infrastructure/acl/<producer>/<Event>Consumer`
  (it names another context, so it lives under `acl/`, R-04) translates the message into its own `*Input` and calls
  its use case's `handle`. Its `wire` subscribes and starts the loop with `tokio::spawn`.
