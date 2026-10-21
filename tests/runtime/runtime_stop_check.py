"""Pure stop-safety regression seam: held metadata versus genuine work."""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

import asyncio
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from activity import Activity, runtime_stacks


class StopReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def held(self, path, method="GET", work_busy=lambda: False):
        started, finish = asyncio.Event(), asyncio.Event()
        async def app(scope, receive, send):
            started.set()
            await finish.wait()
        subject = Activity(app, "fixture-own", work_busy)
        task = asyncio.create_task(subject({"type": "http", "path": path, "method": method}, None, None))
        await started.wait()
        return subject, task, finish

    async def test_held_engine_catalog_read_does_not_block_manual_stop(self):
        subject, task, finish = await self.held("/engines")
        try:
            self.assertFalse(subject.snapshot()["busy"], "GET /engines is explicit metadata: a stalled catalogue must not prevent Stop")
        finally:
            finish.set()
            await task

    async def test_active_mutation_even_on_monitor_path_still_blocks_stop(self):
        subject, task, finish = await self.held("/engines", "POST")
        try:
            self.assertTrue(subject.snapshot()["busy"])
            self.assertEqual(subject.snapshot()["reason"], "http-request")
        finally:
            finish.set()
            await task

    async def test_monitor_never_hides_background_work_or_probe_failure(self):
        for work in [lambda: True, lambda: (_ for _ in ()).throw(RuntimeError("fixture unknown work"))]:
            subject, task, finish = await self.held("/engines", work_busy=work)
            try: self.assertTrue(subject.snapshot()["busy"])
            finally:
                finish.set()
                await task

    async def test_held_nonmonitor_read_stays_protected(self):
        subject, task, finish = await self.held("/audio/fixture.wav")
        try: self.assertTrue(subject.snapshot()["busy"])
        finally:
            finish.set()
            await task

    async def test_explicit_stack_diagnostic_requires_existing_owner_header(self):
        subject = Activity(None, "private-owner-secret", lambda: False)
        for query, token, expected, calls, method in [(b"threads=1", b"foreign", 403, 0, "GET"), (b"", b"private-owner-secret", 200, 0, "GET"), (b"threads=1", b"private-owner-secret", 200, 1, "GET"), (b"threads=1", b"private-owner-secret", 200, 0, "POST")]:
            messages = []
            async def send(message): messages.append(message)
            with patch("activity.runtime_stacks", return_value={"threads": [], "tasks": []}) as capture:
                await subject({"type":"http", "path":"/next/activity", "method":method, "query_string":query, "headers":[(b"x-voicestudio-next",token)]}, None, send)
                self.assertEqual(capture.call_count, calls)
            self.assertEqual(messages[0]["status"], expected)
            text = messages[1]["body"].decode()
            self.assertNotIn("private-owner-secret", text)
            self.assertNotIn("foreign", text)
            self.assertEqual("diagnostics" in json.loads(text), bool(calls))

    async def test_diagnostic_requests_use_matched_static_template_and_never_query_or_ids(self):
        started, finish = asyncio.Event(), asyncio.Event()
        async def app(scope, receive, send):
            scope["route"] = SimpleNamespace(path="/profiles/{voice_id}")
            started.set()
            await finish.wait()
        subject = Activity(app, "own", lambda: False)
        task = asyncio.create_task(subject({"type":"http", "method":"GET", "path":"/profiles/private-user-id", "query_string":b"token=hf_private-query", "headers":[(b"authorization",b"secret-header")]}, None, None))
        await started.wait()
        try:
            snapshot = subject.diagnostic_snapshot()
            self.assertEqual(snapshot["active_requests"], [{"method":"GET", "route":"/profiles/{voice_id}", "count":1}])
            text = json.dumps(snapshot)
            for secret in ["private-user-id", "hf_private-query", "secret-header", "query_string", "f_locals"]: self.assertNotIn(secret, text)
            self.assertNotIn("diagnostics", subject.snapshot())
        finally:
            finish.set()
            await task
        self.assertEqual(subject.diagnostic_snapshot()["active_requests"], [])

    async def test_stack_contexts_and_depth_are_bounded_without_locals_paths_or_names(self):
        frame = None
        for _ in range(100):
            frame = SimpleNamespace(f_code=SimpleNamespace(co_filename="C:/private-folder/trace_fixture.py", co_name="public_probe"), f_lineno=17, f_back=frame, f_locals={"provider_key":"hf_secret-value"})
        class FakeTask:
            def get_stack(self, limit): return [frame] * 100
            def __repr__(self): return "private-task-name"
        with patch("activity.sys._current_frames", return_value={number:frame for number in range(100)}), patch("activity.asyncio.all_tasks", return_value=[FakeTask() for _ in range(100)]):
            result = runtime_stacks()
        self.assertEqual(len(result["threads"]), 64)
        self.assertEqual(len(result["tasks"]), 64)
        self.assertTrue(all(len(stack) == 32 for stack in result["threads"] + result["tasks"]))
        text = json.dumps(result)
        for secret in ["private-folder", "hf_secret-value", "private-task-name", "provider_key"]: self.assertNotIn(secret, text)
        self.assertEqual(set(result["threads"][0][0]), {"file", "function", "line"})


if __name__ == "__main__": unittest.main()
