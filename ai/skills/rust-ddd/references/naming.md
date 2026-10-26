# Naming

One table, one meaning per name. A suffix or prefix absent from this table is not available: pick the closest row or
the name is wrong. Files are the snake_case of the type they hold (`RenewSubscriptionUseCase` lives in
`renew_subscription.rs`; the layer path already says "use case").

## By layer

| layer | kind | name | example |
|---|---|---|---|
| domain | aggregate root / entity | bare noun | `Subscription`, `Invoice` |
| domain | aggregate id | `<Aggregate>Id` = `Id<Aggregate>` | `type SubscriptionId = Id<Subscription>;` |
| domain | foreign aggregate marker | bare noun, uninhabited enum | `enum Customer {}` + `type CustomerId = Id<Customer>;` |
| domain | value object | bare noun | `BillingPeriod`, `Money`, `PlanCode` |
| domain | enum | bare noun (+`Status`/`Kind` when it is one) | `SubscriptionStatus` |
| domain | repository trait | `<Aggregate>Repository` | `SubscriptionRepository` |
| domain | other trait the domain needs | `<Concept><Capability>` | `PlanSource`, `SubscriptionCache`, `InvoiceNumberGenerator` |
| domain | multi-aggregate atomic write | `<BusinessMoment>Recorder` or another intent noun | `RenewalRecorder` (D-DOM-07) |
| domain | replica read | method suffix `_readonly` | `find_by_id_readonly` (D-DOM-09) |
| domain | domain service | agent noun from the ubiquitous language | `SubscriptionRenewer`, `ProrationCalculator`, `EligibilityGuard` |
| domain | policy / rule family | `<Concept>Policy` / `<Concept>Rule` | `ProrationPolicy` |
| domain | factory needing collaborators | `<Aggregate>Factory` | `SubscriptionFactory` |
| domain | creation without collaborators | associated fn named for the business moment | `Subscription::start`, `Invoice::issue_for` |
| domain | event | `<Aggregate><PastTense>`; `<Action>Requested` for an async command | `SubscriptionRenewed`, `InvoiceSettlementRequested` |
| domain | context event enum (only with a publisher) | `<Ctx>Event` | `BillingEvent` |
| domain | error | `<Concept>Error`, in `error.rs` | `SubscriptionError` |
| domain | context-wide traits | `DomainEventPublisher`, `<Concept>LockRegistry` | |
| application | command use case | `<Verb><Aggregate>UseCase`, entry `execute(&self, input)` | `RenewSubscriptionUseCase` |
| application | grouped command use case | name states the grouping rationale (D-APP-02) | `SubscriptionSuspensionUseCase` |
| application | event-driven use case | `<Verb><Aggregate>UseCase`, entry `handle(&self, input: <Verb><Aggregate>Input)`; the consumer translates the event into the Input. When the verb equals an existing command's, qualify with the trigger | `SendReceiptUseCase`, `RenewSubscriptionOnPaymentUseCase` |
| application | query use case | `<Scenario><Actor>QueryUseCase` | `SubscriptionClientQueryUseCase`, `PlanClientQueryUseCase` |
| application | read-model trait | `<Scenario><Actor>QueryRepository` | `PlanClientQueryRepository` |
| application | reusable application steps | `<Concept>AppService` | `SubscriptionNotificationAppService` |
| application | input / output | `<Verb><Aggregate>Input`, `<Aggregate>Output`, `<Aggregate>ListItemOutput`; a result that is not an aggregate view is `<Verb><Aggregate>Output` (a job's counts); an Input may be empty | `RenewSubscriptionInput`, `RegisterWorksOutput` |
| application | use-case error | `<Verb><Aggregate>Error` / `<Scenario><Actor>QueryError`; a query use case implementing a published trait returns that trait's contract error, `<Aggregate>QueryError` | `RenewSubscriptionError`, `PlanQueryError` |
| application | gathering assembler | `<Aggregate>OutputAssembler` (D-APP-06) | `SubscriptionOutputAssembler` |
| application | published trait | `<Aggregate>Queries` / `<Aggregate>Commands` | `PlanQueries` |
| application | published command delegator (zero logic) | `Default<Trait>` | `DefaultSubscriptionCommands` |
| infrastructure | trait implementation | `<Tech><Trait>` | `PgSubscriptionRepository`, `RedisSubscriptionCache`, `InMemoryDomainEventPublisher`, `PgRenewalRecorder` |
| infrastructure | implementation onto another context / legacy / external system | `<Target><Trait>Acl`; the target is not repeated when the trait already starts with it | `CatalogPlanSourceAcl`, `DlsiteMetadataSourceAcl`, `CustomerTierSourceAcl` (trait `CustomerTierSource`) |
| infrastructure | persistence row | `<Aggregate or child>Row` without the context prefix the table carries, private to the adapter file | `SubscriptionRow` for `billing_subscriptions` |
| infrastructure | HTTP client shared by a target's ACLs | `<Target>Client`, in `acl/<target>/` | `DlsiteClient` |
| infrastructure | external payload (private to the ACL or client file) | the target's own noun, prefixed with the target | `DlsiteProduct`, `VndbVisualNovel` |
| infrastructure | scheduled trigger | a `spawn` fn in `scheduling/<job>.rs` taking the use case and its interval; a type only when it holds state | `scheduling/library_scan.rs` |
| infrastructure | message consumer | `<Event>Consumer`, in `mq/` (broker) or `acl/<producer>/` (another context's in-process events) | `InvoiceSettledConsumer` |
| presentation | handler module | `<scenario>_<actor>` | `web/subscription_client.rs` |
| presentation | handler state | `<Scenario><Actor>Handlers` | `SubscriptionClientHandlers` |
| presentation | handler fn | the use-case verb | `renew_subscription`, `find_subscription` |
| presentation | request DTO (D-PRE-01) | `<Verb><Aggregate>Request` | `RenewSubscriptionRequest` |
| presentation | response DTO (when `*Output` is unsuitable) | `<Aggregate>Response` | `SubscriptionResponse` |
| wiring | context root items | `<Ctx>Deps`, `<Ctx>Config`, `<Ctx>`, `wire`, `migrate` | `BillingDeps`, `Billing` |
| tests | fake of a trait | `Fake<Trait>` | `FakeSubscriptionRepository`, `FakeClock` |

**Tech prefixes** (A-11, configurable): `Pg`, `Ch` (ClickHouse), `Redis`, `InMemory`, `Fs`, `S3`, `Cached`
(decorator). Extend the list in the architecture test's configuration when a new technology arrives.

`<Scenario>` is the noun of the `application/<scenario>/` module: `Subscription` for `subscription/`,
`InvoiceDunning` for a `dunning/` scenario that chases overdue invoices (a flow carries its aggregate as qualifier).
When a single actor collapses the levels (`application/client/`), the scenario is the context's main aggregate.
`<Actor>` is the second level (`Client`, `Management`). A handler module or query use case is never named after the
aggregate alone: it fronts a scenario, not a domain type.

## Methods and vocabulary

Type names are half the ubiquitous language; methods, variants and log messages carry the rest. Not every reader is
a native English speaker, so plain words win over precise-but-rare ones.

- Name a method for what the caller gets, not the mechanism: `CurrentPeriodResolver::resolve()` over
  `rollover_if_needed()`, `can_renew()` over `pass()`.
- Domain vocabulary and log messages never borrow transaction, database or cache jargon: `AlreadyPaid`, not
  `Duplicated`; a reservation is `kept` or `released`, never `committed` or `rolled_back`; the log says "invoice
  already settled", not "unique constraint hit".
- Prefer common English (`Replaced` over `Superseded`): if a B2 reader cannot parse the name in one pass, pick the
  plainer word.
- Related types and variants take parallel names (`AlreadySettled` on the settlement outcome ↔ `AlreadyPaid` on the
  payment it came from).
- No setters: a state change is a business action (`renew`, `pause`, `reset_to`), never `set_status` (A-12).
- Repository methods: `find_by_*` returns `Option` (a miss is not an error; use-case and published methods instead
  report a miss as a `NotFound` variant, because their callers need a code), `list_*` always takes a limit, `save` is
  an upsert, `delete` is idempotent, `exists` returns `bool`. Not available: `get_*`, `insert`, `update`, `load`,
  `store`, `fetch`, `query`. Intent-named atomic methods (`mark_expired`) are allowed under D-DOM-07.
- Error codes are `"<concept>.<snake_case_reason>"`: `"subscription.period_not_over"`, `"plan.not_found"`.
- Tracing spans on use cases are `use_case.<snake_case_use_case>`: `use_case.renew_subscription`.

## Banned names

Everywhere (A-10): `*Impl`, `*Adapter`, `*Port`, `*Mapper`, `*Converter`, `*Dto`, `*Po`, `*Dao`, `*Entity`, `*Vo`,
`*TransactionalWriter`, `*DomainService`, `*UnitOfWork` (D-DOM-07).
In domain and application: `*Manager`, `*Helper`, `*Util(s)`, too general: the logic they hide belongs to a named
domain service, a `From` impl, or an AppService.
Module names: see `layers-and-modules.md` (A-06).

## Domain service naming procedure

1. Say what the service does in the ubiquitous language: "it renews subscriptions".
2. Turn the verb into the agent noun: `SubscriptionRenewer`. Tactical words are fine when they are the concept:
   `Resolver`, `Assigner`, `Guard`, `Calculator`, `Policy`, `Factory`, `Specification`. A `Guard` answers
   allowed-or-refused with a reason; a `Policy` is a rule with alternative implementations; a `Specification` is a
   predicate meant to be combined with others.

Before naming a service at all: a decision that reads only one aggregate's own data is a method on that aggregate
(`Plan::can_be_offered_in(&country)`), not a service.
3. `*Service` stays only when no agent noun reads naturally. A `*Service` holding a bag of unrelated methods is
   several agent nouns.
