# Architecture test template

`A-01`…`A-14` as one `syn`-based test. It parses source files and never compiles the crates it checks, so it also runs
against a tree that does not build. `checker.rs` is the standard and is copied unchanged; `main.rs` holds the
project's configuration and one `#[test]` per rule. Why a parser instead of grep or cargo-deny: D-WS-06.

## Install

**Standard variant**: a workspace member `crates/arch-tests` with an empty `src/lib.rs` (Cargo needs a target) and
`tests/architecture/{main.rs, checker.rs}`. It depends on none of the crates it checks.

```toml
[package]
name = "arch-tests"
edition.workspace = true
version.workspace = true
publish.workspace = true

# Parses the other crates' sources; depends on none of them.
[dev-dependencies]
proc-macro2.workspace = true
syn.workspace = true

[lints]
workspace = true
```

with, in the workspace manifest:

```toml
[workspace.dependencies]
proc-macro2 = { version = "1", features = ["span-locations"] }   # line numbers in reports
syn = { version = "2", features = ["full", "visit"] }
```

Run it with `cargo test -p arch-tests`. Every crate under `crates/` must appear in `contexts`, `non_contexts` (the
binary, `arch-tests`) or be the kernel; an unlisted crate is reported, so a new context cannot slip past every check.

**Small variant**: `tests/architecture/{main.rs, checker.rs}` in the crate itself, `proc-macro2` and `syn` as
dev-dependencies, and the configuration below. Run it with `cargo test --test architecture`.

## What each check enforces

| check | rule | what it looks at |
|---|---|---|
| A-01 | R-01, R-29 | standard: `pub` items of each context crate's `lib.rs` (only `published`, `wire`, `migrate`, `*Deps`, `*Config`, `<Ctx>`); private layer modules only. Both variants: a context-shaped directory (`crates/<x>`, or `src/<x>/` holding a `domain`) missing from `contexts` / `non_contexts` |
| A-02 | R-03 | `crate::` / `self::` / `super::` paths resolved to a layer of the same context, against the layer matrix |
| A-03 | R-02, R-04 | another context named only through `published`, only from `infrastructure/acl/` or the context root; outside code (bootstrap) sees only context roots |
| A-04 | R-05, R-19, R-25 | domain: external crates against the allow-list; every layer: path prefixes against the deny-list; the kernel's manifest (standard) or files (small) against the allow-list |
| A-05 | R-06 | domain calls to clocks and random sources; any context file, the root's `wire` included, reading `env::var` |
| A-06 | R-07 | module names: banned sets in domain and application, fixed first-level sets in infrastructure and presentation |
| A-07 | R-08 | `mod.rs` files anywhere, kernel included |
| A-08 | R-11 | application impls with a public `execute` or `handle`: the type must end in `UseCase`; `handle` may not sit beside another public `self` method |
| A-09 | R-12 | `*AppService` named outside application; `*Repository` named in presentation |
| A-10 | R-13, R-24 | struct, enum, trait and type-alias names against the banned suffixes; `*Repository` trait methods named `get_*`, `insert`, `update`, `load`, `store`, `fetch`, `query` |
| A-11 | R-14 | infrastructure `impl <context trait> for X`: `X` starts with a tech prefix, or ends with `Acl` under `acl/` |
| A-12 | R-15 | domain structs outside `events` with non-private fields; inherent `set_*` methods in domain |
| A-13 | R-16 | a domain struct field `id: Option<…>` |
| A-14 | R-17 | structs in a domain `events` module without `#[must_use]` |

Items under `#[cfg(test)]` or `#[cfg(feature = "test-utils")]` are skipped, so fakes and tests may use anything.
Repeated identical findings in one file are reported once.

**Limits.** Macro arguments are checked only when they parse as comma-separated expressions (`format!`, `vec!`,
`assert_eq!`); `tracing::info!(at = %Utc::now())` is opaque. Names are checked syntactically: an aggregate exposing
state through a macro-generated setter passes A-12. `#[path]` attributes are not followed. A tuple struct's
`pub` field passes A-12 (an invariant-free newtype may expose it; one with an invariant is R-18 review). A `*Service`
that should be an agent noun is review. The `review`-signal rules stay review.

## Small-variant configuration

The checker is the same; `main.rs` differs only in `config()`:

```rust
fn config() -> Config {
    Config {
        variant: Variant::Small,
        root: env!("CARGO_MANIFEST_DIR").into(),
        contexts: vec!["billing", "catalog"],
        kernel: "kernel",
        domain_allowed: vec![
            "kernel",
            "serde",
            "thiserror",
            "chrono",
            "uuid",
            "async_trait",
            "tracing",
            "rust_decimal",
        ],
        denied: vec![
            (Layer::Domain, "crate::kernel::http"),
            (Layer::Application, "crate::kernel::http"),
            (Layer::Application, "sqlx"),
            (Layer::Application, "axum"),
            (Layer::Application, "reqwest"),
            (Layer::Application, "clickhouse"),
            (Layer::Application, "redis"),
            (Layer::Application, "anyhow"),
            (Layer::Application, "tokio::fs"),
            (Layer::Application, "tokio::io"),
            (Layer::Application, "tokio::net"),
            (Layer::Application, "tokio::process"),
            (Layer::Infrastructure, "anyhow"),
            (Layer::Presentation, "sqlx"),
            (Layer::Presentation, "reqwest"),
            (Layer::Presentation, "clickhouse"),
            (Layer::Presentation, "redis"),
            (Layer::Presentation, "anyhow"),
        ],
        tech_prefixes: vec!["Pg", "Ch", "Redis", "InMemory", "Fs", "S3", "Cached"],
        non_contexts: vec![],
    }
}
```

For a single-context crate (layers directly under `src/`), leave `contexts` empty.

## tests/architecture/main.rs (standard variant)

```rust
//! rust-ddd architecture tests. `checker.rs` is the standard; this file is the project's configuration.

mod checker;

use std::sync::OnceLock;

use checker::{Config, Layer, Variant, Violation};

fn config() -> Config {
    Config {
        variant: Variant::Standard,
        root: concat!(env!("CARGO_MANIFEST_DIR"), "/../..").into(),
        contexts: vec!["billing", "catalog"],
        kernel: "kernel",
        domain_allowed: vec![
            "kernel",
            "serde",
            "thiserror",
            "chrono",
            "uuid",
            "async_trait",
            "tracing",
            "rust_decimal",
        ],
        denied: vec![
            (Layer::Domain, "kernel::http"),
            (Layer::Application, "kernel::http"),
            (Layer::Application, "sqlx"),
            (Layer::Application, "axum"),
            (Layer::Application, "reqwest"),
            (Layer::Application, "clickhouse"),
            (Layer::Application, "redis"),
            (Layer::Application, "anyhow"),
            (Layer::Application, "tokio::fs"),
            (Layer::Application, "tokio::io"),
            (Layer::Application, "tokio::net"),
            (Layer::Application, "tokio::process"),
            (Layer::Infrastructure, "anyhow"),
            (Layer::Presentation, "sqlx"),
            (Layer::Presentation, "reqwest"),
            (Layer::Presentation, "clickhouse"),
            (Layer::Presentation, "redis"),
            (Layer::Presentation, "anyhow"),
        ],
        tech_prefixes: vec!["Pg", "Ch", "Redis", "InMemory", "Fs", "S3", "Cached"],
        non_contexts: vec!["pay", "arch-tests"],
    }
}

fn violations() -> &'static [Violation] {
    static FOUND: OnceLock<Vec<Violation>> = OnceLock::new();
    FOUND.get_or_init(|| checker::check(&config()))
}

fn assert_clean(rule: &str) {
    let found: Vec<String> = violations()
        .iter()
        .filter(|v| v.rule == rule)
        .map(ToString::to_string)
        .collect();
    assert!(found.is_empty(), "{rule}:\n{}", found.join("\n"));
}

#[test]
fn a01_context_crate_root_exposes_published_and_wiring_only() {
    assert_clean("A-01");
}

#[test]
fn a02_layers_point_inward() {
    assert_clean("A-02");
}

#[test]
fn a03_contexts_meet_only_through_published_and_acl() {
    assert_clean("A-03");
}

#[test]
fn a04_dependency_allow_and_deny_lists() {
    assert_clean("A-04");
}

#[test]
fn a05_domain_is_deterministic_and_nothing_reads_env() {
    assert_clean("A-05");
}

#[test]
fn a06_module_names() {
    assert_clean("A-06");
}

#[test]
fn a07_no_mod_rs() {
    assert_clean("A-07");
}

#[test]
fn a08_message_handlers_drive_their_own_use_case() {
    assert_clean("A-08");
}

#[test]
fn a09_app_services_and_repositories_stay_behind_use_cases() {
    assert_clean("A-09");
}

#[test]
fn a10_banned_type_name_suffixes() {
    assert_clean("A-10");
}

#[test]
fn a11_adapters_carry_a_tech_prefix_or_acl_suffix() {
    assert_clean("A-11");
}

#[test]
fn a12_domain_state_changes_through_behavior_only() {
    assert_clean("A-12");
}

#[test]
fn a13_aggregate_ids_are_never_optional() {
    assert_clean("A-13");
}

#[test]
fn a14_domain_events_are_must_use() {
    assert_clean("A-14");
}
```

## tests/architecture/checker.rs

```rust
//! rust-ddd architecture checker (A-01 … A-14). Parses sources with `syn`; never compiles what it checks.
//! Copy this file unchanged; project-specific values belong in `main.rs`.

use std::collections::BTreeSet;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use syn::punctuated::Punctuated;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Attribute, Fields, ImplItem, Item, Meta, Type, UseTree, Visibility};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Variant {
    /// One crate per bounded context under `crates/<context>`, plus a `kernel` crate.
    Standard,
    /// One crate; contexts are modules under `src/<context>` (or layers sit directly under `src/`).
    Small,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Layer {
    Domain,
    Application,
    Infrastructure,
    Presentation,
}

impl Layer {
    fn parse(segment: &str) -> Option<Self> {
        match segment {
            "domain" => Some(Self::Domain),
            "application" => Some(Self::Application),
            "infrastructure" => Some(Self::Infrastructure),
            "presentation" => Some(Self::Presentation),
            _ => None,
        }
    }

    /// A-02: the layers this layer may not reference.
    fn forbidden(self) -> &'static [Layer] {
        match self {
            Self::Domain => &[Self::Application, Self::Infrastructure, Self::Presentation],
            Self::Application => &[Self::Infrastructure, Self::Presentation],
            Self::Infrastructure => &[Self::Presentation],
            Self::Presentation => &[Self::Infrastructure],
        }
    }
}

pub(crate) struct Config {
    pub(crate) variant: Variant,
    /// Workspace root (standard) or crate root (small).
    pub(crate) root: PathBuf,
    /// Bounded contexts. Small variant with layers directly under `src/`: leave empty.
    pub(crate) contexts: Vec<&'static str>,
    /// Kernel crate (standard) or module (small).
    pub(crate) kernel: &'static str,
    /// External crates domain code may use (A-04). `std`, `core`, `alloc` are implied.
    pub(crate) domain_allowed: Vec<&'static str>,
    /// Path prefixes a layer may not use (A-04), e.g. `(Layer::Application, "tokio::fs")`.
    pub(crate) denied: Vec<(Layer, &'static str)>,
    /// Adapter name prefixes (A-11), e.g. `Pg`, `Redis`, `InMemory`.
    pub(crate) tech_prefixes: Vec<&'static str>,
    /// Standard variant: crates under `crates/` that are not contexts (the binary, `arch-tests`).
    /// The kernel is implied.
    pub(crate) non_contexts: Vec<&'static str>,
}

#[derive(Debug, Clone)]
pub(crate) struct Violation {
    pub(crate) rule: &'static str,
    pub(crate) file: String,
    pub(crate) line: usize,
    pub(crate) message: String,
}

impl fmt::Display for Violation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}: {}", self.file, self.line, self.message)
    }
}

// ---- the standard's fixed vocabulary -------------------------------------------------------------

const DOMAIN_BANNED_MODULES: &[&str] = &[
    "model",
    "models",
    "entity",
    "entities",
    "service",
    "services",
    "repository",
    "repositories",
    "port",
    "ports",
    "adapter",
    "adapters",
    "policies",
    "rules",
    "factories",
    "vo",
    "vos",
    "value_objects",
    "enums",
    "types",
    "shared",
    "common",
    "util",
    "utils",
    "helpers",
];
const APPLICATION_BANNED_MODULES: &[&str] = &[
    "common",
    "core",
    "util",
    "utils",
    "helpers",
    "port",
    "ports",
    "use_cases",
    "usecases",
    "dto",
    "dtos",
    "service",
    "services",
];
const INFRASTRUCTURE_MODULES: &[&str] = &[
    "repository",
    "cache",
    "lock",
    "mq",
    "event",
    "scheduling",
    "acl",
    "storage",
];
const PRESENTATION_MODULES: &[&str] = &["web", "rpc", "ws"];
const BANNED_SUFFIXES: &[&str] = &[
    "Impl",
    "Adapter",
    "Port",
    "Mapper",
    "Converter",
    "Dto",
    "Po",
    "Dao",
    "Entity",
    "Vo",
    "TransactionalWriter",
    "DomainService",
    "UnitOfWork",
];
const BANNED_INNER_SUFFIXES: &[&str] = &["Manager", "Helper", "Util", "Utils"];
const BANNED_REPOSITORY_VERBS: &[&str] =
    &["get", "insert", "update", "load", "store", "fetch", "query"];
const NONDETERMINISTIC_CALLS: &[&[&str]] = &[
    &["Utc", "now"],
    &["Local", "now"],
    &["SystemTime", "now"],
    &["Instant", "now"],
    &["Uuid", "new_v4"],
    &["Uuid", "now_v6"],
    &["Uuid", "now_v7"],
    &["thread_rng"],
    &["rand", "random"],
    &["rand", "rng"],
];
const ENV_CALLS: &[&[&str]] = &[&["env", "var"], &["env", "var_os"], &["env", "vars"]];

// ---- discovery -----------------------------------------------------------------------------------

struct Context {
    name: String,
    /// Crate identifier other contexts use to reach this one (standard variant).
    crate_ident: String,
}

struct SourceFile {
    display: String,
    /// Absolute module path inside its crate (`[]` for lib.rs / main.rs).
    module: Vec<String>,
    is_mod_rs: bool,
    context: Option<usize>,
    layer: Option<Layer>,
    externals: BTreeSet<String>,
    ast: syn::File,
}

struct Dep {
    name: String,
    optional: bool,
    line: usize,
}

/// `[dependencies]` and `[target.*.dependencies]` keys, normalised to code identifiers.
fn manifest_deps(manifest: &Path) -> Vec<Dep> {
    let text =
        fs::read_to_string(manifest).unwrap_or_else(|e| panic!("{}: {e}", manifest.display()));
    let mut deps = Vec::new();
    let mut in_deps = false;
    for (index, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.starts_with('[') {
            let header = line.trim_start_matches('[').trim_end_matches(']').trim();
            if let Some(name) = header.strip_prefix("dependencies.") {
                deps.push(Dep {
                    name: name.replace('-', "_"),
                    optional: false,
                    line: index + 1,
                });
                in_deps = false;
            } else {
                in_deps = header == "dependencies" || header.ends_with(".dependencies");
            }
            continue;
        }
        if !in_deps || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let key = line
            .split(['=', '.'])
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"');
        if !key.is_empty() {
            deps.push(Dep {
                name: key.replace('-', "_"),
                optional: line.contains("optional = true"),
                line: index + 1,
            });
        }
    }
    deps
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

/// `domain/subscription/billing_period.rs` → `[domain, subscription, billing_period]`.
fn module_path(src: &Path, file: &Path) -> (Vec<String>, bool) {
    let rel = file.strip_prefix(src).expect("file under src");
    let mut segments: Vec<String> = rel
        .iter()
        .map(|s| s.to_string_lossy().trim_end_matches(".rs").to_owned())
        .collect();
    let is_mod_rs = segments.last().is_some_and(|s| s == "mod");
    if is_mod_rs || (segments.len() == 1 && (segments[0] == "lib" || segments[0] == "main")) {
        segments.pop();
    }
    (segments, is_mod_rs)
}

fn parse(path: &Path) -> syn::File {
    let source = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    syn::parse_file(&source).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

struct Workspace {
    contexts: Vec<Context>,
    files: Vec<SourceFile>,
    /// Kernel files (small variant) or the kernel manifest's dependencies (standard).
    kernel_deps: Vec<Dep>,
    kernel_manifest: Option<PathBuf>,
    /// Directories that look like contexts but are not configured: they would escape every check.
    unlisted: Vec<String>,
}

impl Workspace {
    fn load(config: &Config) -> Self {
        let display = |p: &Path| {
            p.strip_prefix(&config.root)
                .unwrap_or(p)
                .display()
                .to_string()
        };
        let mut contexts = Vec::new();
        let mut files = Vec::new();
        match config.variant {
            Variant::Standard => {
                for (index, name) in config.contexts.iter().enumerate() {
                    let crate_dir = config.root.join("crates").join(name);
                    let externals: BTreeSet<String> = manifest_deps(&crate_dir.join("Cargo.toml"))
                        .into_iter()
                        .map(|d| d.name)
                        .collect();
                    let src = crate_dir.join("src");
                    let mut paths = Vec::new();
                    rust_files(&src, &mut paths);
                    for path in paths {
                        let (module, is_mod_rs) = module_path(&src, &path);
                        let layer = module.first().and_then(|s| Layer::parse(s));
                        files.push(SourceFile {
                            display: display(&path),
                            ast: parse(&path),
                            module,
                            is_mod_rs,
                            context: Some(index),
                            layer,
                            externals: externals.clone(),
                        });
                    }
                    contexts.push(Context {
                        name: name.to_string(),
                        crate_ident: name.replace('-', "_"),
                    });
                }
                let mut unlisted = Vec::new();
                if let Ok(entries) = fs::read_dir(config.root.join("crates")) {
                    for entry in entries.flatten().filter(|e| e.path().is_dir()) {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        let known = config.contexts.contains(&name.as_str())
                            || config.non_contexts.contains(&name.as_str())
                            || name == config.kernel;
                        if !known {
                            unlisted.push(format!("crates/{name}"));
                        }
                    }
                }
                unlisted.sort();
                let kernel_manifest = config
                    .root
                    .join("crates")
                    .join(config.kernel)
                    .join("Cargo.toml");
                let kernel_deps = manifest_deps(&kernel_manifest);
                let mut paths = Vec::new();
                rust_files(
                    &config.root.join("crates").join(config.kernel).join("src"),
                    &mut paths,
                );
                for path in paths {
                    // Kernel files only take part in A-07 (no mod.rs).
                    let is_mod_rs = path.file_name().is_some_and(|n| n == "mod.rs");
                    if is_mod_rs {
                        files.push(SourceFile {
                            display: display(&path),
                            ast: parse(&path),
                            module: Vec::new(),
                            is_mod_rs,
                            context: None,
                            layer: None,
                            externals: BTreeSet::new(),
                        });
                    }
                }
                Self {
                    contexts,
                    files,
                    kernel_deps,
                    kernel_manifest: Some(kernel_manifest),
                    unlisted,
                }
            }
            Variant::Small => {
                let externals: BTreeSet<String> = manifest_deps(&config.root.join("Cargo.toml"))
                    .into_iter()
                    .map(|d| d.name)
                    .collect();
                if config.contexts.is_empty() {
                    contexts.push(Context {
                        name: String::new(),
                        crate_ident: String::new(),
                    });
                } else {
                    for name in &config.contexts {
                        contexts.push(Context {
                            name: name.to_string(),
                            crate_ident: String::new(),
                        });
                    }
                }
                let src = config.root.join("src");
                let mut paths = Vec::new();
                rust_files(&src, &mut paths);
                for path in paths {
                    let (module, is_mod_rs) = module_path(&src, &path);
                    let (context, layer) = locate_small(config, &module);
                    files.push(SourceFile {
                        display: display(&path),
                        ast: parse(&path),
                        module,
                        is_mod_rs,
                        context,
                        layer,
                        externals: externals.clone(),
                    });
                }
                let mut unlisted = Vec::new();
                if let Ok(entries) = fs::read_dir(&src) {
                    for entry in entries.flatten().filter(|e| e.path().is_dir()) {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        let has_layers = entry.path().join("domain").exists()
                            || entry.path().join("domain.rs").exists();
                        if has_layers && !config.contexts.contains(&name.as_str()) {
                            unlisted.push(format!("src/{name}"));
                        }
                    }
                }
                unlisted.sort();
                Self {
                    contexts,
                    files,
                    kernel_deps: Vec::new(),
                    kernel_manifest: None,
                    unlisted,
                }
            }
        }
    }
}

/// Context and layer of a module path inside the single crate of the small variant.
fn locate_small(config: &Config, module: &[String]) -> (Option<usize>, Option<Layer>) {
    if config.contexts.is_empty() {
        let layer = module.first().and_then(|s| Layer::parse(s));
        return (layer.map(|_| 0), layer);
    }
    match module
        .first()
        .and_then(|first| config.contexts.iter().position(|c| c == first))
    {
        Some(index) => (Some(index), module.get(1).and_then(|s| Layer::parse(s))),
        None => (None, None),
    }
}

// ---- facts collected from one file ---------------------------------------------------------------

#[derive(Debug, Clone)]
enum Target {
    /// Absolute module path inside the same crate (without `crate`).
    Local(Vec<String>),
    /// Path whose first segment is an external crate.
    External(Vec<String>),
    /// Anything else (std, prelude, names already in scope).
    Other,
}

struct Ref {
    segments: Vec<String>,
    target: Target,
    line: usize,
}

struct StructFact {
    name: String,
    line: usize,
    module: Vec<String>,
    non_private_fields: Vec<String>,
    option_id: bool,
    must_use: bool,
}

struct ImplFact {
    self_name: String,
    trait_name: Option<String>,
    /// Public methods taking `self`.
    pub_fns: Vec<String>,
    fns: Vec<(String, usize)>,
    line: usize,
}

#[derive(Default)]
struct Facts {
    refs: Vec<Ref>,
    structs: Vec<StructFact>,
    impls: Vec<ImplFact>,
    /// (kind, name, line) of structs, enums, traits and type aliases.
    names: Vec<(&'static str, String, usize)>,
    traits: Vec<String>,
    /// (trait, method, line) of every trait method.
    trait_methods: Vec<(String, String, usize)>,
    inline_modules: Vec<(Vec<String>, usize)>,
}

fn line_of<T: Spanned>(node: &T) -> usize {
    node.span().start().line
}

fn is_test_only(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| match &attr.meta {
        Meta::List(list) if attr.path().is_ident("cfg") => list.tokens.to_string().contains("test"),
        _ => false,
    })
}

fn item_attrs(item: &Item) -> &[Attribute] {
    match item {
        Item::Const(i) => &i.attrs,
        Item::Enum(i) => &i.attrs,
        Item::Fn(i) => &i.attrs,
        Item::Impl(i) => &i.attrs,
        Item::Mod(i) => &i.attrs,
        Item::Static(i) => &i.attrs,
        Item::Struct(i) => &i.attrs,
        Item::Trait(i) => &i.attrs,
        Item::Type(i) => &i.attrs,
        Item::Use(i) => &i.attrs,
        _ => &[],
    }
}

fn last_ident(ty: &Type) -> Option<String> {
    match ty {
        Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
        _ => None,
    }
}

fn flatten_use(tree: &UseTree, prefix: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    match tree {
        UseTree::Path(p) => {
            prefix.push(p.ident.to_string());
            flatten_use(&p.tree, prefix, out);
            prefix.pop();
        }
        UseTree::Name(n) => {
            let mut path = prefix.clone();
            if n.ident != "self" {
                path.push(n.ident.to_string());
            }
            out.push(path);
        }
        UseTree::Rename(r) => {
            let mut path = prefix.clone();
            path.push(r.ident.to_string());
            out.push(path);
        }
        UseTree::Glob(_) => out.push(prefix.clone()),
        UseTree::Group(g) => {
            for tree in &g.items {
                flatten_use(tree, prefix, out);
            }
        }
    }
}

struct Collector<'a> {
    module: Vec<String>,
    externals: &'a BTreeSet<String>,
    facts: Facts,
}

impl Collector<'_> {
    fn record(&mut self, segments: Vec<String>, leading_colon: bool, line: usize) {
        let first = segments.first().map(String::as_str).unwrap_or_default();
        let target = if leading_colon || self.externals.contains(first) {
            Target::External(segments.clone())
        } else if first == "crate" {
            Target::Local(segments[1..].to_vec())
        } else if first == "self" || first == "super" {
            let ups = segments.iter().take_while(|s| *s == "super").count();
            let mut base = self.module.clone();
            for _ in 0..ups {
                base.pop();
            }
            let skip = if first == "self" { 1 } else { ups };
            base.extend(segments[skip..].iter().cloned());
            Target::Local(base)
        } else {
            Target::Other
        };
        self.facts.refs.push(Ref {
            segments,
            target,
            line,
        });
    }

    fn record_path(&mut self, path: &syn::Path) {
        let segments = path.segments.iter().map(|s| s.ident.to_string()).collect();
        self.record(segments, path.leading_colon.is_some(), line_of(path));
    }
}

impl<'ast> Visit<'ast> for Collector<'_> {
    fn visit_item(&mut self, item: &'ast Item) {
        if !is_test_only(item_attrs(item)) {
            visit::visit_item(self, item);
        }
    }

    fn visit_item_mod(&mut self, item: &'ast syn::ItemMod) {
        if item.content.is_none() {
            return;
        }
        self.module.push(item.ident.to_string());
        self.facts
            .inline_modules
            .push((self.module.clone(), line_of(&item.ident)));
        visit::visit_item_mod(self, item);
        self.module.pop();
    }

    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        let mut paths = Vec::new();
        flatten_use(&item.tree, &mut Vec::new(), &mut paths);
        for path in paths {
            self.record(path, item.leading_colon.is_some(), line_of(item));
        }
    }

    fn visit_path(&mut self, path: &'ast syn::Path) {
        self.record_path(path);
        visit::visit_path(self, path);
    }

    /// Best effort: macro arguments that parse as comma-separated expressions (`format!`, `vec!`,
    /// `assert_eq!`, …) are visited like code; anything else is opaque.
    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        self.record_path(&mac.path);
        let parser = Punctuated::<syn::Expr, syn::Token![,]>::parse_terminated;
        if let Ok(args) = mac.parse_body_with(parser) {
            for arg in &args {
                Visit::visit_expr(self, arg);
            }
        }
    }

    fn visit_attribute(&mut self, attr: &'ast Attribute) {
        self.record_path(attr.path());
        if attr.path().is_ident("derive") {
            let mut derived = Vec::new();
            let _ = attr.parse_nested_meta(|meta| {
                derived.push(meta.path.clone());
                Ok(())
            });
            for path in &derived {
                self.record_path(path);
            }
        }
    }

    fn visit_item_struct(&mut self, item: &'ast syn::ItemStruct) {
        let name = item.ident.to_string();
        self.facts
            .names
            .push(("struct", name.clone(), line_of(&item.ident)));
        let (mut non_private_fields, mut option_id) = (Vec::new(), false);
        if let Fields::Named(fields) = &item.fields {
            for field in &fields.named {
                let field_name = field
                    .ident
                    .as_ref()
                    .map(ToString::to_string)
                    .unwrap_or_default();
                if !matches!(field.vis, Visibility::Inherited) {
                    non_private_fields.push(field_name.clone());
                }
                if field_name == "id" && last_ident(&field.ty).as_deref() == Some("Option") {
                    option_id = true;
                }
            }
        }
        self.facts.structs.push(StructFact {
            name,
            line: line_of(&item.ident),
            module: self.module.clone(),
            non_private_fields,
            option_id,
            must_use: item.attrs.iter().any(|a| a.path().is_ident("must_use")),
        });
        visit::visit_item_struct(self, item);
    }

    fn visit_item_enum(&mut self, item: &'ast syn::ItemEnum) {
        self.facts
            .names
            .push(("enum", item.ident.to_string(), line_of(&item.ident)));
        visit::visit_item_enum(self, item);
    }

    fn visit_item_trait(&mut self, item: &'ast syn::ItemTrait) {
        self.facts
            .names
            .push(("trait", item.ident.to_string(), line_of(&item.ident)));
        self.facts.traits.push(item.ident.to_string());
        for trait_item in &item.items {
            if let syn::TraitItem::Fn(f) = trait_item {
                self.facts.trait_methods.push((
                    item.ident.to_string(),
                    f.sig.ident.to_string(),
                    line_of(&f.sig.ident),
                ));
            }
        }
        visit::visit_item_trait(self, item);
    }

    fn visit_item_type(&mut self, item: &'ast syn::ItemType) {
        self.facts
            .names
            .push(("type", item.ident.to_string(), line_of(&item.ident)));
        visit::visit_item_type(self, item);
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        let mut fact = ImplFact {
            self_name: last_ident(&item.self_ty).unwrap_or_default(),
            trait_name: item
                .trait_
                .as_ref()
                .and_then(|(_, path, _)| path.segments.last())
                .map(|s| s.ident.to_string()),
            pub_fns: Vec::new(),
            fns: Vec::new(),
            line: line_of(&item.self_ty),
        };
        for impl_item in &item.items {
            if let ImplItem::Fn(f) = impl_item {
                if is_test_only(&f.attrs) {
                    continue;
                }
                let name = f.sig.ident.to_string();
                // Constructors and other associated functions are not entry points.
                if !matches!(f.vis, Visibility::Inherited) && f.sig.receiver().is_some() {
                    fact.pub_fns.push(name.clone());
                }
                fact.fns.push((name, line_of(&f.sig.ident)));
            }
        }
        self.facts.impls.push(fact);
        visit::visit_item_impl(self, item);
    }
}

fn collect(file: &SourceFile) -> Facts {
    let mut collector = Collector {
        module: file.module.clone(),
        externals: &file.externals,
        facts: Facts::default(),
    };
    collector.visit_file(&file.ast);
    collector.facts
}

// ---- rules ---------------------------------------------------------------------------------------

fn ends_with_segments(segments: &[String], pattern: &[&str]) -> bool {
    segments.len() >= pattern.len()
        && segments[segments.len() - pattern.len()..]
            .iter()
            .zip(pattern)
            .all(|(a, b)| a == b)
}

fn starts_with_prefix(joined: &str, prefix: &str) -> bool {
    joined == prefix || joined.starts_with(&format!("{prefix}::"))
}

fn camel(name: &str) -> String {
    name.split(['_', '-'])
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect()
}

struct Checker<'a> {
    config: &'a Config,
    ws: &'a Workspace,
    out: Vec<Violation>,
}

impl Checker<'_> {
    fn flag(&mut self, rule: &'static str, file: &str, line: usize, message: String) {
        self.out.push(Violation {
            rule,
            file: file.to_owned(),
            line,
            message,
        });
    }

    /// Context and layer a `Target::Local` path points into, seen from `file`'s crate.
    fn locate(&self, file: &SourceFile, path: &[String]) -> (Option<usize>, Option<Layer>) {
        match self.config.variant {
            Variant::Standard => (file.context, path.first().and_then(|s| Layer::parse(s))),
            Variant::Small => locate_small(self.config, path),
        }
    }

    fn check_file(&mut self, file: &SourceFile) {
        let facts = collect(file);
        let display = file.display.clone();
        if file.is_mod_rs {
            self.flag(
                "A-07",
                &display,
                1,
                "`mod.rs` file: use `<name>.rs` beside a `<name>/` directory".into(),
            );
        }
        if self.config.variant == Variant::Standard
            && file.module.is_empty()
            && file.context.is_some()
        {
            self.check_crate_root(file);
        }
        if self.config.variant == Variant::Small
            && file.module.first().is_some_and(|m| m == self.config.kernel)
        {
            self.check_small_kernel(file, &facts);
        }
        self.check_cross_context(file, &facts);
        if file.context.is_some() {
            self.check_env(file, &facts);
        }
        let Some(layer) = file.layer else { return };
        self.check_layer_refs(file, layer, &facts);
        self.check_modules(file, layer, &facts);
        self.check_names(file, layer, &facts);
        if layer == Layer::Domain {
            self.check_domain_shapes(file, &facts);
        }
    }

    /// A-01: a context crate's root exposes `published`, `wire`, `migrate` and wiring types only.
    /// (`check` also reports context-shaped directories missing from the configuration.)
    fn check_crate_root(&mut self, file: &SourceFile) {
        let context = &self.ws.contexts[file.context.expect("context file")];
        let own_type = camel(&context.name);
        let display = file.display.clone();
        for item in &file.ast.items {
            let public = |vis: &Visibility| matches!(vis, Visibility::Public(_));
            let problem = match item {
                Item::Mod(m) if public(&m.vis) => Some(format!(
                    "`pub mod {}`: only `published` is re-exported",
                    m.ident
                )),
                Item::Mod(m) if Layer::parse(&m.ident.to_string()).is_none() => {
                    Some(format!("module `{}` sits outside the four layers", m.ident))
                }
                Item::Use(u) if public(&u.vis) => {
                    let mut paths = Vec::new();
                    flatten_use(&u.tree, &mut Vec::new(), &mut paths);
                    paths
                        .iter()
                        .find(|p| p.last().is_none_or(|last| last != "published"))
                        .map(|p| {
                            format!(
                                "`pub use {}`: only `application::published` is re-exported",
                                p.join("::")
                            )
                        })
                }
                Item::Fn(f)
                    if public(&f.vis) && f.sig.ident != "wire" && f.sig.ident != "migrate" =>
                {
                    Some(format!(
                        "`pub fn {}`: the root exposes only `wire` and `migrate`",
                        f.sig.ident
                    ))
                }
                Item::Struct(s) if public(&s.vis) => {
                    let name = s.ident.to_string();
                    (!(name.ends_with("Deps") || name.ends_with("Config") || name == own_type))
                        .then(|| format!("`pub struct {name}`: only `*Deps`, `*Config` and `{own_type}` belong here"))
                }
                Item::Enum(e) if public(&e.vis) => {
                    Some(format!("`pub enum {}` at the crate root", e.ident))
                }
                Item::Trait(t) if public(&t.vis) => {
                    Some(format!("`pub trait {}` at the crate root", t.ident))
                }
                Item::Type(t) if public(&t.vis) => {
                    Some(format!("`pub type {}` at the crate root", t.ident))
                }
                Item::Const(c) if public(&c.vis) => {
                    Some(format!("`pub const {}` at the crate root", c.ident))
                }
                Item::Static(s) if public(&s.vis) => {
                    Some(format!("`pub static {}` at the crate root", s.ident))
                }
                _ => None,
            };
            if let Some(message) = problem {
                self.flag("A-01", &display, line_of(item), message);
            }
        }
    }

    /// A-03: another context is reached only through its `published` door, from `infrastructure/acl/`
    /// (or from the context root, which wires the ACL).
    fn check_cross_context(&mut self, file: &SourceFile, facts: &Facts) {
        let in_acl = file.module.len() >= 2
            && file
                .module
                .iter()
                .skip_while(|s| *s != "infrastructure")
                .nth(1)
                .is_some_and(|s| s == "acl");
        let display = file.display.clone();
        for r in &facts.refs {
            match (&r.target, self.config.variant) {
                (Target::External(segments), Variant::Standard) => {
                    let Some(own) = file.context else { continue };
                    let reaches_other = self
                        .ws
                        .contexts
                        .iter()
                        .enumerate()
                        .any(|(i, c)| i != own && segments.first() == Some(&c.crate_ident));
                    if reaches_other && !(file.module.is_empty() || in_acl) {
                        self.flag(
                            "A-03",
                            &display,
                            r.line,
                            format!(
                                "`{}` reaches another context outside infrastructure/acl/",
                                segments.join("::")
                            ),
                        );
                    }
                }
                (Target::Local(path), Variant::Small) if !self.config.contexts.is_empty() => {
                    let (target_context, _) = locate_small(self.config, path);
                    let Some(target) = target_context else {
                        continue;
                    };
                    let through_published = path.get(1).is_some_and(|s| s == "published");
                    let allowed = match file.context {
                        Some(own) if own == target => true,
                        Some(own) => {
                            let at_root = file.module.len() == 1
                                && file.module[0] == self.config.contexts[own];
                            through_published && (at_root || in_acl)
                        }
                        None => path.get(1).is_none_or(|s| Layer::parse(s).is_none()),
                    };
                    if !allowed {
                        let message = if file.context.is_some() {
                            format!(
                                "`crate::{}` reaches into another context; use its `published` from infrastructure/acl/",
                                path.join("::")
                            )
                        } else {
                            format!(
                                "`crate::{}` reaches inside a context; outside code sees only its root (wire, deps, published)",
                                path.join("::")
                            )
                        };
                        self.flag("A-03", &display, r.line, message);
                    }
                }
                _ => {}
            }
        }
    }

    /// A-02 layer direction, A-04 dependency lists, A-05 nondeterminism and environment, A-09 reach.
    fn check_layer_refs(&mut self, file: &SourceFile, layer: Layer, facts: &Facts) {
        let display = file.display.clone();
        for r in &facts.refs {
            match &r.target {
                Target::Local(path) => {
                    let (target_context, target_layer) = self.locate(file, path);
                    if let Some(target_layer) = target_layer
                        && target_context == file.context
                        && layer.forbidden().contains(&target_layer)
                    {
                        self.flag(
                            "A-02",
                            &display,
                            r.line,
                            format!(
                                "{layer:?} references {target_layer:?}: `crate::{}`",
                                path.join("::")
                            ),
                        );
                    }
                    self.check_denied(
                        &display,
                        layer,
                        &format!("crate::{}", path.join("::")),
                        r.line,
                    );
                }
                Target::External(segments) => {
                    let krate = segments[0].as_str();
                    if layer == Layer::Domain && !self.config.domain_allowed.contains(&krate) {
                        self.flag(
                            "A-04",
                            &display,
                            r.line,
                            format!("`{krate}` is not on the domain allow-list"),
                        );
                    }
                    self.check_denied(&display, layer, &segments.join("::"), r.line);
                }
                Target::Other => {}
            }
            if layer == Layer::Domain
                && NONDETERMINISTIC_CALLS
                    .iter()
                    .any(|p| ends_with_segments(&r.segments, p))
            {
                self.flag(
                    "A-05",
                    &display,
                    r.line,
                    format!(
                        "domain reads time or randomness: `{}`; take it as a parameter",
                        r.segments.join("::")
                    ),
                );
            }
            let last = r.segments.last().map(String::as_str).unwrap_or_default();
            if layer != Layer::Application && last.ends_with("AppService") {
                self.flag(
                    "A-09",
                    &display,
                    r.line,
                    format!("`{last}` is reachable only from use cases"),
                );
            }
            if layer == Layer::Presentation && last.ends_with("Repository") {
                self.flag(
                    "A-09",
                    &display,
                    r.line,
                    format!("presentation reaches `{last}`; call a use case"),
                );
            }
        }
    }

    /// A-05: no context file reads the environment, the context root (`wire`) included.
    fn check_env(&mut self, file: &SourceFile, facts: &Facts) {
        let display = file.display.clone();
        for r in &facts.refs {
            if ENV_CALLS.iter().any(|p| ends_with_segments(&r.segments, p)) {
                self.flag("A-05", &display, r.line, format!("context code reads the environment: `{}`; configuration arrives through `wire`", r.segments.join("::")));
            }
        }
    }

    fn check_denied(&mut self, display: &str, layer: Layer, joined: &str, line: usize) {
        let hit = self
            .config
            .denied
            .iter()
            .find(|(l, prefix)| *l == layer && starts_with_prefix(joined, prefix))
            .map(|(_, p)| *p);
        if let Some(prefix) = hit {
            self.flag(
                "A-04",
                display,
                line,
                format!("{layer:?} may not use `{prefix}` (`{joined}`)"),
            );
        }
    }

    /// A-06: module names. Domain and application ban type-family names; infrastructure and
    /// presentation allow a fixed set at their first level.
    fn check_modules(&mut self, file: &SourceFile, layer: Layer, facts: &Facts) {
        let layer_index = file
            .module
            .iter()
            .position(|s| Layer::parse(s) == Some(layer))
            .expect("layer segment");
        let display = file.display.clone();
        let mut modules = vec![(file.module.clone(), 1)];
        modules.extend(facts.inline_modules.iter().cloned());
        for (module, line) in modules {
            let below = &module[layer_index + 1..];
            let problem = match layer {
                Layer::Domain => below
                    .iter()
                    .find(|s| DOMAIN_BANNED_MODULES.contains(&s.as_str()))
                    .map(|s| format!("domain module `{s}` names a type family, not a concept")),
                Layer::Application => below
                    .iter()
                    .find(|s| APPLICATION_BANNED_MODULES.contains(&s.as_str()))
                    .map(|s| format!("application module `{s}` is not a scenario or actor")),
                Layer::Infrastructure => below
                    .first()
                    .filter(|s| !INFRASTRUCTURE_MODULES.contains(&s.as_str()))
                    .map(|s| {
                        format!(
                            "infrastructure module `{s}` is not one of {INFRASTRUCTURE_MODULES:?}"
                        )
                    }),
                Layer::Presentation => below
                    .first()
                    .filter(|s| !PRESENTATION_MODULES.contains(&s.as_str()))
                    .map(|s| {
                        format!("presentation module `{s}` is not one of {PRESENTATION_MODULES:?}")
                    }),
            };
            if let Some(message) = problem {
                self.flag("A-06", &display, line, message);
            }
        }
    }

    /// A-08 use-case entry points, A-10 banned suffixes, A-11 adapter names.
    fn check_names(&mut self, file: &SourceFile, layer: Layer, facts: &Facts) {
        let display = file.display.clone();
        for (kind, name, line) in &facts.names {
            let inner = matches!(layer, Layer::Domain | Layer::Application);
            let banned = BANNED_SUFFIXES
                .iter()
                .chain(inner.then_some(BANNED_INNER_SUFFIXES).into_iter().flatten())
                .find(|suffix| name.ends_with(*suffix));
            if let Some(suffix) = banned {
                self.flag(
                    "A-10",
                    &display,
                    *line,
                    format!("{kind} `{name}`: the `{suffix}` suffix is banned"),
                );
            }
        }
        for (trait_name, method, line) in &facts.trait_methods {
            let banned = BANNED_REPOSITORY_VERBS
                .iter()
                .any(|verb| method == verb || method.starts_with(&format!("{verb}_")));
            if trait_name.ends_with("Repository") && banned {
                self.flag("A-10", &display, *line, format!("`{trait_name}::{method}`: repository methods are find_by_*, list_*, save, delete, exists"));
            }
        }
        for imp in &facts.impls {
            if imp.trait_name.is_some() || layer != Layer::Application {
                continue;
            }
            let entry = imp
                .pub_fns
                .iter()
                .find(|f| *f == "execute" || *f == "handle");
            if let Some(entry) = entry
                && !imp.self_name.ends_with("UseCase")
            {
                self.flag(
                    "A-08",
                    &display,
                    imp.line,
                    format!(
                        "`{}` has a use-case entry point `{entry}` but is not named `*UseCase`",
                        imp.self_name
                    ),
                );
            }
            if imp.pub_fns.iter().any(|f| f == "handle") && imp.pub_fns.len() > 1 {
                self.flag("A-08", &display, imp.line, format!("`{}` mixes `handle` with other public methods; a consumer drives its own use case", imp.self_name));
            }
        }
        if layer == Layer::Infrastructure {
            let context_traits = self.context_traits(file.context);
            let in_acl = file
                .module
                .iter()
                .skip_while(|s| *s != "infrastructure")
                .nth(1)
                .is_some_and(|s| s == "acl");
            for imp in &facts.impls {
                let Some(trait_name) = &imp.trait_name else {
                    continue;
                };
                if !context_traits.contains(trait_name) {
                    continue;
                }
                let ok = if in_acl {
                    imp.self_name.ends_with("Acl")
                } else {
                    self.config
                        .tech_prefixes
                        .iter()
                        .any(|p| imp.self_name.starts_with(p))
                };
                if !ok {
                    let expected = if in_acl {
                        "end with `Acl`".to_owned()
                    } else {
                        format!("start with one of {:?}", self.config.tech_prefixes)
                    };
                    self.flag(
                        "A-11",
                        &display,
                        imp.line,
                        format!(
                            "adapter `{}` for `{trait_name}` must {expected}",
                            imp.self_name
                        ),
                    );
                }
            }
        }
    }

    fn context_traits(&self, context: Option<usize>) -> BTreeSet<String> {
        self.ws
            .files
            .iter()
            .filter(|f| f.context == context && f.layer.is_some())
            .flat_map(|f| collect(f).traits)
            .collect()
    }

    /// A-12 encapsulation, A-13 optional ids, A-14 `#[must_use]` events.
    fn check_domain_shapes(&mut self, file: &SourceFile, facts: &Facts) {
        let display = file.display.clone();
        for s in &facts.structs {
            let in_events = s.module.iter().any(|m| m == "events");
            if in_events && !s.must_use {
                self.flag(
                    "A-14",
                    &display,
                    s.line,
                    format!("event `{}` lacks `#[must_use]`", s.name),
                );
            }
            if !in_events && !s.non_private_fields.is_empty() {
                self.flag(
                    "A-12",
                    &display,
                    s.line,
                    format!(
                        "`{}` exposes fields {:?}; expose getters and behavior methods",
                        s.name, s.non_private_fields
                    ),
                );
            }
            if s.option_id {
                self.flag(
                    "A-13",
                    &display,
                    s.line,
                    format!(
                        "`{}::id` is optional; an aggregate has its id from construction",
                        s.name
                    ),
                );
            }
        }
        for imp in &facts.impls {
            for (name, line) in &imp.fns {
                if imp.trait_name.is_none() && name.starts_with("set_") {
                    self.flag(
                        "A-12",
                        &display,
                        *line,
                        format!(
                            "`{}::{name}` is a setter; name the business action",
                            imp.self_name
                        ),
                    );
                }
            }
        }
    }

    /// A-04 for the kernel: it follows the domain allow-list (its `http` module excepted).
    fn check_small_kernel(&mut self, file: &SourceFile, facts: &Facts) {
        if file.module.get(1).is_some_and(|m| m == "http") {
            return;
        }
        let display = file.display.clone();
        for r in &facts.refs {
            if let Target::External(segments) = &r.target
                && !self.config.domain_allowed.contains(&segments[0].as_str())
            {
                self.flag(
                    "A-04",
                    &display,
                    r.line,
                    format!(
                        "kernel uses `{}`, which is not on the domain allow-list",
                        segments[0]
                    ),
                );
            }
        }
    }

    fn check_kernel_manifest(&mut self) {
        let Some(manifest) = &self.ws.kernel_manifest else {
            return;
        };
        let display = manifest
            .strip_prefix(&self.config.root)
            .unwrap_or(manifest)
            .display()
            .to_string();
        for dep in &self.ws.kernel_deps {
            if !dep.optional && !self.config.domain_allowed.contains(&dep.name.as_str()) {
                self.flag(
                    "A-04",
                    &display,
                    dep.line,
                    format!(
                        "kernel depends on `{}`, which is not on the domain allow-list",
                        dep.name
                    ),
                );
            }
        }
    }
}

/// Runs every rule. Each test in `main.rs` filters the result by rule id.
pub(crate) fn check(config: &Config) -> Vec<Violation> {
    let ws = Workspace::load(config);
    let mut checker = Checker {
        config,
        ws: &ws,
        out: Vec::new(),
    };
    for file in &ws.files {
        checker.check_file(file);
    }
    checker.check_kernel_manifest();
    for path in &ws.unlisted {
        checker.flag("A-01", path, 1, format!("`{path}` looks like a context but is not configured: add it to `contexts` or `non_contexts`"));
    }
    let mut seen = BTreeSet::new();
    let mut out: Vec<Violation> = checker
        .out
        .into_iter()
        .filter(|v| seen.insert((v.rule, v.file.clone(), v.message.clone())))
        .collect();
    out.sort_by(|a, b| (a.rule, &a.file, a.line).cmp(&(b.rule, &b.file, b.line)));
    out
}
```
