//! Smoke tests for the AST engine: parse TS / Rust / Python snippets and
//! verify the returned Tree has a non-empty root node.

use rookie_core::ast::AstEngine;
use std::path::PathBuf;

#[test]
fn parses_typescript_snippet() {
    let mut engine = AstEngine::new().expect("engine init");
    let code = "export const greet = (name: string) => `hello ${name}`;";
    let tree = engine
        .parse(&PathBuf::from("demo.ts"), code)
        .expect("parse ok")
        .expect("tree exists");
    let root = tree.root_node();
    assert!(root.child_count() > 0, "root should have children");
    assert_eq!(root.kind(), "program");
}

#[test]
fn parses_rust_snippet() {
    let mut engine = AstEngine::new().expect("engine init");
    let code = "fn main() { println!(\"hi\"); }";
    let tree = engine
        .parse(&PathBuf::from("demo.rs"), code)
        .expect("parse ok")
        .expect("tree exists");
    assert!(tree.root_node().child_count() > 0);
}

#[test]
fn parses_python_snippet() {
    let mut engine = AstEngine::new().expect("engine init");
    let code = "def add(a, b):\n    return a + b\n";
    let tree = engine
        .parse(&PathBuf::from("demo.py"), code)
        .expect("parse ok")
        .expect("tree exists");
    assert!(tree.root_node().child_count() > 0);
}

#[test]
fn unknown_extension_returns_none() {
    let mut engine = AstEngine::new().expect("engine init");
    let tree = engine
        .parse(&PathBuf::from("demo.xyz"), "whatever")
        .expect("parse ok");
    assert!(tree.is_none(), "unknown lang should yield None");
}
