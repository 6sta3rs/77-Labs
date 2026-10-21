"""Incremental audiobook playback; patches only the private in-memory router.

The stock renderer still owns licences, GPU jobs, durable resume, original
chapter markers and the final mux. Only opted-in audiobook requests use small
cached chapter portions and additive SSE audio_chunk events.
"""
from __future__ import annotations

import asyncio
import contextlib
from contextvars import ContextVar
from dataclasses import dataclass, replace
import functools
import hashlib
import json
import os
from pathlib import Path
import tempfile

_ENABLED = ContextVar("next_audiobook_streaming", default=False)
_SESSION = ContextVar("next_audiobook_stream_session", default=None)
PORTION_CHARS = 500


def chapter_portions(chapter, opts):
    """Use the engine's tag/sentence-aware splitter, keeping voices and pauses."""
    from services.audiobook import Chapter, _gap_after_span, MAX_JOIN_SILENCE_MS
    from services.chunked_tts import split_text_into_chunks, split_paragraphs

    spans = []
    for span in chapter.spans:
        paragraphs = (split_paragraphs(span.text) if opts.paragraph_gap_ms > 0 else []) or [span.text]
        for pi, paragraph in enumerate(paragraphs):
            chunks = split_text_into_chunks(paragraph, max_chars=PORTION_CHARS) or [""]
            for ci, chunk in enumerate(chunks):
                last = pi == len(paragraphs) - 1 and ci == len(chunks) - 1
                join = span.join if last else "paragraph" if ci == len(chunks) - 1 else "continue"
                spans.append(replace(span, text=chunk, pause_ms_after=span.pause_ms_after if last else 0, join=join))
    # Materialize owed boundary gaps before splitting so a chapter boundary
    # cannot silently discard a configured line or paragraph pause.
    pending = 0
    previous = None
    added = 0
    for i, span in enumerate(spans):
        if span.text:
            added += pending
            if added > MAX_JOIN_SILENCE_MS:
                raise ValueError("Suma pauz rozdziału przekracza 15 minut.")
            if pending and previous is not None:
                spans[previous] = replace(spans[previous], pause_ms_after=pending)
            pending = _gap_after_span(span, opts.line_gap_ms, opts.paragraph_gap_ms)
            previous = i
        if span.pause_ms_after > 0:
            pending = 0
    portions, current, size = [], [], 0
    for span in spans:
        if current and size + len(span.text) > PORTION_CHARS:
            portions.append(Chapter(title=chapter.title, spans=current))
            current, size = [], 0
        current.append(span)
        size += len(span.text)
    if current:
        portions.append(Chapter(title=chapter.title, spans=current))
    return portions


def join_wavs(paths, cache_dir):
    """Bounded-memory PCM copy; final chapter is identical to queued portions."""
    import soundfile as sf

    if len(paths) == 1:
        return paths[0]
    key = hashlib.sha256("\n".join(str(Path(p).resolve()) for p in paths).encode()).hexdigest()
    target = Path(cache_dir) / f"next-stream-{key}.wav"
    # A fresh atomic output avoids trusting a torn assembly after a crash.
    fd, name = tempfile.mkstemp(prefix=".next-stream-", suffix=".wav", dir=cache_dir)
    os.close(fd)
    try:
        with sf.SoundFile(paths[0]) as first:
            rate, channels, subtype = first.samplerate, first.channels, first.subtype
        with sf.SoundFile(name, "w", samplerate=rate, channels=channels, subtype=subtype, format="WAV") as output:
            for path in paths:
                with sf.SoundFile(path) as source:
                    if source.samplerate != rate or source.channels != channels:
                        raise ValueError("Fragmenty audiobooka mają różne parametry audio.")
                    for block in source.blocks(blocksize=65536, dtype="float32", always_2d=True):
                        output.write(block)
        with open(name, "r+b") as durable:
            os.fsync(durable.fileno())
        os.replace(name, target)
        return str(target)
    finally:
        Path(name).unlink(missing_ok=True)


@dataclass
class Session:
    queue: asyncio.Queue
    job_id: str = ""
    chapter: int = 0
    sequence: int = 0
    disconnected: object = None


def install():
    from api.routers import audiobook as router
    if getattr(router._public_longform_stream, "_next_streaming", False):
        return
    original_stream, original_chapter = router._public_longform_stream, router._run_chapter

    @functools.wraps(original_chapter)
    async def run_chapter(chapter, **kwargs):
        session = _SESSION.get()
        if session is None:
            return await original_chapter(chapter, **kwargs)
        from core.config import OUTPUTS_DIR
        opts = kwargs["opts"]
        portions = chapter_portions(chapter, opts)
        paths, duration, cached = [], 0.0, True
        index = session.chapter
        session.chapter += 1
        # Gaps were materialized above; don't add them a second time.
        portion_kwargs = {**kwargs, "opts": replace(opts, line_gap_ms=0, paragraph_gap_ms=0)}
        for pi, portion in enumerate(portions):
            if session.disconnected and await session.disconnected():
                raise asyncio.CancelledError()
            settings = portion_kwargs
            if opts.vary_repeats:
                # Occurrence counters restart in each portion. A durable
                # per-portion seed keeps repeated lines distinct on resume too.
                seed = int(hashlib.sha256(f"{session.job_id}:{index}:{pi}:{opts.seed}".encode()).hexdigest()[:8], 16)
                settings = {**portion_kwargs, "opts": replace(portion_kwargs["opts"], seed=seed)}
            path, seconds, hit, _stats = await original_chapter(portion, **settings)
            relative = Path(path).resolve().relative_to(Path(OUTPUTS_DIR).resolve()).as_posix()
            paths.append(path)
            duration += seconds
            cached = cached and hit
            await session.queue.put(f"data: {json.dumps({'type': 'audio_chunk', 'job_id': session.job_id, 'sequence': session.sequence, 'chapter_index': index, 'part': pi + 1, 'parts': len(portions), 'title': chapter.title, 'output': relative, 'duration_s': seconds})}\n\n")
            session.sequence += 1
        # File work remains off the HTTP loop; no models or new synthesis here.
        path = await asyncio.to_thread(join_wavs, paths, kwargs["cache_dir"])
        return path, duration, cached, None

    @functools.wraps(original_stream)
    async def stream(plan, **kwargs):
        if not _ENABLED.get() or kwargs.get("job_type") != "audiobook":
            async with contextlib.aclosing(original_stream(plan, **kwargs)) as events:
                async for frame in events:
                    yield frame
            return
        queue = asyncio.Queue(maxsize=4)
        session = Session(queue, disconnected=kwargs.get("is_disconnected"))

        async def produce():
            token = _SESSION.set(session)
            try:
                async with contextlib.aclosing(original_stream(plan, **kwargs)) as events:
                    async for frame in events:
                        data = json.loads(frame.removeprefix("data:").strip())
                        if data.get("type") == "started":
                            session.job_id = data.get("job_id", "")
                            data["incremental_audio"] = True
                            frame = f"data: {json.dumps(data)}\n\n"
                        await queue.put(frame)
            finally:
                _SESSION.reset(token)

        producer = asyncio.create_task(produce())
        pending = None
        try:
            while True:
                if producer.done() and queue.empty():
                    await producer
                    break
                pending = asyncio.create_task(queue.get())
                await asyncio.wait((producer, pending), return_when=asyncio.FIRST_COMPLETED)
                if pending.done():
                    yield pending.result()
                else:
                    pending.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await pending
                pending = None
        finally:
            if pending:
                pending.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await pending
            producer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await producer

    stream._next_streaming = True
    router._run_chapter, router._public_longform_stream = run_chapter, stream


class StreamingAudiobooks:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        enabled = scope["type"] == "http" and scope.get("method") == "POST" and (path == "/audiobook" or path.startswith("/audiobook/resume/")) and (b"x-next-audiobook-stream", b"1") in scope.get("headers", [])
        if enabled:
            install()
        token = _ENABLED.set(enabled)
        try:
            await self.app(scope, receive, send)
        finally:
            _ENABLED.reset(token)
