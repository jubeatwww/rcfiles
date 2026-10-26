# Decisions — presentation layer

Format: see `workspace.md`.

## D-PRE-01 — bind the Input directly; one module per scenario and actor

**Context.** A request DTO per endpoint doubles types for no gain when the wire shape equals the Input. Because Input
fields are value objects that parse during deserialization (D-DOM-06), binding the Input is also where format
validation happens. axum has no controller type to group handlers.

**Decision.** Handlers bind `kernel::http::JsonBody<*Input>` by default. A `*Request` exists when the wire shape
differs or the Input carries a field the caller must not set (`operator` on `web/`); it converts with
`TryFrom<*Request> for *Input`, the only place a handler may produce an `Err`. A `*Response` exists only when the
Output is unsuitable for the wire. Handlers are grouped one module per (scenario, actor) with a state struct holding
only that scenario's use cases; each handler calls exactly one use case.

**Rejected.** A `*Request` per endpoint; one router module per URL prefix; handlers holding repositories.

## D-PRE-02 — one error contract

**Context.** The JVM standard's company error-code enum made codes a cross-service contract. In Rust, mapping each
use-case error to HTTP by hand grows a central error type by one `From` impl per use case.

**Decision.** Every use-case error implements `kernel::ErrorCode`. Handlers return
`Result<Json<*Output>, HttpError<E>>`; `HttpError` maps `ErrorKind` to a status and renders `{code, message}`,
hiding the message of `Unavailable` and `Internal`. `JsonBody` renders deserialization failures in the same envelope
(`"request.invalid"`). Success returns the bare Output.

**Rejected.** A central `AppHttpError` with a `From` per error; `impl IntoResponse` per use-case error (scattered
status decisions); a success envelope.

**Consequence.** The wrapper type exists only because the orphan rule forbids `impl<E: ErrorCode> IntoResponse for E`.
