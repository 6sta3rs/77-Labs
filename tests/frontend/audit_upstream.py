"""Static route inventory. Never imports or executes upstream Python code."""
import argparse
import ast
import hashlib
import io
import json
import subprocess
import tarfile
import zipfile
from pathlib import Path


def routes(sources):
    result = []
    for name, source in sources:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        prefixes = {}
        for assignment in tree.body:
            if not isinstance(assignment, (ast.Assign, ast.AnnAssign)) or not isinstance(assignment.value, ast.Call):
                continue
            call = assignment.value
            function = call.func.id if isinstance(call.func, ast.Name) else call.func.attr if isinstance(call.func, ast.Attribute) else ''
            if function != 'APIRouter':
                continue
            prefix = next((item.value.value for item in call.keywords if item.arg == 'prefix' and isinstance(item.value, ast.Constant) and isinstance(item.value.value, str)), '')
            targets = assignment.targets if isinstance(assignment, ast.Assign) else [assignment.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    prefixes[target.id] = prefix
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                    continue
                method = decorator.func.attr
                if method not in {"get", "head", "options", "post", "put", "patch", "delete", "websocket", "api_route"}:
                    continue
                if not decorator.args or not isinstance(decorator.args[0], ast.Constant):
                    continue
                path = decorator.args[0].value
                if not isinstance(path, str):
                    continue
                owner = decorator.func.value.id if isinstance(decorator.func.value, ast.Name) else ''
                prefix = prefixes.get(owner, '')
                methods = [method.upper()]
                if method == 'api_route':
                    declared = next((item.value for item in decorator.keywords if item.arg == 'methods'), None)
                    if declared is None:
                        methods = ['GET']
                    elif isinstance(declared, (ast.List, ast.Tuple, ast.Set)) and all(isinstance(item, ast.Constant) and isinstance(item.value, str) for item in declared.elts):
                        methods = [item.value.upper() for item in declared.elts]
                    else:
                        # Keep unresolved decorators visible without inventing a method.
                        methods = ['DYNAMIC']
                for verb in methods:
                    result.append({"method": verb, "path": prefix + path, "routerPrefix": prefix, "source": name, "handler": node.name})
    return sorted(result, key=lambda route: (route["path"], route["method"], route["source"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    reference = args.reference.resolve()
    commit = subprocess.check_output(["git", "-C", str(reference), "rev-parse", "--verify", args.revision + '^{commit}'], text=True).strip()
    archive_bytes = subprocess.check_output(["git", "-C", str(reference), "archive", commit, "backend", "package.json"])
    with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as snapshot:
        upstream = routes((member.name, snapshot.extractfile(member).read().decode('utf-8-sig')) for member in snapshot.getmembers() if member.isfile() and member.name.endswith('.py'))
        version = json.load(snapshot.extractfile('package.json'))['version']
    with zipfile.ZipFile(root / "scripts/runtime/vendor/engine.zip") as archive:
        bundled = routes((name, archive.read(name).decode("utf-8-sig")) for name in archive.namelist() if name.startswith("backend/") and name.endswith(".py"))
    old_keys = {(route["method"], route["path"]) for route in bundled}
    new_keys = {(route['method'], route['path']) for route in upstream}
    report = {
        "upstream": "https://github.com/debpalash/VoiceStudio", "commit": commit,
        "bundledVersion": json.loads((root / 'scripts/runtime/vendor/engine-provenance.json').read_text(encoding='utf-8'))['version'], "upstreamVersion": version,
        "archiveSha256": hashlib.sha256((root / 'scripts/runtime/vendor/engine.zip').read_bytes()).hexdigest(),
        "limitations": "Static decorators and literal APIRouter prefixes/method lists only. Dynamic paths, add_route calls and include_router/mount prefixes are not resolved. Presence is not functional parity; request schemas, services, native bridges, models and UI require separate verification.",
        "upstreamRoutes": upstream, "bundledRoutes": bundled,
        "notInBundle": [route for route in upstream if (route["method"], route["path"]) not in old_keys],
        "onlyInBundle": [route for route in bundled if (route['method'], route['path']) not in new_keys],
    }
    output = args.output or root / ".tmp/qa/upstream-contracts.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{commit}: upstream={len(upstream)}, bundled={len(bundled)}, new signatures={len(report['notInBundle'])}")


if __name__ == "__main__":
    main()
