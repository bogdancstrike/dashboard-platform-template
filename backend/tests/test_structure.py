"""Size and shape guards: files stay small, and imports form a tree.

The backend refactor brought every service and API module under 200 lines;
this keeps it there. A file over the limit is either a justified permanent
exception (data tables) or listed in a *ratchet*: its current size is its
ceiling, it may only shrink, and it leaves the list once it is under the
limit. See docs/architecture/backend/structure.md.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
SOURCE_LIMIT = 200
TEST_LIMIT = 400

#: Over the limit by nature: data, not logic.
PERMANENT: dict[str, str] = {
    "src/core/feature_catalogue/catalogue.py": "the feature catalogue: one declarative table of 55 features, data not logic",
}

#: Still to be split (seed, models, a few core modules). Ceiling = today's size.
SOURCE_RATCHET: dict[str, int] = {
    "src/api/work/planning.py": 206,
}

TEST_RATCHET: dict[str, int] = {

}


def _lines(path: pathlib.Path) -> int:
    return len(path.read_text().splitlines())


def _oversized(root: str, limit: int) -> dict[str, int]:
    return {
        str(path.relative_to(BACKEND)): _lines(path)
        for path in (BACKEND / root).rglob("*.py")
        if _lines(path) > limit
    }


@pytest.mark.parametrize("root, limit, ratchet", [
    ("src", SOURCE_LIMIT, SOURCE_RATCHET),
    ("tests", TEST_LIMIT, TEST_RATCHET),
])
def test_no_file_grows_past_its_limit(root, limit, ratchet):
    found = _oversized(root, limit)
    for path, lines in found.items():
        if path in PERMANENT:
            continue
        assert path in ratchet, f"{path} has {lines} lines (limit {limit}): split it"
        assert lines <= ratchet[path], f"{path} grew to {lines} lines (ceiling {ratchet[path]})"
    stale = sorted(set(ratchet) - set(found))
    assert not stale, f"now under the limit, remove from the ratchet: {stale}"


def _module_of(path: pathlib.Path) -> str:
    parts = list(path.relative_to(BACKEND).with_suffix("").parts)
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def test_imports_form_a_tree_even_counting_function_level_imports():
    """No cycle between modules — an import inside a function included, since
    that is where a cycle used to hide."""
    files = {_module_of(p): p for p in (BACKEND / "src").rglob("*.py")}

    def resolve(name: str) -> str | None:
        while name and name not in files:
            name = name.rpartition(".")[0]
        return name or None

    edges: dict[str, set[str]] = {m: set() for m in files}
    for module, path in files.items():
        package = module if path.name == "__init__.py" else module.rpartition(".")[0]
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    base = ".".join(package.split(".")[: len(package.split(".")) - node.level + 1] + [base]).strip(".")
                targets = [resolve(f"{base}.{a.name}") or resolve(base) for a in node.names]
            elif isinstance(node, ast.Import):
                targets = [resolve(a.name) for a in node.names]
            else:
                continue
            edges[module].update(t for t in targets if t and t != module and t.startswith("src"))
    state: dict[str, int] = {}

    def visit(module: str, trail: list[str]) -> None:
        state[module] = 1
        for target in edges[module]:
            if state.get(target) == 1:
                cycle = trail[trail.index(target):] + [target] if target in trail else [module, target]
                raise AssertionError("import cycle: " + " -> ".join(cycle))
            if target not in state:
                visit(target, trail + [target])
        state[module] = 2

    for module in sorted(files):
        if module not in state:
            visit(module, [module])
