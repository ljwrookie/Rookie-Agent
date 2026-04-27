//! Smoke tests for SymbolEngine.outline: parse TS / Rust snippets and
//! assert the correct top-level symbols are extracted.
//!
//! NOTE: The current outline walker only inspects direct children of the
//! `program` node. Top-level `export function ...` is wrapped in an
//! `export_statement`, which is not yet recursed into. We cover the
//! non-export case here; extended traversal is tracked in P1.

use rookie_core::ast::AstEngine;
use rookie_core::symbol::SymbolEngine;
use std::path::PathBuf;

#[test]
fn extracts_typescript_function_and_class() {
    let mut engine = AstEngine::new().unwrap();
    let code = r#"
function alpha(x: number): number { return x + 1; }
class Beta { greet() { return "hi"; } }
"#;
    let path = PathBuf::from("demo.ts");
    let tree = engine.parse(&path, code).unwrap().unwrap();
    let sym = SymbolEngine::new();
    let outline = sym.outline(&path, &tree, code);

    let names: Vec<&str> = outline.iter().map(|o| o.name.as_str()).collect();
    assert!(names.contains(&"alpha"), "expected `alpha`, got {names:?}");
    assert!(names.contains(&"Beta"), "expected `Beta`, got {names:?}");
}

#[test]
fn extracts_rust_fn_and_struct() {
    let mut engine = AstEngine::new().unwrap();
    let code = r#"
fn compute(x: i32) -> i32 { x * 2 }
struct Widget { id: u32 }
"#;
    let path = PathBuf::from("demo.rs");
    let tree = engine.parse(&path, code).unwrap().unwrap();
    let sym = SymbolEngine::new();
    let outline = sym.outline(&path, &tree, code);

    let names: Vec<&str> = outline.iter().map(|o| o.name.as_str()).collect();
    assert!(names.contains(&"compute"), "expected `compute`, got {names:?}");
    assert!(names.contains(&"Widget"), "expected `Widget`, got {names:?}");
}

#[test]
fn empty_source_yields_no_outline() {
    let mut engine = AstEngine::new().unwrap();
    let path = PathBuf::from("empty.ts");
    let tree = engine.parse(&path, "").unwrap().unwrap();
    let sym = SymbolEngine::new();
    let outline = sym.outline(&path, &tree, "");
    assert!(outline.is_empty());
}
