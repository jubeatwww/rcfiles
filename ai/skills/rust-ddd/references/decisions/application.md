# Decisions — application layer

Format: see `workspace.md`.

## D-APP-01 — sliced by scenario, then actor

**Context.** Actor-only slicing turns `job/` into a bag of unrelated concepts; concept-only slicing scatters one
concept's actors; type slicing (`ports/`, `use_cases/`) says nothing about the business.

**Decision.** First level is the scenario; an actor is a second level only when the scenario has several. Names are
actors or ubiquitous-language nouns. `common`, `core`, `util(s)`, `helpers`, `ports`, `use_cases`, `dto(s)`,
`service(s)` are not names at any depth (A-06). `shared` never appears in domain, and in application only for a
genuinely cross-subdomain scenario after naming the combination has failed.

**Rejected.** A fixed actor whitelist as the first level; `ports/` + `use_cases/` per context; free naming.

## D-APP-02 — use-case granularity and file shape

**Context.** One intent per type is clean for commands but explodes for CRUD and queries; facades blur transaction
boundaries. Rust modules are files that may hold several items.

**Decision.** A command use case is one intent with one public method (`execute`) in one file, which also holds its
`*Input` and `*Error`. A multi-method use case is allowed when every method operates on the same aggregate, the
methods share real flow, none is a message handler, no side-effect-free predicate sits beside a command, no method
writes a second aggregate, and the name states the grouping rationale. Queries group freely in a `*QueryUseCase`.
A use case file over 200 lines moves its Input and Error into `<use_case>/{input.rs, error.rs}`.

**Rejected.** Input and Output in a `dto/` tree away from their use case; strict one-type-per-file; unrestricted
facades.

**Consequence.** A-08 checks the handler rule; the rest is review.

## D-APP-03 — `*AppService`

**Decision.** Application steps shared by several use cases (side-effect fan-out, enrichment) live in
`<Concept>AppService` in the scenario that owns them, called only by use cases (A-09), opening no transaction.

**Rejected.** Banning the tier: the logic lands in the wrong use case or leaks into domain services.

**Consequence.** The standing review question is "would this read better as a domain service?"

## D-APP-04 — query repositories in application

**Decision.** Read models the domain has no reason to know get a `*QueryRepository` trait in their application
scenario, implemented in `infrastructure/repository/`, returning the `*Output` or an intermediate. Its adapter maps
a private row into the Output with `From`; Outputs never derive `FromRow`. A by-id read of an aggregate reuses the
domain repository.

**Consequence.** Two kinds of repository in one infrastructure module, told apart by the `Query` infix.

## D-APP-05 — `published` is the only inbound door

**Context.** Other contexts need in-process access; letting them reach domain traits or use cases couples models.

**Decision.** A context exposes capability-grouped traits in `application/published.rs`, re-exported at the context
root. A query trait is implemented by its `*QueryUseCase`; a command trait by a zero-logic `Default<Trait>`
delegator. Parameters and returns are Inputs, Outputs, primitives and behavior-less domain enums or value objects.
Published errors wrap internal failures and expose no internal type. Callers reach `published` only from their own
`infrastructure/acl/<target>/`, implementing a trait of their own domain (A-03). Published enums are not
`#[non_exhaustive]`: inside one workspace, a new variant breaking callers' exhaustive matches forces each ACL to
decide.

Events another context consumes cross as published message types, translated from domain events by the publisher
adapter; the domain event struct never leaves its context.

**Why application, not presentation.** The trait is a driving port; presentation holds protocol adapters. From the
caller's side the rule is uniform: always an ACL; only the transport differs (in-process `published`, or the
provider's `presentation/rpc/` over the network).

**Rejected.** Callers importing the callee's use cases or domain directly; a caller-side `*Port` naming scheme.

## D-APP-06 — conversions are standard traits; `Assembler` only gathers

**Context.** The JVM standard needed `*PoMapper` and `*OutputAssembler` classes for conversions. Rust has `From` and
`TryFrom`, which callers already reach for (`?`, `.into()`).

**Decision.** A pure conversion is a `From`/`TryFrom` impl: row to aggregate in the adapter file, aggregate to Output
in the scenario's `output.rs`, `*Request` to `*Input` in the handler module. Building an Output that needs data from
collaborators is a `<Aggregate>OutputAssembler` struct. A conversion that needs extra arguments (an aggregate plus its
child rows) is an associated function. `*Mapper` and `*Converter` do not exist (A-10). A scenario's `output.rs`
becomes `output/` (one file per Output, plus `output/assembler/`) past 3 Outputs or 200 lines.

**Rejected.** Inherent `into_domain()` / `from_domain()` methods on every row and DTO; `Mapper` / `Converter` types.
