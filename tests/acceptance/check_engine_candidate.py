"""Static ZIP compatibility report; never import upstream, start a server or load models."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import argparse
import ast
import hashlib
import json
from pathlib import Path
import tomllib
import zipfile

import launcher


def inspect(path):
    with zipfile.ZipFile(path) as archive:
        sources = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    trees = {name: ast.parse(content.decode("utf-8-sig"), filename=name, feature_version=(3, 11))
             for name, content in sources.items() if name.endswith(".py") and name.startswith(("backend/", "omnivoice/")) and "/tests/" not in name}
    routes, parameters, classes = [], {}, {}
    for name, tree in trees.items():
        constants = {node.targets[0].id: node.value.value for node in tree.body if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and isinstance(node.value, ast.Constant)}
        prefixes = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and getattr(node.value.func, "id", "") == "APIRouter":
                prefix = next((keyword.value.value for keyword in node.value.keywords if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant)), "")
                prefixes.update({target.id: prefix for target in node.targets if isinstance(target, ast.Name)})
            if isinstance(node, ast.ClassDef) and node.name in {"ProjectSaveRequest", "DubRequest", "LongformRenderRequest", "LongformSpan", "ExpressiveMixin", "DictationPrefsUpdate"}:
                classes[name + ":" + node.name] = {field.target.id: ast.unparse(field.annotation) for field in node.body if isinstance(field, ast.AnnAssign) and isinstance(field.target, ast.Name)}
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute) or decorator.func.attr not in {"get", "post", "put", "patch", "delete", "websocket"} or not decorator.args:
                    continue
                argument = decorator.args[0]
                route = argument.value if isinstance(argument, ast.Constant) else constants.get(argument.id) if isinstance(argument, ast.Name) else None
                if not isinstance(route, str):
                    continue
                full = prefixes.get(getattr(decorator.func.value, "id", ""), "") + route
                routes.append({"method": decorator.func.attr.upper(), "path": full, "source": name, "handler": node.name})
                if full in {"/generate", "/transcribe", "/longform/render", "/stories/encode"}:
                    parameters[full] = [item.arg for item in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]]
    lock = tomllib.loads(sources["uv.lock"].decode("utf-8-sig"))
    packages = {name: sorted({package["version"] for package in lock.get("package", []) if package.get("name") == name}) for name in
                ("torch", "torchaudio", "torchvision", "fastapi", "transformers", "huggingface-hub", "pydantic", "sherpa-onnx", "audioseal", "mcp")}
    return {"files": sources, "parsedPythonFiles": len(trees), "routes": routes, "parameters": parameters, "classes": classes, "packages": packages,
            "version": tomllib.loads(sources["pyproject.toml"].decode("utf-8-sig"))["project"]["version"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--prepare", action="store_true", help="Prepare source files beside candidate/engine.zip, without launching them")
    arguments = parser.parse_args()
    old, new = inspect(arguments.current), inspect(arguments.candidate)
    old_routes = {(row["method"], row["path"]) for row in old["routes"]}
    new_routes = {(row["method"], row["path"]) for row in new["routes"]}
    report = {"date": "2026-10-20", "currentVersion": old["version"], "candidateVersion": new["version"],
              "candidateSha256": hashlib.sha256(arguments.candidate.read_bytes()).hexdigest(), "parsedPythonFiles": new["parsedPythonFiles"], "pythonGrammar": "3.11",
              "routeInventoryLimit": "Static decorators and module constants with local APIRouter prefixes; dynamic mounts and runtime behavior are not established.",
              "currentRouteSignatures": len(old_routes), "candidateRouteSignatures": len(new_routes),
              "addedRoutes": [row for row in new["routes"] if (row["method"], row["path"]) not in old_routes],
              "removedRoutes": [row for row in old["routes"] if (row["method"], row["path"]) not in new_routes],
              "requestParameters": {path: {"current": old["parameters"].get(path), "candidate": new["parameters"].get(path)} for path in sorted(set(old["parameters"]) | set(new["parameters"]))},
              "changedRequestClasses": {name: {"current": old["classes"].get(name), "candidate": new["classes"].get(name)} for name in sorted(set(old["classes"]) | set(new["classes"])) if old["classes"].get(name) != new["classes"].get(name)},
              "dependencyVersions": {name: {"current": old["packages"][name], "candidate": new["packages"][name]} for name in new["packages"]},
              "newMigrations": sorted(name for name in new["files"] if name.startswith("backend/migrations/versions/") and name.endswith(".py") and name not in old["files"]),
              "files": {"added": len(new["files"].keys() - old["files"].keys()), "removed": len(old["files"].keys() - new["files"].keys()), "changed": sum(old["files"][name] != new["files"][name] for name in old["files"].keys() & new["files"].keys())},
              "backendStarted": False, "databaseMigrated": False, "modelsLoaded": False}
    if arguments.prepare:
        if arguments.candidate.name != "engine.zip":
            raise ValueError("Preparation requires the explicit candidate filename engine.zip")
        launcher.ROOT = arguments.candidate.resolve().parent
        launcher.PROJECT = launcher.ROOT / "engine"
        project = launcher.prepare_engine()
        manifest = json.loads((project / ".engine-ready.json").read_text(encoding="utf-8"))
        report["sourcePreparation"] = {"path": str(project), "adapterVersion": manifest["adapterVersion"], "preloadContract": manifest["preloadContract"], "filesVerified": len(manifest["fileSha256"]), "markerComplete": True}
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"candidateVersion": report["candidateVersion"], "pythonFilesParsed": report["parsedPythonFiles"], "routeSignatures": report["candidateRouteSignatures"], "backendStarted": False, "prepared": "sourcePreparation" in report}))


if __name__ == "__main__":
    main()
