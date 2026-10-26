# Domain layer

Placement: `layers-and-modules.md`. Names: `naming.md`. This file covers how domain types are written.

## Dependencies (D-DOM-01)

Domain code uses `std`, the kernel, and an allow-list of framework-level or language-standard crates that remove
ceremony without importing IO: `serde` (derives), `thiserror`, `chrono`, `uuid`, `async_trait`, `tracing`,
`rust_decimal`. Nothing else (A-04): no `tokio`, `sqlx`, `axum`, `reqwest`, `clickhouse`, `anyhow`, and no
`kernel::http`. Another context's crate never appears here; it is reached through an ACL (R-04).

## Aggregates and entities (D-DOM-05)

An aggregate root is a struct with **private fields** whose state changes only through **named behavior methods**.
The method name is the ubiquitous-language verb, the invariant check lives inside it, and it returns the domain event
it produced:

```rust
pub(crate) type SubscriptionId = Id<Subscription>;

/// Marker for the customer aggregate, owned by the customer context. Billing holds only its id.
pub(crate) enum Customer {}
pub(crate) type CustomerId = Id<Customer>;

#[derive(Debug, Clone)]
pub(crate) struct Subscription {
    id: SubscriptionId,
    customer_id: CustomerId,
    plan_code: PlanCode,
    price: Money,
    period: BillingPeriod,
    status: SubscriptionStatus,
}

impl Subscription {
    /// A customer subscribes to a plan; the first period starts at `at`.
    pub(crate) fn start(
        id: SubscriptionId,
        customer_id: CustomerId,
        plan_code: PlanCode,
        price: Money,
        period_days: u32,
        at: Timestamp,
    ) -> Result<(Self, SubscriptionStarted), SubscriptionError> {
        let period = BillingPeriod::starting(at, period_days)?;
        let subscription = Self { id, customer_id, plan_code, price, period, status: SubscriptionStatus::Active };
        let started = SubscriptionStarted { subscription_id: id, customer_id, period, at };
        Ok((subscription, started))
    }

    /// Moves an active subscription into its next period once the current one is over.
    pub(crate) fn renew(&mut self, at: Timestamp) -> Result<SubscriptionRenewed, SubscriptionError> {
        if self.status != SubscriptionStatus::Active {
            return Err(SubscriptionError::NotActive(self.id));
        }
        if at < self.period.ends_at() {
            return Err(SubscriptionError::PeriodNotOver(self.id));
        }
        self.period = self.period.next();
        Ok(SubscriptionRenewed { subscription_id: self.id, period: self.period, price: self.price, at })
    }

    /// Rebuilds a stored subscription. Repositories only: invariants were checked when it was stored.
    pub(crate) fn from_persisted(/* every field */) -> Self { /* … */ }

    pub(crate) fn id(&self) -> SubscriptionId { self.id }
    pub(crate) fn period(&self) -> BillingPeriod { self.period }
    pub(crate) fn status(&self) -> &SubscriptionStatus { &self.status }
    // … one getter per field the outer layers need
}
```

Rules:

- **No public fields, no setters** (A-12). Getters return `Copy` values or references; nothing hands out `&mut` to an
  internal entity.
- **Behavior takes `&mut self` and returns `Result<Event, Error>`.** Consuming `self` would destroy the aggregate on
  a refused command; the caller could no longer report on it.
- **Creation** is an associated function named for the business moment (`Subscription::start`,
  `Invoice::issue_for`) returning the aggregate and its creation event. When the *decision* to create needs
  collaborators (a uniqueness check, a lookup that changes what gets built), it is a `<Aggregate>Factory` domain
  service. A use case that only fetches an input value (a price from `PlanSource`) passes it in; that is not a factory. There is no "new it, then set fields" path: a constructed
  aggregate is always legal.
- **Reconstitution** is `from_persisted(...)`, `pub(crate)`, called only from repository adapters. It skips the
  business checks; value objects still parse, so corrupt rows surface as repository errors.
- **State machines** are enums whose variants carry only the data that exists in that state; guards are `match` or
  `matches!` inside behavior methods. No typestate on aggregates: a repository load cannot know the state at compile
  time and would wrap it back into an enum. Typestate is fine for in-memory builders.
- **Cross-aggregate references are ids**, never `&Aggregate` or `Arc<Aggregate>`. An aggregate owned by another
  context is referenced as `Id<Marker>` with an uninhabited marker enum declared beside the concept that holds it.
- **Child entities load eagerly** by default; the repository, not the aggregate, decides how to hydrate them.
- **Size**: past 200 lines (tests excluded), move behavior groups into child modules, each with its own
  `impl Subscription` block (`subscription/renewal.rs`). Child modules see the parent's private fields.

## Identity (D-DOM-02)

Ids are `kernel::Id<E>`: a phantom-typed integer (or UUID; the kernel picks one representation per project) that
makes a `SubscriptionId` unusable where an `InvoiceId` is expected, at no runtime cost. An aggregate has its id from
construction; `Option<…Id>` as an aggregate's own `id` is a deviation (A-13). The application layer obtains new ids
from `Arc<dyn IdGenerator>` (`self.ids.next()`, typed by inference) and passes them in; domain code never generates
one.

## Time and randomness (D-DOM-03)

Domain code never reads a clock or a random source (A-05): no `Utc::now()`, `SystemTime::now()`, `Instant::now()`,
`Uuid::new_v4()`, `thread_rng()`. Behavior methods take `at: Timestamp`; the use case reads `Arc<dyn Clock>` once
and passes the instant down. Domain tests therefore need no mocks.

## Value objects

Immutable, identity-less, self-validating. Two shapes:

- **No invariant beyond the type** (an id, a label): a newtype over the raw value. Prefer `kernel::Id<E>` for ids.
- **With an invariant**: private field, a smart constructor returning `Result`, read accessors. When the value object
  arrives from the wire (it is an `*Input` field), it deserializes through the constructor:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub(crate) struct PlanCode(String);

impl PlanCode {
    pub(crate) fn parse(raw: &str) -> Result<Self, PlanCodeError> {
        let valid = (1..=32).contains(&raw.len())
            && raw.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if valid { Ok(Self(raw.to_owned())) } else { Err(PlanCodeError(raw.to_owned())) }
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for PlanCode {
    type Error = PlanCodeError;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(&raw)
    }
}
```

A value object with several fields keeps them private too (`BillingPeriod { starts_at, ends_at, days }` with
`starting(at, days) -> Result<…>`, `next()`, getters). Two contexts may each have their own `PlanCode`: same
spelling rules, different types, translated by the ACL.

## Validation placement (D-DOM-06)

Two kinds, two homes, never a third:

- **format** (blank, length, pattern, range): value-object constructors. `*Input` fields *are* value objects, so a
  malformed request fails during deserialization and a use case only ever sees well-formed input ("parse, don't
  validate").
- **business invariants** (state machine, quotas, relationships): aggregate behavior methods and domain services.

Presentation adds nothing; a business check inside a use case body is a smell that belongs in one of the two homes.

## Enums

Enums are domain types and may carry behavior. A wire or database representation is a plain method
(`SubscriptionStatus::as_str`) or a serde attribute; the mapping back from a row lives in the adapter.

## Events (D-DOM-08)

```rust
#[must_use = "publish the event or discard it explicitly"]
#[derive(Debug, Clone, Serialize)]
pub(crate) struct SubscriptionRenewed {
    pub(crate) subscription_id: SubscriptionId,
    pub(crate) period: BillingPeriod,
    pub(crate) price: Money,
    pub(crate) at: Timestamp,
}
```

- One struct per event in the concept's `events.rs`, named `<Aggregate><PastTense>`. Fields are `pub(crate)`: an
  event is data (A-12 exempts `events` modules).
- `#[must_use]` (A-14): ignoring a behavior method's event is a compiler warning, so dropping it is a visible choice
  (`let (invoice, _issued) = …`).
- `Serialize`, so the payload is ready for a broker or an outbox, and its value objects derive `Serialize` too.
- A `<Ctx>Event` enum with `From` impls exists only once a `DomainEventPublisher` does (R-20). Both live in
  `domain/domain_event_publisher.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
pub(crate) enum BillingEvent {
    InvoiceSettled(InvoiceSettled),
}

#[async_trait]
pub(crate) trait DomainEventPublisher: Send + Sync {
    async fn publish(&self, event: BillingEvent) -> Result<(), DomainEventPublisherError>;
}
```

- An event with a consumer goes through the publisher, never straight to a transport. An event without one is still
  dropped explicitly (`_extended`); the enum grows a variant when that event gains a consumer.
- Publishing happens after persistence, so a publish failure must not undo or misreport the committed change: the use
  case logs it (`tracing::warn!`) and returns success. Anything stronger than at-most-once is an outbox (D-DOM-08).

## Errors (D-DOM-11)

One `thiserror` enum per concept in `error.rs`, implementing `kernel::ErrorCode` with stable codes in the concept's
language:

```rust
#[derive(Debug, thiserror::Error)]
pub(crate) enum SubscriptionError {
    #[error("a billing period must last at least one day")]
    EmptyPeriod,
    #[error("subscription {0} is not active")]
    NotActive(SubscriptionId),
    #[error("subscription {0} is still in its current period")]
    PeriodNotOver(SubscriptionId),
}

impl ErrorCode for SubscriptionError {
    fn code(&self) -> &'static str {
        match self {
            Self::EmptyPeriod => "subscription.empty_period",
            Self::NotActive(_) => "subscription.not_active",
            Self::PeriodNotOver(_) => "subscription.period_not_over",
        }
    }

    fn kind(&self) -> ErrorKind {
        match self {
            Self::EmptyPeriod => ErrorKind::Invalid,
            Self::NotActive(_) | Self::PeriodNotOver(_) => ErrorKind::Rejected,
        }
    }
}
```

## Traits the domain needs (D-DOM-04)

Every capability the domain needs from outside is a small trait beside the concept that needs it, named for the need
(`SubscriptionRepository`, `PlanSource`, `SubscriptionCache`); the adapter decides the technology. A trait spanning
concepts (`RenewalRecorder`, `DomainEventPublisher`) sits at the `domain` root.

```rust
#[async_trait]
pub(crate) trait SubscriptionRepository: Send + Sync {
    async fn find_by_id(&self, id: SubscriptionId) -> Result<Option<Subscription>, SubscriptionRepositoryError>;
    /// Reads from the replica: the caller accepts replication lag.
    async fn find_by_id_readonly(&self, id: SubscriptionId) -> Result<Option<Subscription>, SubscriptionRepositoryError>;
    /// Upsert.
    async fn save(&self, subscription: &Subscription) -> Result<(), SubscriptionRepositoryError>;
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum SubscriptionRepositoryError {
    #[error("subscription storage failed")]
    Backend(#[source] Box<dyn std::error::Error + Send + Sync>),
}
```

- `#[async_trait]` and `Send + Sync`: implementations are held as `Arc<dyn Trait>` (D-DOM-04 records why).
- A repository returns aggregates (or nothing) and speaks domain language. Method vocabulary is in `naming.md`.
- Replica reads are separate `*_readonly` methods; the call site decides whether lag is acceptable (D-DOM-09).
- Beside `save`, a repository may expose an intent-named atomic method (`mark_expired(id)`) when load-mutate-save
  cannot deliver the atomicity; two aggregates written atomically get their own single-method trait (D-DOM-07):

```rust
/// Records a renewal: the renewed subscription and the invoice it issued are stored together or not at
/// all. One method, named for the business moment — not a generic unit of work.
#[async_trait]
pub(crate) trait RenewalRecorder: Send + Sync {
    async fn record(&self, subscription: &Subscription, invoice: &Invoice) -> Result<(), RenewalRecorderError>;
}
```

- No transaction, connection, pool or row type in any signature.
- A fake for tests sits in the same file under `#[cfg(test)] pub(crate) mod fakes` (`FakeSubscriptionRepository`
  over a `Mutex<HashMap<…>>`); the concept file gathers its fakes into one `#[cfg(test)] pub(crate) mod fakes`.

## Domain services

A domain service exists when a behavior spans aggregates or needs a trait the aggregate cannot hold:

- named as an agent noun (`naming.md`), one capability per struct;
- holds `Arc<dyn Trait>` collaborators; many collaborators means several services, split by capability;
- may run an atomic multi-aggregate write only through an intent-named trait (D-DOM-07);
- returns events like aggregates do; it never publishes them itself.

Extracting a policy trait is not free abstraction. Logic with one implementation and one caller stays inline. Extract
when a second implementation exists, a test must substitute it, or the policy is a named concept a non-engineer
recognizes. Conditions that combine with AND are one policy growing richer, not alternative strategies.

## Concurrency (D-DOM-10)

None by default. When two writers can really collide, the aggregate gains a `version: i64`, `save` updates with
`WHERE id = $1 AND version = $2`, and a miss surfaces as a `Conflict` variant the use case may retry. A
`<Concept>LockRegistry` trait exists only when the critical section spans an external side effect, and its lock is
acquired before any transaction opens.
