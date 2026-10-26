# Infrastructure layer

Modules: `layers-and-modules.md` (tech-concept table, D-INF-01). This file covers how adapters are written.

Infrastructure may name domain and application types: aggregates, traits, `*QueryRepository` traits, Outputs, and
`published` messages its publisher translates into. It never names presentation (A-02).

No adapter contains business logic: an `if` on domain state inside infrastructure is a rule that escaped the domain.
`anyhow` is denied here too (A-04); errors map into the trait's error enum.

## Repositories

`Pg<Aggregate>Repository` implements the domain trait. Its file keeps a private row struct with the table's shape and
converts with `TryFrom`, rebuilding the aggregate through `from_persisted` (D-INF-02):

```rust
/// The table's shape. Private to this file; the domain never sees it.
#[derive(sqlx::FromRow)]
struct SubscriptionRow {
    id: i64,
    customer_id: i64,
    plan_code: String,
    price_cents: i64,
    period_starts_at: DateTime<Utc>,
    period_ends_at: DateTime<Utc>,
    status: String,
    pause_reason: Option<String>,
    cancelled_at: Option<DateTime<Utc>>,
}

fn corrupt(id: i64, what: impl std::fmt::Display) -> SubscriptionRepositoryError {
    SubscriptionRepositoryError::Backend(format!("subscription {id}: {what}").into())
}

impl TryFrom<SubscriptionRow> for Subscription {
    type Error = SubscriptionRepositoryError;

    fn try_from(row: SubscriptionRow) -> Result<Self, Self::Error> {
        let status = match row.status.as_str() {
            "active" => SubscriptionStatus::Active,
            "paused" => SubscriptionStatus::Paused { reason: row.pause_reason.unwrap_or_default() },
            "cancelled" => SubscriptionStatus::Cancelled {
                at: Timestamp::from_utc(row.cancelled_at.ok_or_else(|| corrupt(row.id, "cancelled without a date"))?),
            },
            other => return Err(corrupt(row.id, format!("unknown status {other:?}"))),
        };
        // … parse the remaining value objects, mapping failures through `corrupt`
        Ok(Subscription::from_persisted(/* … */))
    }
}

pub(crate) struct PgSubscriptionRepository {
    primary: PgPool,
    replica: PgPool,
}

impl PgSubscriptionRepository {
    pub(crate) fn new(primary: PgPool, replica: Option<PgPool>) -> Self {
        let replica = replica.unwrap_or_else(|| primary.clone());
        Self { primary, replica }
    }
}

#[async_trait]
impl SubscriptionRepository for PgSubscriptionRepository {
    async fn find_by_id(&self, id: SubscriptionId) -> Result<Option<Subscription>, SubscriptionRepositoryError> {
        self.find_in(&self.primary, id).await
    }

    async fn find_by_id_readonly(&self, id: SubscriptionId) -> Result<Option<Subscription>, SubscriptionRepositoryError> {
        self.find_in(&self.replica, id).await
    }

    async fn save(&self, subscription: &Subscription) -> Result<(), SubscriptionRepositoryError> {
        upsert(&self.primary, subscription).await.map_err(|e| SubscriptionRepositoryError::Backend(Box::new(e)))
    }
}
```

Bounds:

- Runtime-checked queries (`sqlx::query_as::<_, Row>`) or compile-time macros (`query_as!`) are an adapter choice;
  either way the row type stays private to the file.
- Writes bind straight from aggregate getters; no row is needed for an upsert.
- `sqlx::Error` never leaves the adapter: it is boxed into the trait's `Backend` variant. A row that fails to parse
  into value objects is the same `Backend` error, naming the id.
- `*_readonly` methods read from the replica pool; the replica falls back to the primary when none is configured.
- Query repositories (`Pg<Scenario><Actor>QueryRepository`) live in the same module and map their row into the
  `*Output` with `From<Row>`.
- An intent-named atomic method (`mark_expired`) is a single guarded statement; the `WHERE` clause carries the
  invariant the aggregate would have checked, and the return value reports whether the guard matched.

## Atomic writes across aggregates (D-DOM-07)

The implementation of an intent-named recorder opens and closes its own transaction. The transaction never crosses a
trait boundary; a helper shared with the repository takes any executor:

```rust
/// Shared with `PgRenewalRecorder`, which runs it inside its own transaction.
pub(super) async fn upsert<'e>(executor: impl PgExecutor<'e>, s: &Subscription) -> Result<(), sqlx::Error> {
    /* INSERT … ON CONFLICT (id) DO UPDATE … */
}

#[async_trait]
impl RenewalRecorder for PgRenewalRecorder {
    async fn record(&self, subscription: &Subscription, invoice: &Invoice) -> Result<(), RenewalRecorderError> {
        let mut tx = self.pool.begin().await.map_err(backend)?;
        upsert(&mut *tx, subscription).await.map_err(backend)?;
        sqlx::query(
            "INSERT INTO billing_invoices (id, subscription_id, amount_cents, period_starts_at, period_ends_at, issued_at) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(invoice.id().raw())
        // … remaining binds from Invoice getters
        .execute(&mut *tx)
        .await
        .map_err(backend)?;
        tx.commit().await.map_err(backend)
    }
}
```

## Migrations (D-INF-03)

Each context crate owns `migrations/` with only its tables, prefixed with the context (`billing_subscriptions`).
Versions are full `YYYYMMDDHHMMSS` timestamps (`sqlx migrate add` default; a date alone is not enough) so two
contexts never collide. The prefix stays even when it repeats (`reward_rewards`). The context's `migrate` tells
sqlx to ignore versions it does not own; without that, the second context to migrate fails with
`VersionMissing(<the other context's version>)`:

```rust
/// Applies this context's migrations. Other contexts' versions in the same database are ignored.
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    let mut migrator = sqlx::migrate!();
    migrator.set_ignore_missing(true);
    migrator.run(pool).await
}
```

No foreign key points into another context's table: references across contexts are values (`plan_code TEXT`), the
database form of "cross-aggregate references are ids". The small variant keeps one `migrations/` for the crate and
runs `sqlx::migrate!().run(pool)` from `bootstrap.rs`; a single-context crate may drop the table prefix.

## Caches, counters, locks

`Redis*` / `InMemory*` implementations of a domain cache trait (`SubscriptionCache`), which the use case calls
explicitly; that is the default. A `Cached*Repository` decorator (read-through around a repository) is for a
read-heavy repository where no use case needs to decide cache maintenance. A cache trait exists only once a use case
reads from it. TTLs, null caching and level composition are
adapter decisions the trait never mentions; put-versus-evict after a write is the use case's decision. A lock
implementation exposes the trait's execute-around method; acquisition order follows D-DOM-10.

## Messaging and events

- Producer: an `mq/` implementation of `DomainEventPublisher` (`<Broker>DomainEventPublisher`); topic, key, ordering
  and delay are adapter concerns. In-process delivery (`tokio::sync::broadcast`) is `event/InMemoryDomainEventPublisher`.
- Consumer: `<Event>Consumer`, thin: deserialize or receive, translate into the use case's `*Input`, call its
  `handle`, own the retry and dead-letter policy. A broker consumer sits in `mq/` and deserializes into its own private
  payload struct. A consumer of another context's in-process events names that context's `published` message, so it
  sits in `acl/<producer>/` like every other reference to another context (R-04).
- Across contexts the payload is the producer's published message type, not its domain event (application.md,
  `published`). The producer's publisher adapter does that translation.
- In-process delivery over `broadcast` is at most once: a crash between commit and send, a lagging receiver, or a
  consumer subscribed after the send loses the message. When a consumer must see every event, that is an outbox and a
  new decision entry.

## ACL

`acl/<target>/` implementations satisfy a domain trait by calling another context's `published`, legacy code, or an
external system:

```rust
/// Implements billing's `PlanSource` with catalog's published `PlanQueries`, translating catalog's
/// model into billing's at this boundary. Catalog's types never travel further in.
pub(crate) struct CatalogPlanSourceAcl {
    plans: Arc<dyn PlanQueries>,
}

#[async_trait]
impl PlanSource for CatalogPlanSourceAcl {
    async fn find_price(&self, plan: &PlanCode) -> Result<Option<Money>, PlanSourceError> {
        // Exhaustive on purpose: a new catalog error variant breaks this build and forces a decision here.
        match self.plans.find_plan(plan.as_str()).await {
            Ok(found) => Money::from_cents(found.monthly_price_cents)
                .map(Some)
                .map_err(|e| PlanSourceError::Unavailable(Box::new(e))),
            Err(PlanQueryError::NotFound(_) | PlanQueryError::InvalidCode(_)) => Ok(None),
            Err(e @ PlanQueryError::Unavailable(_)) => Err(PlanSourceError::Unavailable(Box::new(e))),
        }
    }
}
```

- One sub-module per target; one client per target serves every concept that needs it.
- The adapter translates the target's model into domain language at the boundary; target types never leak through
  the trait.
- Failure policy (an unknown plan is `Ok(None)`, an outage is an error) is part of the trait's contract, decided in
  domain terms, implemented here.
- External HTTP APIs follow the same shape: `DlsiteMetadataSourceAcl` holds its `reqwest::Client` and keeps the
  target's payload structs (`DlsiteProduct`) private. When a second ACL needs the same target, the HTTP calls move
  into a `<Target>Client` in `acl/<target>/` that both ACLs hold.
