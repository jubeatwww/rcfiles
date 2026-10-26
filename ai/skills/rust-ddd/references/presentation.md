# Presentation layer

Modules: `layers-and-modules.md`. DTO binding: D-PRE-01. Errors: D-PRE-02. This file owns the audience split, handler
anatomy and the HTTP error contract.

Presentation uses axum, the kernel's `http` module, application types and behavior-less domain ids, enums and value
objects. Denied (A-04): `sqlx`, `reqwest`, `clickhouse`, `anyhow`. A handler that runs SQL is the failure this layer
exists to prevent.

## web/ vs rpc/ vs ws/

| module | audience | binding |
|---|---|---|
| `web/` | end users, through the gateway | `JsonBody<*Input>` by default; a `*Request` when the wire shape differs or the Input carries a field a client must not set (`operator`) |
| `rpc/` | internal callers: another service, a back-office server that supplies `operator` | `JsonBody<*Input>` |
| `ws/` | WebSocket sessions | frames decoded into `*Input`s, one use case per frame type |

URL prefixes (`/v1`, `/ms`, `/manage`) are the project's choice.

An authenticated identity (the customer redeeming a reward) comes from an extractor defined in `presentation/`
(`CurrentCustomer`), never from the body: the handler binds a `*Request` without that field and builds the Input with
`RedeemRewardInput::from((request, customer))` or a `TryFrom`.

## Handler module anatomy

One module per (scenario, actor). Its state struct holds only that scenario's use cases, so "a handler reaches one
scenario's use cases and nothing else" is enforced by the type:

```rust
/// The use cases of one application scenario: the only things these handlers can reach.
#[derive(Clone)]
pub(crate) struct SubscriptionClientHandlers {
    pub(crate) start: Arc<StartSubscriptionUseCase>,
    pub(crate) renew: Arc<RenewSubscriptionUseCase>,
    pub(crate) query: Arc<SubscriptionClientQueryUseCase>,
}

pub(crate) fn routes(handlers: SubscriptionClientHandlers) -> Router {
    Router::new()
        .route("/subscriptions", post(start_subscription))
        .route("/subscriptions/{id}", get(find_subscription))
        .route("/subscriptions/{id}/renewal", post(renew_subscription))
        .with_state(handlers)
}

async fn start_subscription(
    State(handlers): State<SubscriptionClientHandlers>,
    JsonBody(input): JsonBody<StartSubscriptionInput>,
) -> Result<Json<SubscriptionOutput>, HttpError<StartSubscriptionError>> {
    Ok(Json(handlers.start.execute(input).await?))
}

async fn renew_subscription(
    State(handlers): State<SubscriptionClientHandlers>,
    Path(id): Path<SubscriptionId>,
) -> Result<Json<SubscriptionOutput>, HttpError<RenewSubscriptionError>> {
    Ok(Json(handlers.renew.execute(RenewSubscriptionInput { subscription_id: id }).await?))
}
```

Convert, call one use case, wrap. Nothing else:

1. Extract: `JsonBody<*Input>` (or `JsonBody<*Request>` + `TryFrom`), `Path<…Id>`, query params. When the Input
   combines a path id and a body, convert with `TryFrom<(WorkId, ConfirmWorkMetadataRequest)> for
   ConfirmWorkMetadataInput`. An `Err` is legal
   only inside `TryFrom<*Request> for *Input`, and that error implements `ErrorCode` like any other.
2. Call exactly one `*UseCase` method. Never a repository, an AppService or a domain service (A-09).
3. Return `Json<*Output>` (or a `*Response` when the Output is unsuitable for the wire).

The only domain types a handler names are behavior-less ids, enums and value objects riding on Inputs and paths.
A handler module whose scenario has a write flow and another scenario's reads is two modules, even when both serve
`/billing/**`: the scenario decides the module boundary, not the URL prefix.

## Errors and envelope (D-PRE-02)

`kernel::http` (the kernel's `http` feature, presentation only) provides the whole contract:

- `HttpError<E: ErrorCode>` wraps a use-case error so a handler can use `?`. Status comes from `ErrorKind`
  (`Invalid` 400, `NotFound` 404, `Conflict` 409, `Rejected` 422, `Unavailable` 503, `Internal` 500); the body is
  `{"code": "<error code>", "message": "…"}`. `Unavailable` and `Internal` hide their message.
- `JsonBody<T>` is `axum::Json` with the same envelope on rejection (`"request.invalid"`). Because Input fields are
  value objects deserialized through their constructors, a malformed field never reaches the use case.
- Success returns the bare Output; there is no success envelope.

A wrapper is required because the orphan rule forbids `impl<E: ErrorCode> IntoResponse for E` from any crate. The
alternative, one central `AppHttpError` with a `From` per use-case error, grows by one impl per use case and was
rejected.
