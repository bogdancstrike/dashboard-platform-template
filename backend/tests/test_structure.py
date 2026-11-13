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
    "src/core/feature_catalogue/catalogue.py": "the feature table (data)",
    "src/seed/catalog.py": "seeded reference data",
}

#: Still to be split (seed, models, a few core modules). Ceiling = today's size.
SOURCE_RATCHET: dict[str, int] = {
    "src/seed/runner.py": 2028,
    "src/seed/operations.py": 1313,
    "src/seed/personal.py": 723,
    "src/seed/__main__.py": 654,
    "src/seed/content.py": 619,
    "src/models/platform.py": 609,
    "src/seed/identity.py": 598,
    "src/seed/collab.py": 596,
    "src/seed/business.py": 552,
    "src/seed/planning.py": 531,
    "src/seed/decisions.py": 495,
    "src/seed/records_analytics.py": 477,
    "src/seed/knowledge.py": 369,
    "src/seed/exports.py": 321,
    "src/models/personal.py": 300,
    "src/models/business.py": 291,
    "src/core/cache.py": 279,
    "src/models/records_analytics.py": 259,
    "src/seed/blobs.py": 257,
    "src/models/identity.py": 253,
    "src/seed/imports.py": 240,
    "src/models/content.py": 234,
    "src/seed/workflows.py": 230,
    "src/seed/world.py": 223,
    "src/seed/support.py": 216,
    "src/core/logsink.py": 209,
}

TEST_RATCHET: dict[str, int] = {
    "tests/test_explorer.py": 1194,
    "tests/test_imports.py": 1097,
    "tests/test_exports.py": 1047,
    "tests/test_calendar.py": 770,
    "tests/test_seed.py": 737,
    "tests/test_feature_flags.py": 707,
    "tests/test_automation_graph.py": 695,
    "tests/test_jobs.py": 687,
    "tests/test_mail.py": 653,
    "tests/test_workflows.py": 642,
    "tests/test_security.py": 632,
    "tests/test_assistant.py": 623,
    "tests/test_kanban.py": 604,
    "tests/test_favorites.py": 588,
    "tests/test_dashboards.py": 581,
    "tests/test_logs.py": 577,
    "tests/test_organizations.py": 566,
    "tests/test_groups.py": 546,
    "tests/test_integrations.py": 525,
    "tests/test_api_clients.py": 500,
    "tests/test_query.py": 494,
    "tests/test_chat.py": 484,
    "tests/test_settings.py": 476,
    "tests/test_audit.py": 465,
    "tests/test_tags.py": 452,
    "tests/test_work_planning.py": 433,
    "tests/test_report_documents.py": 425,
    "tests/test_bulk.py": 420,
    "tests/test_docs.py": 418,
    "tests/test_roles.py": 414,
    "tests/test_seed_check.py": 407,
    "tests/undo_log.py": 401,
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
