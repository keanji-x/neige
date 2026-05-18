//! All MCP tools live in this module, one file per tool.
//!
//! ## Adding a tool
//!
//! 1. Create `mcp/tools/<your_tool>.rs` with:
//!    - `pub struct Args { ... }` — `#[derive(Deserialize, JsonSchema)]`
//!    - `pub async fn handle(ctx: ToolCtx, args: Args) -> Result<Value, String>`
//!    - `pub fn tool() -> Tool` returning `Tool::new(name, description, scope, handle)`
//! 2. Add `mod <your_tool>;` below.
//! 3. Add `<your_tool>::tool()` to the `all()` Vec.
//!
//! ## Scopes
//!
//! - `Scope::Global` — visible at both `/mcp` and `/mcp/{id}`. Doesn't depend
//!   on a URL session id; may take `session_id` as an arg if it operates on
//!   a specific session.
//! - `Scope::SelfScoped` — visible only at `/mcp/{id}`, operates on the URL
//!   session id (auto-filled, no `session_id` in args).

use super::registry::{Scope, Tool};

mod answer_question;
mod ask_question;
mod create_session;
mod delete_session;
mod get_info;
mod introduce;
mod list_sessions;
mod read_log;
mod resume_session;
mod send_message;
mod stop;
mod todo_read;
mod todo_write;

/// Master list of every registered tool. Routes filter this by scope.
///
/// Order is informational — the dispatch lookup is by name, and the
/// `tools/list` MCP method preserves whatever order we put here.
pub fn all() -> Vec<Tool> {
    vec![
        // Global — appear on both /mcp and /mcp/{id}
        list_sessions::tool(),
        create_session::tool(),
        delete_session::tool(),
        resume_session::tool(),
        send_message::tool(),
        todo_read::tool(),
        introduce::tool(),
        ask_question::tool(),
        // Self-scoped — only on /mcp/{id}
        get_info::tool(),
        stop::tool(),
        read_log::tool(),
        answer_question::tool(),
        todo_write::tool(),
    ]
}

/// A view of `all()` filtered by which route is calling.
pub struct ToolSet {
    pub tools: Vec<Tool>,
}

impl ToolSet {
    /// `/mcp` (no session id in URL) — Global only.
    pub fn for_global_route() -> Self {
        Self {
            tools: all().into_iter().filter(|t| t.scope == Scope::Global).collect(),
        }
    }

    /// `/mcp/{id}` — Global + SelfScoped, in `all()` declaration order.
    pub fn for_session_route() -> Self {
        Self { tools: all() }
    }

    pub fn find(&self, name: &str) -> Option<&Tool> {
        self.tools.iter().find(|t| t.descriptor.name == name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(set: &ToolSet) -> std::collections::HashSet<&'static str> {
        set.tools.iter().map(|t| t.descriptor.name).collect()
    }

    #[test]
    fn all_tool_names_are_unique() {
        // The dispatcher looks up by name, so a duplicate would silently
        // shadow another tool. Catch that at test time so the next person
        // adding a tool can't trip on it.
        let mut seen = std::collections::HashSet::new();
        for t in all() {
            assert!(
                seen.insert(t.descriptor.name),
                "duplicate tool name: {}",
                t.descriptor.name
            );
        }
    }

    #[test]
    fn global_route_only_exposes_global_tools() {
        let g = names(&ToolSet::for_global_route());
        // Spot-check both inclusion and exclusion. The ToolSet API is
        // the contract; the underlying `all()` ordering is not.
        assert!(g.contains("list_sessions"));
        assert!(g.contains("create_session"));
        assert!(g.contains("send_message"));
        for self_only in ["get_info", "stop", "read_log", "answer_question"] {
            assert!(!g.contains(self_only), "global route leaked: {self_only}");
        }
    }

    #[test]
    fn session_route_exposes_global_and_self_scoped() {
        let s = names(&ToolSet::for_session_route());
        for expected in [
            "list_sessions",
            "create_session",
            "delete_session",
            "resume_session",
            "send_message",
            "get_info",
            "stop",
            "read_log",
            "answer_question",
        ] {
            assert!(s.contains(expected), "session route missing: {expected}");
        }
    }

    #[test]
    fn new_tools_are_registered_with_expected_scopes() {
        // Lock the new tools' surface so renames or scope flips can't slip
        // in silently. These names are documented to orchestrators and
        // referenced by frontend code (todo dialog) eventually.
        let everything = all();
        let by_name: std::collections::HashMap<&str, Scope> = everything
            .iter()
            .map(|t| (t.descriptor.name, t.scope))
            .collect();
        // Self-scoped: only valid at /mcp/{id}, no session_id arg.
        assert_eq!(by_name.get("todo_write").copied(), Some(Scope::SelfScoped));
        // Global: visible everywhere, takes optional session_id arg with
        // URL-default-fallback.
        assert_eq!(by_name.get("todo_read").copied(), Some(Scope::Global));
        assert_eq!(by_name.get("introduce").copied(), Some(Scope::Global));
        assert_eq!(by_name.get("ask_question").copied(), Some(Scope::Global));
    }

    #[test]
    fn input_schemas_are_objects() {
        // schemars::schema_for!(unit-struct) returns "object" with no
        // properties — confirming this for every tool catches accidental
        // tuple-struct or enum Args that wouldn't deserialize from `{}`.
        for t in all() {
            let kind = t.descriptor.input_schema.get("type");
            // schemars wraps schemas in a $schema-prefixed object whose
            // root type lives at the same level. Either it's directly
            // "object" or the schema has properties — both are fine.
            let ok = kind.and_then(|v| v.as_str()) == Some("object")
                || t.descriptor.input_schema.get("properties").is_some()
                || t.descriptor.input_schema.get("$ref").is_some();
            assert!(
                ok,
                "tool {} has non-object input schema: {}",
                t.descriptor.name, t.descriptor.input_schema
            );
        }
    }
}
