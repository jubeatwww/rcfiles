# Kernel template

The kernel crate of the standard variant, verbatim from the sample workspace (it compiles under
`clippy -D warnings` and backs the end-to-end tests). Copy it into `crates/kernel/`. What it is for and what may go in
it: `kernel-and-wiring.md` (D-WS-03).

**The one per-project choice** is the id representation. The template uses an `i64` snowflake
(`SnowflakeIdGenerator`, Postgres `BIGINT`). For UUIDs, change `Id::raw` to a `Uuid`, swap the serde impls to
`Uuid`'s, and replace the generator with one returning `Uuid::now_v7()`; `uuid` is on the domain allow-list.

**Small variant.** Put the files under `src/kernel.rs` + `src/kernel/`, write `crate::kernel::` for `crate::`, make
every `pub` a `pub(crate)`, drop the `http` feature gate (the architecture test denies `crate::kernel::http` in
domain and application instead), and turn `#[cfg(feature = "test-utils")]` into `#[cfg(test)]`. Unused kernel items
then trip `dead_code`; allow it on that item with a reason.

## Cargo.toml

```toml
[package]
name = "kernel"
edition.workspace = true
version.workspace = true
publish.workspace = true

[features]
http = ["dep:axum"]
test-utils = []

[dependencies]
chrono.workspace = true
serde.workspace = true
axum = { workspace = true, optional = true, features = ["macros"] }

[lints]
workspace = true
```

## src/lib.rs

```rust
//! Technical vocabulary shared by every bounded context: identity, time, error codes.
//! No business concept lives here; a concept two contexts share crosses through `published`.

mod clock;
mod error_code;
#[cfg(feature = "http")]
pub mod http;
mod id;
mod timestamp;

pub use clock::{Clock, SystemClock};
pub use error_code::{ErrorCode, ErrorKind};
pub use id::{Id, IdGenerator, SnowflakeIdGenerator};
pub use timestamp::Timestamp;

#[cfg(feature = "test-utils")]
pub use clock::fakes::FakeClock;
#[cfg(feature = "test-utils")]
pub use id::fakes::FakeIdGenerator;
```

## src/id.rs

```rust
use std::cmp::Ordering;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::marker::PhantomData;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Identity of an aggregate `E`: `type SubscriptionId = Id<Subscription>;`.
///
/// The phantom parameter makes a `SubscriptionId` unusable where an `InvoiceId` is expected, at zero
/// runtime cost. `fn() -> E` keeps `Id<E>` `Send + Sync + Copy` whatever `E` is.
pub struct Id<E: ?Sized> {
    raw: i64,
    kind: PhantomData<fn() -> E>,
}

impl<E: ?Sized> Id<E> {
    pub const fn from_raw(raw: i64) -> Self {
        Self {
            raw,
            kind: PhantomData,
        }
    }

    pub const fn raw(self) -> i64 {
        self.raw
    }
}

// Hand-written: a derive would demand `E: Clone`, `E: PartialEq`, … of the aggregate itself.
impl<E: ?Sized> Clone for Id<E> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<E: ?Sized> Copy for Id<E> {}
impl<E: ?Sized> PartialEq for Id<E> {
    fn eq(&self, other: &Self) -> bool {
        self.raw == other.raw
    }
}
impl<E: ?Sized> Eq for Id<E> {}
impl<E: ?Sized> PartialOrd for Id<E> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl<E: ?Sized> Ord for Id<E> {
    fn cmp(&self, other: &Self) -> Ordering {
        self.raw.cmp(&other.raw)
    }
}
impl<E: ?Sized> Hash for Id<E> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.raw.hash(state);
    }
}
impl<E: ?Sized> fmt::Debug for Id<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Id({})", self.raw)
    }
}
impl<E: ?Sized> fmt::Display for Id<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.raw)
    }
}
impl<E: ?Sized> Serialize for Id<E> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_i64(self.raw)
    }
}
impl<'de, E: ?Sized> Deserialize<'de> for Id<E> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        i64::deserialize(deserializer).map(Self::from_raw)
    }
}

/// Source of new identities. Application code calls `ids.next()`; domain code receives the id.
pub trait IdGenerator: Send + Sync {
    fn next_raw(&self) -> i64;
}

// A generic method would make the trait unusable as `dyn IdGenerator`; an inherent method on the
// trait object keeps `Arc<dyn IdGenerator>` and still returns a typed id.
impl dyn IdGenerator {
    pub fn next<E: ?Sized>(&self) -> Id<E> {
        Id::from_raw(self.next_raw())
    }
}

/// Time-ordered 63-bit ids: 41 bits of milliseconds since 2026-01-01, 10 bits of worker, 12 bits of sequence.
pub struct SnowflakeIdGenerator {
    worker: i64,
    state: Mutex<(i64, i64)>,
}

impl SnowflakeIdGenerator {
    const EPOCH_MS: i64 = 1_767_225_600_000;

    pub fn new(worker: u16) -> Self {
        Self {
            worker: i64::from(worker & 0x3FF),
            state: Mutex::new((0, 0)),
        }
    }

    fn now_ms() -> i64 {
        let since = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        i64::try_from(since.as_millis()).unwrap_or(i64::MAX) - Self::EPOCH_MS
    }
}

impl IdGenerator for SnowflakeIdGenerator {
    fn next_raw(&self) -> i64 {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (last_ms, last_seq) = *state;
        let mut now = Self::now_ms().max(last_ms);
        let seq = if now == last_ms {
            (last_seq + 1) & 0xFFF
        } else {
            0
        };
        if now == last_ms && seq == 0 {
            while now <= last_ms {
                now = Self::now_ms();
            }
        }
        *state = (now, seq);
        (now << 22) | (self.worker << 12) | seq
    }
}

#[cfg(feature = "test-utils")]
pub(crate) mod fakes {
    use std::sync::atomic::{AtomicI64, Ordering};

    use super::IdGenerator;

    /// Hands out 1, 2, 3, … so tests can predict ids.
    #[derive(Default)]
    pub struct FakeIdGenerator(AtomicI64);

    impl IdGenerator for FakeIdGenerator {
        fn next_raw(&self) -> i64 {
            self.0.fetch_add(1, Ordering::SeqCst) + 1
        }
    }
}
```

## src/timestamp.rs

```rust
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};

/// An instant in UTC. Domain code never reads the clock; it receives a `Timestamp`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp(DateTime<Utc>);

impl Timestamp {
    pub const fn from_utc(at: DateTime<Utc>) -> Self {
        Self(at)
    }

    pub const fn as_utc(self) -> DateTime<Utc> {
        self.0
    }

    pub fn plus_days(self, days: u32) -> Self {
        Self(self.0 + TimeDelta::days(i64::from(days)))
    }
}
```

## src/clock.rs

```rust
use chrono::Utc;

use crate::Timestamp;

/// Wall clock. Injected into application code as `Arc<dyn Clock>`; domain code receives `at: Timestamp`.
pub trait Clock: Send + Sync {
    fn now(&self) -> Timestamp;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Timestamp {
        Timestamp::from_utc(Utc::now())
    }
}

#[cfg(feature = "test-utils")]
pub(crate) mod fakes {
    use std::sync::Mutex;

    use super::Clock;
    use crate::Timestamp;

    /// A clock the test moves by hand.
    pub struct FakeClock(Mutex<Timestamp>);

    impl FakeClock {
        pub fn at(at: Timestamp) -> Self {
            Self(Mutex::new(at))
        }

        pub fn advance_days(&self, days: u32) {
            let mut now = self
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *now = now.plus_days(days);
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Timestamp {
            *self
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        }
    }
}
```

## src/error_code.rs

```rust
/// How a failure should be treated by whoever receives it. Presentation maps it to a status code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// The request itself is malformed.
    Invalid,
    NotFound,
    /// The request collides with current state (duplicate, stale version).
    Conflict,
    /// A business rule refused the request.
    Rejected,
    /// A dependency is down; retrying later may succeed.
    Unavailable,
    Internal,
}

/// Implemented by every use-case error and every domain error. The code is a stable, machine-readable
/// contract (`"subscription.not_active"`) written in the context's own language.
pub trait ErrorCode: std::error::Error {
    fn code(&self) -> &'static str;
    fn kind(&self) -> ErrorKind;
}
```

## src/http.rs

```rust
//! HTTP edge helpers, compiled only with the `http` feature. Presentation code only: the
//! architecture test denies `kernel::http` in domain and application.

use axum::Json;
use axum::extract::FromRequest;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::{ErrorCode, ErrorKind};

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

fn error_response(status: StatusCode, code: &'static str, message: String) -> Response {
    (status, Json(ErrorBody { code, message })).into_response()
}

/// Lets a handler return `Result<Json<Output>, HttpError<E>>` and use `?` on a use-case error.
/// A wrapper is required: the orphan rule forbids `impl<E: ErrorCode> IntoResponse for E`.
#[derive(Debug)]
pub struct HttpError<E>(pub E);

impl<E: ErrorCode> From<E> for HttpError<E> {
    fn from(error: E) -> Self {
        Self(error)
    }
}

impl<E: ErrorCode> IntoResponse for HttpError<E> {
    fn into_response(self) -> Response {
        let kind = self.0.kind();
        let status = match kind {
            ErrorKind::Invalid => StatusCode::BAD_REQUEST,
            ErrorKind::NotFound => StatusCode::NOT_FOUND,
            ErrorKind::Conflict => StatusCode::CONFLICT,
            ErrorKind::Rejected => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorKind::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            ErrorKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match kind {
            ErrorKind::Internal | ErrorKind::Unavailable => {
                "the service could not complete the request".to_owned()
            }
            _ => self.0.to_string(),
        };
        error_response(status, self.0.code(), message)
    }
}

/// `axum::Json` with the same `{code, message}` envelope on rejection. Because `*Input` fields are value
/// objects deserialized through their smart constructors, a malformed field is rejected here.
#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(BodyRejection))]
pub struct JsonBody<T>(pub T);

pub struct BodyRejection(JsonRejection);

impl From<JsonRejection> for BodyRejection {
    fn from(rejection: JsonRejection) -> Self {
        Self(rejection)
    }
}

impl IntoResponse for BodyRejection {
    fn into_response(self) -> Response {
        error_response(
            StatusCode::BAD_REQUEST,
            "request.invalid",
            self.0.body_text(),
        )
    }
}
```
