"""Static inventory contract: no imports or execution of audited sources."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('audit_upstream', Path(__file__).with_name('audit_upstream.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class RouteInventoryTests(unittest.TestCase):
    def test_prefixes_separate_same_local_paths(self):
        result = audit.routes([('a.py', 'router=APIRouter(prefix="/api/settings")\n@router.get("/status")\ndef status(): pass'), ('b.py', 'router=APIRouter(prefix="/models")\n@router.get("/status")\ndef status(): pass')])
        self.assertEqual({row['path'] for row in result}, {'/api/settings/status', '/models/status'})

    def test_multi_method_and_websocket(self):
        result = audit.routes([('a.py', 'router=APIRouter()\n@router.api_route("/media",methods=["GET","HEAD"])\ndef media(): pass\n@router.websocket("/ws")\nasync def ws(): pass')])
        self.assertEqual({(row['method'], row['path']) for row in result}, {('GET', '/media'), ('HEAD', '/media'), ('WEBSOCKET', '/ws')})

    def test_dynamic_paths_are_not_executed(self):
        result = audit.routes([('a.py', 'raise RuntimeError("must not execute")\n@router.get(make_path())\ndef dynamic(): pass\n@router.post("/safe")\ndef safe(): pass')])
        self.assertEqual([row['path'] for row in result], ['/safe'])


if __name__ == '__main__':
    unittest.main()
