"""Audit pinned runtime resources/import declarations without executing upstream."""
import argparse
import ast
import configparser
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

import bundle


class ModuleImports(ast.NodeVisitor):
    def __init__(self):
        self.imports = []
        self.optional = False

    def visit_Import(self, node):
        self.imports.extend((alias.name, [], 0, self.optional) for alias in node.names)

    def visit_ImportFrom(self, node):
        self.imports.append((node.module or "", [alias.name for alias in node.names], node.level, self.optional))

    def visit_FunctionDef(self, node):
        pass

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Try(self, node):
        previous = self.optional
        self.optional = True
        for child in node.body:
            self.visit(child)
        self.optional = previous
        for child in [*node.handlers, *node.orelse, *node.finalbody]:
            self.visit(child)


def audit(path):
    with zipfile.ZipFile(path) as archive:
        files = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    missing = bundle.REQUIRED_057_RESOURCES - files.keys()
    if missing:
        raise AssertionError("Missing runtime resources: " + ", ".join(sorted(missing)))
    trees = {name: ast.parse(data.decode("utf-8-sig"), filename=name, feature_version=(3, 11)) for name, data in files.items() if name.endswith(".py")}
    app_config = files["backend/core/app_config.py"].decode("utf-8")
    assert 'Path(__file__).resolve().parents[2] / "config" / "app.json"' in app_config, "Review changed app_config root contract"
    manifest = json.loads(files["config/app.json"])
    assert manifest["productName"] and manifest["appId"]
    ini = configparser.ConfigParser(); ini.read_string(files["alembic.ini"].decode("ascii"))
    assert ini.get("alembic", "script_location", raw=True) == "%(here)s/backend/migrations"
    assert "backend/migrations/env.py" in files
    migrations = sorted(name for name in files if name.startswith("backend/migrations/versions/") and name.endswith(".py"))
    assert all(any(PurePosixPath(name).name.startswith(prefix) for name in migrations) for prefix in ("0012_", "0013_", "0014_", "0015_"))
    json.loads(files["backend/config/model_licenses.json"])

    def source_for(module):
        parts = module.split(".")
        if parts[0] in {"core", "services", "api", "engines", "migrations"}:
            parts.insert(0, "backend")
        elif parts[0] not in {"backend", "omnivoice"}:
            return None, False
        stem = "/".join(parts)
        for candidate in (stem + ".py", stem + "/__init__.py"):
            if candidate in trees:
                return candidate, True
        return None, any(name.startswith(stem + "/") for name in files)

    reached, pending, unresolved, optional = set(), ["backend/main.py"], set(), set()
    while pending:
        name = pending.pop()
        if name in reached:
            continue
        reached.add(name)
        visitor = ModuleImports(); visitor.visit(trees[name])
        for module, names, level, guarded in visitor.imports:
            if level:
                package = name.removesuffix(".py").split("/")[:-1]
                module = ".".join([*package[:len(package) - level + 1], *([module] if module else [])])
            source, exists = source_for(module)
            if source:
                pending.append(source)
            elif not exists and module.split(".")[0] in {"backend", "omnivoice", "core", "services", "api", "engines", "migrations"}:
                (optional if guarded else unresolved).add(name + ": " + module)
            for child in names:
                source, _ = source_for(module + "." + child)
                if source:
                    pending.append(source)
    assert not unresolved, "Unresolved local module declarations: " + ", ".join(sorted(unresolved))
    return {"archive_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "files": len(files), "parsed_python_files": len(trees),
            "module_level_import_tree_files": len(reached), "unresolved_required_local_modules": sorted(unresolved), "guarded_optional_local_modules": sorted(optional),
            "required_resources": sorted(bundle.REQUIRED_057_RESOURCES), "migration_files": len(migrations),
            "public_extra_resources": [name for name in ("CHANGELOG.md", "docs/logo.png", "LICENSE", "LICENSE-NOTICE.md") if name in files],
            "limits": ["Static module-level imports only; function bodies, dynamic imports and optional native engines require runtime acceptance", "No upstream import, database writes, models or backend process"],
            "backend_started": False, "models_loaded": False, "passed": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.archive)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("archive_sha256", "files", "module_level_import_tree_files", "unresolved_required_local_modules", "passed")}))


if __name__ == "__main__":
    main()
