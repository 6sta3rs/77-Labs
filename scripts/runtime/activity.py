"""Busy/idle evidence for the Rust supervisor; does not unload models itself."""
import asyncio
from contextvars import ContextVar
from dataclasses import dataclass, field
import functools
import json
import re
import sys
import time


MONITORS = {
    '/health',
    '/sysinfo',
    '/model/status',
    '/jobs',
    '/batch/jobs',
    '/next/activity',
    '/next/remote/state',
    '/profiles',
    '/engines',
    '/engines/tts',
    '/engines/asr',
    '/engines/llm',
    '/models',
    '/next/models/jobs',
    '/next/models/storage',
    '/next/models/onboarding',
    '/next/engine-runtimes/catalog',
    '/next/engine-runtimes/jobs',
    '/next/integrations/settings',
    '/api/settings/hf-token/state',
    '/next/storage/state',
    '/next/storage/report',
    '/next/storage/backups',
    '/next/preview-cache/state',
    '/next/settings/credentials',
    '/next/settings/proxy',
    '/next/settings/update-source',
    '/system/info',
    '/system/network/state',
    '/system/tailscale/status',
    '/system/logs',
    '/api/settings/llm-providers',
    '/api/settings/llm-skills',
    '/api/settings/dictation-refinement',
    '/api/settings/asr-openai-compat',
    '/api/settings/hf-mirror',
    '/api/settings/cuda-device',
    '/api/settings/compute-device',
    '/api/settings/performance-profile',
    '/api/settings/gpu-report',
    '/api/settings/perf/offload-after-generation',
    '/api/settings/perf/torch-compile-disabled',
    '/api/settings/analytics',
    '/api/settings/history-retention',
    '/api/settings/changelog',
    '/watermark/status',
    '/media-tools/status',
    '/stats/usage',
    '/v1/models',
    '/v1/audio/capabilities',
    '/openapi.json',
    '/pronunciation',
    '/pronunciation/export',
}
_LONGFORM = ContextVar("next_longform_request", default=None)


def persistent_listener_enabled():
    """Explicit LAN/remote connections keep the bridge reachable, not busy."""
    try:
        share = sys.modules.get("services.network_share")
        if share is not None and share.get_state().enabled:
            return True
        remote = sys.modules.get("remote_backend")
        return bool(remote is not None and remote.connected())
    except Exception:
        # An uncertain listener is not evidence that sleeping it is safe.
        return True


def _safe_frame(frame):
    code = frame.f_code
    return {"file": str(code.co_filename).replace("\\", "/").rsplit("/", 1)[-1][:160],
            "function": str(code.co_name)[:160], "line": max(0, int(frame.f_lineno))}


def runtime_stacks():
    """Explicit owned diagnostics: code locations only, never frame locals."""
    threads = []
    current = sys._current_frames()
    try:
        for frame in list(current.values())[:64]:
            stack = []
            for _ in range(32):
                if frame is None:
                    break
                stack.append(_safe_frame(frame))
                frame = frame.f_back
            threads.append(stack)
    finally:
        del current
    tasks = []
    try:
        for task in list(asyncio.all_tasks())[:64]:
            tasks.append([_safe_frame(frame) for frame in task.get_stack(limit=32)[:32]])
    except RuntimeError:
        pass  # A synchronous diagnostic caller has no event loop.
    return {"threads": threads, "tasks": tasks, "limits": {"contexts": 64, "frames": 32}}


@dataclass(eq=False)
class LongformRequest:
    path: str
    returned: bool = False
    interrupted: bool = False
    tracking_ready: bool = False
    local_decision: bool | None = None
    jobs: set = field(default_factory=set)
    processes: dict = field(default_factory=dict)
    launches: set = field(default_factory=set)
    cleanups: set = field(default_factory=set)
    reaping: set = field(default_factory=set)
    reaped: set = field(default_factory=set)
    error: bool = False
    frames: bytes = b""


def _trusted_longform(path):
    return path in {"/audiobook", "/longform/render"} or bool(re.fullmatch(r"/audiobook/resume/[A-Za-z0-9_-]{1,64}", path))


def _reap_process(record, process):
    """Retain the actual process handle until wait confirms its termination."""
    key = id(process)
    if key in record.reaping or key in record.reaped:
        return
    record.reaping.add(key)

    async def reap():
        try:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            await process.wait()
            record.reaped.add(key)
        except BaseException:
            # A missing completion proof must keep stop fail-closed.
            record.error = True

    task = asyncio.create_task(reap())
    record.cleanups.add(task)
    task.add_done_callback(record.cleanups.discard)


def install_longform_tracking():
    """Instrument the private in-memory backend; never edit bundled files.

    The allow-listed routes use the guarded GPU pool plus ffmpeg_utils.
    Shielding only the spawn handoff retains a process created during a
    disconnect; the request may cancel, but its real handle cannot be lost.
    All unrelated routes preserve their original implementations.
    """
    ffmpeg = sys.modules.get("services.ffmpeg_utils")
    jobs = sys.modules.get("core.job_store")
    gateway = sys.modules.get("services.gpu_gateway")
    if any(module is None for module in (ffmpeg, jobs, gateway)):
        return False
    if not all(callable(value) for value in (getattr(ffmpeg, "_spawn_with_retry", None), getattr(jobs, "create", None), getattr(gateway, "decide", None))):
        return False

    if not getattr(ffmpeg._spawn_with_retry, "_next_longform_tracking", False):
        original_spawn = ffmpeg._spawn_with_retry

        @functools.wraps(original_spawn)
        async def spawn(*args, **kwargs):
            record = _LONGFORM.get()
            if record is None:
                return await original_spawn(*args, **kwargs)
            task = asyncio.create_task(original_spawn(*args, **kwargs))
            record.launches.add(task)

            def launched(completed):
                record.launches.discard(completed)
                try:
                    process = completed.result()
                    record.processes[id(process)] = process
                    if record.interrupted:
                        _reap_process(record, process)
                except BaseException:
                    record.error = True

            task.add_done_callback(launched)
            return await asyncio.shield(task)

        spawn._next_longform_tracking = True
        ffmpeg._spawn_with_retry = spawn

    if not getattr(jobs.create, "_next_longform_tracking", False):
        original_create = jobs.create

        @functools.wraps(original_create)
        def create(job_id, *args, **kwargs):
            result = original_create(job_id, *args, **kwargs)
            record = _LONGFORM.get()
            if record is not None and kwargs.get("type") in {"audiobook", "story", "longform"}:
                record.jobs.add(str(job_id))
            return result

        create._next_longform_tracking = True
        jobs.create = create

    if not getattr(gateway.decide, "_next_longform_tracking", False):
        original_decide = gateway.decide

        @functools.wraps(original_decide)
        def decide(*args, **kwargs):
            result = original_decide(*args, **kwargs)
            operation = args[0] if args else kwargs.get("op")
            record = _LONGFORM.get()
            if record is not None and operation in {"audiobook", "longform"}:
                local = not result.remote
                record.local_decision = local if record.local_decision is None else record.local_decision and local
            return result

        decide._next_longform_tracking = True
        gateway.decide = decide
    return True


def _lock_busy(lock):
    """Observe Lock/asyncio.Lock and CPython 3.11 RLock without waiting.

    RLock gained locked() only in newer Python versions. A nonblocking acquire
    alone is insufficient: it succeeds reentrantly for the current owner, so
    check ownership first. Unknown contracts keep the supervisor fail-closed.
    """
    locked = getattr(lock, "locked", None)
    if callable(locked):
        value = locked()
        if type(value) is not bool:
            raise RuntimeError("Model lock does not expose authoritative state")
        return value
    owned = getattr(lock, "_is_owned", None)
    acquire, release = getattr(lock, "acquire", None), getattr(lock, "release", None)
    if not all(callable(value) for value in (owned, acquire, release)):
        raise RuntimeError("Unknown model lock contract")
    owner = owned()
    if owner is True:
        return True
    if owner is not False:
        raise RuntimeError("Model lock does not expose authoritative ownership")
    acquired = acquire(False)
    if acquired is True:
        try:
            return False
        finally:
            release()
    if acquired is False:
        return True
    raise RuntimeError("Model lock does not expose authoritative acquisition")


def longform_physical_state():
    """Authoritative counters, including workers in a retired/reset pool."""
    from services import model_manager
    pool = model_manager._gpu_pool_singleton
    stats = pool.stats() if pool is not None else {"queued": 0, "running": 0}
    if any(not isinstance(stats.get(key), int) or stats[key] < 0 for key in ("queued", "running")):
        raise RuntimeError("GPU pool does not provide authoritative occupancy")
    loading = _lock_busy(model_manager._model_load_thread_lock) or _lock_busy(model_manager._model_lock)
    return {"busy": bool(stats["queued"] or stats["running"] or loading), "gpu_queued": stats["queued"], "gpu_running": stats["running"], "model_loading": bool(loading)}


def reconcile_longform_jobs(job_ids):
    """Only the exact jobs owned by the disconnected, drained request."""
    from core import job_store
    for job_id in job_ids:
        row = job_store.get(job_id)
        if row is None or row.get("type") not in {"audiobook", "story", "longform"}:
            raise RuntimeError("Missing authoritative longform job identity")
        if row["status"] in {"pending", "running", "cancelling"}:
            job_store.mark_cancelled(job_id)
            job_store.append_event(job_id, json.dumps({"type": "stopped", "reason": "client_disconnected", "drained": True}))


class Activity:
    def __init__(self, app, token, work_busy, *, physical_state=None, reconcile=None, install_tracking=None):
        self.app, self.token, self.work_busy = app, token, work_busy
        self.active = 0
        self._requests = {}
        self.last_use = time.monotonic()
        # A disconnected mutation may leave CPU/executor work alive. Fail closed
        # until restart rather than infer completion from a closed HTTP stream.
        self.uncertain_work = False
        self.longform = set()
        self.physical_state = physical_state or longform_physical_state
        self.reconcile = reconcile or reconcile_longform_jobs
        self.install_tracking = install_tracking or install_longform_tracking
        self._reaper = None
        self.last_physical = None
        self.probe_failed = False

    def _refresh_longform(self):
        if not self.longform:
            return
        try:
            physical = self.physical_state()
            self.last_physical = physical
            self.probe_failed = False
            for record in tuple(self.longform):
                if not record.returned:
                    continue
                if record.interrupted:
                    for process in record.processes.values():
                        _reap_process(record, process)
                process_busy = bool(record.launches or record.cleanups) or any(
                    key not in record.reaped and process.returncode is None
                    for key, process in record.processes.items()
                )
                if physical["busy"] or process_busy or record.error:
                    continue
                if record.interrupted:
                    if not record.tracking_ready or record.local_decision is False:
                        # A changed/remote execution contract needs its own
                        # authoritative drain. Never infer it from local idle.
                        record.error = True
                        continue
                    self.reconcile(record.jobs)
                self.longform.discard(record)
                self.last_use = time.monotonic()
        except Exception:
            # Transient probe/SQLite failures retain debt, but can recover.
            self.probe_failed = True

    async def _drain_longform(self):
        try:
            while self.longform:
                self._refresh_longform()
                if self.longform:
                    # Poll real counters/handles, never assume completion
                    # after a grace timer. A wedged worker stays protected.
                    await asyncio.sleep(0.05)
        finally:
            self._reaper = None

    def snapshot(self):
        self._refresh_longform()
        reason = None
        try:
            if self.uncertain_work:
                reason = "interrupted-request"
            elif self.active > 0:
                reason = "http-request"
            elif self.longform:
                reason = "longform-proof-error" if self.probe_failed or any(record.error for record in self.longform) else "longform-draining"
            elif self.work_busy():
                reason = "background-job"
        except Exception:
            reason = "probe-error"
        busy = reason is not None
        if busy:
            self.last_use = time.monotonic()
        return {"busy": busy, "idle_seconds": max(0, time.monotonic() - self.last_use), "reason": reason,
                "longform_draining": len(self.longform), "physical": self.last_physical,
                # A deliberately enabled MCP server must remain reachable.
                # This is distinct from physical work: manual Stop stays allowed.
                "keep_alive": persistent_listener_enabled() or any(getattr(route, "path", None) == "/mcp" for route in getattr(self.app, "routes", ()))}

    def diagnostic_snapshot(self):
        counts = {}
        for method, route in tuple(self._requests.values())[:64]:
            path = getattr(route(), "path", None)
            # The matched route template comes from Starlette/FastAPI. Never
            # fall back to scope.path, IDs, query strings or request headers.
            path = path if isinstance(path, str) and path.startswith("/") and len(path) <= 240 and not any(ord(char) < 32 for char in path) else "<unmatched>"
            key = method, path
            counts[key] = counts.get(key, 0) + 1
        return {"active_requests": [{"method": method, "route": path, "count": count} for (method, path), count in counts.items()], **runtime_stacks()}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if path == "/next/activity":
            authorized = dict(scope.get("headers", [])).get(b"x-voicestudio-next", b"").decode("ascii", errors="replace") == self.token and bool(self.token)
            result = self.snapshot() if authorized else {"detail": "Brak dostępu"}
            if authorized and scope.get("method", "GET") == "GET" and scope.get("query_string", b"") == b"threads=1":
                result["diagnostics"] = self.diagnostic_snapshot()
            body = json.dumps(result).encode()
            await send({"type": "http.response.start", "status": 200 if authorized else 403,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        foreground = not (scope.get("method", "GET") == "GET" and path in MONITORS) and not path.startswith("/tasks/stream/")
        mutation = scope.get("method", "GET") not in {"GET", "HEAD", "OPTIONS"}
        record = LongformRequest(path) if mutation and _trusted_longform(path) else None
        context_token = None
        request_key = object()
        method = scope.get("method", "GET")
        method = method if method in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"} else "<other>"
        self._requests[request_key] = (method, lambda: scope.get("route"))
        if record is not None:
            record.tracking_ready = self.install_tracking()
            self.longform.add(record)
            context_token = _LONGFORM.set(record)
        response_finished = False
        # Explicit GET metadata may be slow or cancelled by its reader. It is
        # not synthesis/work and must not prevent a deliberate Stop or idle
        # sleep. Mutations, unlisted reads and actual background/drain proof
        # retain the same fail-closed protection.
        if foreground:
            self.active += 1
        if foreground:
            self.last_use = time.monotonic()

        async def tracked_receive():
            message = await receive()
            if message["type"] == "http.disconnect" and mutation and not response_finished:
                if record is None:
                    self.uncertain_work = True
                else:
                    record.interrupted = True
            return message

        async def tracked_send(message):
            nonlocal response_finished
            if record is not None and message["type"] == "http.response.body":
                record.frames += message.get("body", b"")
                if len(record.frames) > 128 * 1024:
                    record.error = True
                    record.frames = b""
                while b"\n\n" in record.frames:
                    frame, record.frames = record.frames.split(b"\n\n", 1)
                    for line in frame.splitlines():
                        if line.startswith(b"data: "):
                            try:
                                event = json.loads(line[6:])
                                if event.get("type") == "started" and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", str(event.get("job_id", ""))):
                                    record.jobs.add(event["job_id"])
                            except (ValueError, TypeError):
                                pass
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                response_finished = True

        try:
            await self.app(scope, tracked_receive, tracked_send)
        except asyncio.CancelledError:
            if mutation:
                if record is None:
                    self.uncertain_work = True
                else:
                    record.interrupted = True
            raise
        except Exception:
            # ASGI 2.4 transports can raise on send instead of delivering
            # http.disconnect. An unfinished mutation has the same debt.
            if mutation and not response_finished:
                if record is None:
                    self.uncertain_work = True
                else:
                    record.interrupted = True
            raise
        finally:
            self._requests.pop(request_key, None)
            if foreground:
                self.active -= 1
            if record is not None:
                record.returned = True
                _LONGFORM.reset(context_token)
                self._refresh_longform()
                if self.longform and self._reaper is None:
                    self._reaper = asyncio.create_task(self._drain_longform())
            if foreground:
                self.last_use = time.monotonic()


def backend_work_busy():
    remote = sys.modules.get("remote_backend")
    if remote is not None and remote.busy():
        return True
    installer = sys.modules.get("engine_installation")
    if installer is not None and installer.busy():
        return True
    manager = sys.modules.get("model_management")
    if manager is not None and manager.busy():
        return True
    from core.tasks import task_manager
    from core.db import db_conn
    from services import model_manager
    if any(task.get("status") in {"pending", "running"} for task in task_manager.active_tasks.values()):
        return True
    with db_conn() as db:
        if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','pending','running','processing','cancelling') LIMIT 1").fetchone():
            return True
    batch = sys.modules.get("api.routers.batch")
    if batch is not None and (batch._processing_job_ids or any(job.get("status") in {"queued", "running"} for job in batch._jobs.values())):
        return True
    pool = model_manager._gpu_pool_singleton
    if pool is not None:
        stats = pool.stats()
        if stats["queued"] or stats["running"]:
            return True
    return _lock_busy(model_manager._model_load_thread_lock) or _lock_busy(model_manager._model_lock)
