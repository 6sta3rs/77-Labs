"""Deterministic safety tests without importing torch or opening a private DB."""
import asyncio
from contextlib import contextmanager
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from activity import Activity, install_longform_tracking, longform_physical_state, backend_work_busy


class ActivityTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_network_services_keep_alive_without_blocking_manual_stop(self):
        subject = Activity(SimpleNamespace(routes=[]), "qa", lambda: False)
        share = SimpleNamespace(get_state=lambda: SimpleNamespace(enabled=True))
        remote = SimpleNamespace(connected=lambda: False)
        with patch.dict(sys.modules, {"services.network_share": share, "remote_backend": remote}):
            self.assertTrue(subject.snapshot()["keep_alive"])
            self.assertFalse(subject.snapshot()["busy"])
            share.get_state = lambda: SimpleNamespace(enabled=False)
            self.assertFalse(subject.snapshot()["keep_alive"])
            remote.connected = lambda: True
            self.assertTrue(subject.snapshot()["keep_alive"])
            self.assertFalse(subject.snapshot()["busy"])

    async def test_metadata_polling_does_not_reset_idle_but_mutations_do(self):
        async def app(scope, receive, send):
            await send({"type":"http.response.body","body":b"{}"})
        async def send(message):
            pass
        subject = Activity(app, "qa", lambda: False)
        subject.last_use = 10
        with patch("activity.time.monotonic", return_value=100):
            for path in ("/engines", "/models", "/next/models/jobs", "/next/models/onboarding", "/next/integrations/settings", "/next/storage/state", "/api/settings/cuda-device", "/v1/models"):
                await subject({"type":"http","path":path,"method":"GET"}, None, send)
                self.assertEqual(subject.snapshot()["idle_seconds"], 90)
            await subject({"type":"http","path":"/next/models/storage","method":"PUT"}, None, send)
            self.assertEqual(subject.snapshot()["idle_seconds"], 0)

    async def test_real_mcp_mount_keeps_listener_alive_without_blocking_manual_stop(self):
        app = SimpleNamespace(routes=[])
        subject = Activity(app, "qa", lambda: False)
        self.assertFalse(subject.snapshot()["keep_alive"])
        app.routes.append(SimpleNamespace(path="/mcp"))
        snapshot = subject.snapshot()
        self.assertTrue(snapshot["keep_alive"])
        self.assertFalse(snapshot["busy"], "Manual Stop must remain allowed without real work")

    def backend(self, remote=False):
        self.rows = {}
        def create(job_id, *, type):
            self.rows[job_id] = {"id": job_id, "type": type, "status": "running"}
        jobs = SimpleNamespace(create=create, get=lambda job_id: self.rows.get(job_id),
                               mark_cancelled=lambda job_id: self.rows[job_id].update(status="cancelled"), append_event=lambda *args: None)
        async def spawn(*args, **kwargs):
            raise AssertionError("Unexpected process")
        ffmpeg = SimpleNamespace(_spawn_with_retry=spawn)
        gateway = SimpleNamespace(decide=lambda operation: SimpleNamespace(remote=remote))
        modules = {"services.ffmpeg_utils": ffmpeg, "core.job_store": jobs, "services.gpu_gateway": gateway,
                   "core": SimpleNamespace(job_store=jobs)}
        return modules, jobs, gateway, ffmpeg

    async def cancelled_longform(self, subject):
        async def receive():
            return {"type": "http.disconnect"}
        async def send(message):
            pass
        with self.assertRaises(asyncio.CancelledError):
            await subject({"type": "http", "path": "/audiobook", "method": "POST"}, receive, send)

    async def test_request_is_busy_until_stream_finishes(self):
        started, finish = asyncio.Event(), asyncio.Event()
        async def app(scope, receive, send):
            started.set()
            await finish.wait()
        subject = Activity(app, "owner", lambda: False)
        task = asyncio.create_task(subject({"type": "http", "path": "/generate", "method": "POST"}, None, None))
        await started.wait()
        self.assertTrue(subject.snapshot()["busy"])
        finish.set()
        await task
        self.assertFalse(subject.snapshot()["busy"])

    async def test_background_jobs_and_probe_errors_block_stop(self):
        subject = Activity(None, "owner", lambda: True)
        self.assertTrue(subject.snapshot()["busy"])
        def broken():
            raise RuntimeError("unknown job state")
        subject.work_busy = broken
        self.assertTrue(subject.snapshot()["busy"])

    async def test_monitor_does_not_refresh_idle_clock(self):
        async def app(*args):
            pass
        subject = Activity(app, "owner", lambda: False)
        subject.last_use = 100
        with patch("activity.time.monotonic", return_value=500):
            await subject({"type": "http", "path": "/sysinfo"}, None, None)
            self.assertEqual(subject.snapshot()["idle_seconds"], 400)
            await subject({"type": "http", "path": "/engines"}, None, None)
            self.assertEqual(subject.snapshot()["idle_seconds"], 400)
            await subject({"type": "http", "path": "/generate", "method": "POST"}, None, None)
            self.assertEqual(subject.snapshot()["idle_seconds"], 0)

    async def test_cancelled_mutation_cannot_be_mistaken_for_completion(self):
        async def app(*args):
            raise asyncio.CancelledError()
        subject = Activity(app, "owner", lambda: False)
        with self.assertRaises(asyncio.CancelledError):
            await subject({"type": "http", "path": "/generate", "method": "POST"}, None, None)
        self.assertEqual(subject.active, 0)
        self.assertTrue(subject.snapshot()["busy"])

    async def test_disconnected_post_remains_protected(self):
        async def receive():
            return {"type": "http.disconnect"}
        async def app(scope, receive, send):
            await receive()
        subject = Activity(app, "owner", lambda: False)
        await subject({"type": "http", "path": "/convert", "method": "POST"}, receive, None)
        self.assertTrue(subject.snapshot()["busy"])

    async def test_disconnect_after_complete_response_is_not_cancelled_work(self):
        async def receive():
            return {"type": "http.disconnect"}
        async def send(message):
            pass
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"finished"})
            await receive()
        subject = Activity(app, "owner", lambda: False)
        await subject({"type": "http", "path": "/generate", "method": "POST"}, receive, send)
        self.assertFalse(subject.snapshot()["busy"])

    async def test_probe_requires_process_token(self):
        subject = Activity(None, "owner", lambda: False)
        for token, expected in [(b"foreign", 403), (b"owner", 200)]:
            messages = []
            async def send(message):
                messages.append(message)
            await subject({"type": "http", "path": "/next/activity", "headers": [(b"x-voicestudio-next", token)]}, None, send)
            self.assertEqual(messages[0]["status"], expected)

    async def test_longform_waits_for_actual_gpu_drain_then_reconciles_only_its_job(self):
        modules, jobs, gateway, _ffmpeg = self.backend()
        physical = {"busy": True, "gpu_queued": 0, "gpu_running": 1}
        async def app(scope, receive, send):
            jobs.create("owned", type="audiobook")
            gateway.decide("audiobook")
            await send({"type": "http.response.body", "body": b'data: {"type":"started","job_id":"owned"}\n\n', "more_body": True})
            await receive()
            raise asyncio.CancelledError()
        subject = Activity(app, "owner", lambda: any(row["status"] == "running" for row in self.rows.values()), physical_state=lambda: physical)
        with patch.dict(sys.modules, modules):
            jobs.create("unrelated", type="audiobook")
            await self.cancelled_longform(subject)
            self.assertEqual(subject.snapshot()["reason"], "longform-draining")
            self.assertEqual(self.rows["owned"]["status"], "running")
            self.assertFalse(subject.uncertain_work)
            physical.update(busy=False, gpu_running=0)
            self.assertTrue(subject.snapshot()["busy"], "Other real jobs must still protect stop")
            self.assertEqual(self.rows["owned"]["status"], "cancelled")
            self.assertEqual(self.rows["unrelated"]["status"], "running")
            self.rows["unrelated"]["status"] = "done"
            self.assertFalse(subject.snapshot()["busy"])

    async def test_unknown_interrupted_mutation_stays_fail_closed_after_longform_recovery(self):
        modules, jobs, gateway, _ffmpeg = self.backend()
        async def app(scope, receive, send):
            if scope["path"] == "/audiobook":
                jobs.create("owned", type="audiobook"); gateway.decide("audiobook")
            raise asyncio.CancelledError()
        subject = Activity(app, "owner", lambda: False, physical_state=lambda: {"busy": False})
        with patch.dict(sys.modules, modules):
            with self.assertRaises(asyncio.CancelledError):
                await subject({"type": "http", "path": "/generate", "method": "POST"}, None, None)
            await self.cancelled_longform(subject)
            self.assertEqual(self.rows["owned"]["status"], "cancelled")
            self.assertEqual(subject.snapshot()["reason"], "interrupted-request")

    async def test_remote_or_uninstrumented_longform_cannot_be_cleared_by_local_idle(self):
        for remote, instrumented in ((True, True), (False, False)):
            modules, jobs, gateway, _ffmpeg = self.backend(remote=remote)
            async def app(scope, receive, send):
                jobs.create("owned", type="audiobook"); gateway.decide("audiobook")
                raise asyncio.CancelledError()
            subject = Activity(app, "owner", lambda: False, physical_state=lambda: {"busy": False}, install_tracking=(lambda: False) if not instrumented else None)
            with patch.dict(sys.modules, modules):
                await self.cancelled_longform(subject)
                self.assertTrue(subject.snapshot()["busy"])
                self.assertEqual(self.rows["owned"]["status"], "running")

    async def test_transient_authority_probe_failure_recovers_without_resetting_unknown_debt(self):
        modules, jobs, gateway, _ffmpeg = self.backend()
        failure = True
        def probe():
            if failure:
                raise RuntimeError("temporary store failure")
            return {"busy": False}
        async def app(scope, receive, send):
            jobs.create("owned", type="audiobook"); gateway.decide("audiobook")
            raise asyncio.CancelledError()
        subject = Activity(app, "owner", lambda: False, physical_state=probe)
        with patch.dict(sys.modules, modules):
            await self.cancelled_longform(subject)
            self.assertTrue(subject.snapshot()["busy"])
            failure = False
            self.assertFalse(subject.snapshot()["busy"])
            self.assertEqual(self.rows["owned"]["status"], "cancelled")

    async def test_cancel_during_process_spawn_retains_handle_until_real_wait_completes(self):
        modules, jobs, gateway, ffmpeg = self.backend()
        spawning, launch, exited = asyncio.Event(), asyncio.Event(), asyncio.Event()
        class Process:
            returncode = None
            killed = False
            def kill(self):
                self.killed = True
            async def wait(self):
                await exited.wait()
                self.returncode = -1
                return -1
        process = Process()
        async def spawn(*args, **kwargs):
            spawning.set(); await launch.wait(); return process
        ffmpeg._spawn_with_retry = spawn
        async def app(scope, receive, send):
            jobs.create("owned", type="audiobook"); gateway.decide("audiobook")
            await ffmpeg._spawn_with_retry(["controlled-fixture"])
        subject = Activity(app, "owner", lambda: False, physical_state=lambda: {"busy": False})
        with patch.dict(sys.modules, modules):
            task = asyncio.create_task(subject({"type": "http", "path": "/longform/render", "method": "POST"}, None, None))
            await spawning.wait(); task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(subject.snapshot()["busy"])
            launch.set()
            for _ in range(12):
                await asyncio.sleep(0)
            self.assertTrue(process.killed)
            self.assertTrue(subject.snapshot()["busy"], "kill is not completion; wait must finish")
            self.assertEqual(self.rows["owned"]["status"], "running")
            exited.set()
            for _ in range(12):
                await asyncio.sleep(0)
            self.assertFalse(subject.snapshot()["busy"])
            self.assertEqual(self.rows["owned"]["status"], "cancelled")

    async def test_pool_probe_requires_real_counters_and_model_load_locks(self):
        load_lock = threading.Lock()
        state = {"queued": 0, "running": 1}
        manager = SimpleNamespace(_gpu_pool_singleton=SimpleNamespace(stats=lambda: state), _model_load_thread_lock=load_lock, _model_lock=threading.Lock())
        with patch.dict(sys.modules, {"services": SimpleNamespace(model_manager=manager)}):
            self.assertTrue(longform_physical_state()["busy"])
            state["running"] = 0
            load_lock.acquire()
            self.assertTrue(longform_physical_state()["busy"])
            load_lock.release()
            self.assertFalse(longform_physical_state()["busy"])
            state.pop("running")
            with self.assertRaises(RuntimeError):
                longform_physical_state()

    def lock_probe_modules(self, load_lock):
        @contextmanager
        def database():
            yield SimpleNamespace(execute=lambda *args: SimpleNamespace(fetchone=lambda: None))
        manager = SimpleNamespace(_gpu_pool_singleton=None, _model_load_thread_lock=load_lock, _model_lock=threading.Lock())
        return {"services": SimpleNamespace(model_manager=manager),
                "core.tasks": SimpleNamespace(task_manager=SimpleNamespace(active_tasks={})), "core.db": SimpleNamespace(db_conn=database),
                "engine_installation": SimpleNamespace(busy=lambda: False), "model_management": SimpleNamespace(busy=lambda: False)}, manager

    async def test_lock_probes_handle_real_rlock_owned_by_current_and_foreign_thread(self):
        load_lock = threading.RLock()
        modules, _manager = self.lock_probe_modules(load_lock)
        acquired, release = threading.Event(), threading.Event()
        def holder():
            with load_lock:
                acquired.set(); release.wait(5)
        with patch.dict(sys.modules, modules):
            self.assertFalse(backend_work_busy())
            self.assertFalse(longform_physical_state()["busy"])
            self.assertFalse(load_lock._is_owned(), "Probe must not retain a lock")
            with load_lock:
                self.assertTrue(backend_work_busy())
                self.assertTrue(longform_physical_state()["model_loading"])
            worker = threading.Thread(target=holder)
            worker.start()
            try:
                self.assertTrue(acquired.wait(2), "Controlled worker never acquired its lock")
                self.assertTrue(backend_work_busy())
                self.assertTrue(longform_physical_state()["model_loading"])
            finally:
                release.set(); worker.join(2)
            self.assertFalse(worker.is_alive())
            self.assertFalse(backend_work_busy())
            self.assertFalse(longform_physical_state()["busy"])

    async def test_unknown_model_lock_contract_keeps_stop_fail_closed(self):
        modules, _manager = self.lock_probe_modules(object())
        with patch.dict(sys.modules, modules):
            with self.assertRaises(RuntimeError): longform_physical_state()
            subject = Activity(None, "owner", backend_work_busy)
            self.assertEqual(subject.snapshot()["reason"], "probe-error")
            self.assertTrue(subject.snapshot()["busy"])

    async def test_tracking_preserves_keyword_gateway_calls_outside_longform(self):
        modules, _jobs, gateway, _ffmpeg = self.backend()
        gateway.decide = lambda op, control_plane=None: SimpleNamespace(remote=False, operation=op, plane=control_plane)
        with patch.dict(sys.modules, modules):
            self.assertTrue(install_longform_tracking())
            result = gateway.decide(op="tts", control_plane="fixture")
            self.assertEqual(result.operation, "tts")
            self.assertEqual(result.plane, "fixture")

    async def test_completed_longform_job_is_never_reclassified_cancelled(self):
        modules, jobs, gateway, _ffmpeg = self.backend()
        async def receive():
            return {"type": "http.disconnect"}
        async def send(message):
            pass
        async def app(scope, receive, send):
            jobs.create("owned", type="audiobook"); gateway.decide("audiobook")
            self.rows["owned"]["status"] = "done"
            await send({"type": "http.response.body", "body": b'data: {"type":"done"}\n\n'})
            await receive()
        subject = Activity(app, "owner", lambda: False, physical_state=lambda: {"busy": False})
        with patch.dict(sys.modules, modules):
            await subject({"type": "http", "path": "/audiobook", "method": "POST"}, receive, send)
            self.assertFalse(subject.snapshot()["busy"])
            self.assertEqual(self.rows["owned"]["status"], "done")


    async def test_asgi_send_disconnect_has_the_same_authoritative_recovery(self):
        modules, jobs, gateway, _ffmpeg = self.backend()
        async def send(message):
            raise OSError("client disconnected during send")
        async def app(scope, receive, send):
            jobs.create("owned", type="audiobook"); gateway.decide("audiobook")
            await send({"type": "http.response.body", "body": b'data: {"type":"started","job_id":"owned"}\n\n', "more_body": True})
        subject = Activity(app, "owner", lambda: False, physical_state=lambda: {"busy": False})
        with patch.dict(sys.modules, modules):
            with self.assertRaises(OSError):
                await subject({"type": "http", "path": "/audiobook", "method": "POST"}, None, send)
            self.assertFalse(subject.snapshot()["busy"])
            self.assertEqual(self.rows["owned"]["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
