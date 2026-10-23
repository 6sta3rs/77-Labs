"""Prepared REAL EXE watch-folder -> local WAV acceptance; never runs on import.

Requires explicit --run after a parent build/start signal. Own app-data/CDP
sandbox stays outside the repo. Uses ONLY the real edit-audio operation, native
watch IPC and IndexedDB. A deny-by-default IPC/network guard forbids starting a
backend, installing anything or dispatching HTTP. No fixture queue/results are
substituted. Originals are read-only; only this harness's copied files change.
"""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths


import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import time
import uuid

from cpu_installer_acceptance import ExeSession, assert_port_free
from dictation_desktop_acceptance import Native, _owner_module, require_ipc, wait_for, sandbox_parent, report_destination
from model_management import _no_link_ancestors

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]
OWNER = "Seventy Seven Labs watch-folder acceptance v1"
RECIPE = "QA folder -> lokalny WAV bez modelu"

GUARD = r"""(()=>{
  if(window.__qaWatchGuard)return;
  const bridge=window.__TAURI_INTERNALS__;
  if(!bridge?.invoke)throw new Error('Missing owned native bridge');
  const stats={calls:[],blocked:[],microphones:0,browserNetwork:[],transport:'immutable Tauri invoke; guarded custom-protocol fetch and WebView2 postMessage'};
  const allowed=new Set(['watch_folder_status','watch_folder_start','watch_folder_stop','watch_folder_read','watch_folder_acknowledge',
    'runtime_status','library_profiles','dictation_desktop_status','installer_status','plugin:event|listen','plugin:event|unlisten',
    'plugin:window|is_maximized','plugin:window|is_fullscreen','plugin:window|is_visible','plugin:window|inner_size','plugin:window|outer_size']);
  const permit=(command)=>{
    stats.calls.push(command);if(stats.calls.length>2000)throw new Error('QA IPC budget exceeded');
    if(!allowed.has(command)){stats.blocked.push(command);return false;}return true;
  };
  // Tauri invoke/ipc and Wry window.ipc are immutable. Guard BOTH actual
  // transports instead, forwarding every allowed message and binary response.
  const host=window.chrome?.webview,postOriginal=host?.postMessage;
  if(typeof postOriginal!=='function')throw new Error('Missing owned WebView2 fallback transport');
  const guardedPost=(raw)=>{
    const message=typeof raw==='string'?JSON.parse(raw):raw;
    if(!permit(message?.cmd)){
      if(typeof message?.error!=='number')throw new Error('QA refuses malformed native IPC');
      bridge.runCallback(message.error,'QA refuses non-local operation: '+message.cmd);return;
    }
    return postOriginal.call(host,raw);
  };
  host.postMessage=guardedPost;if(host.postMessage!==guardedPost)throw new Error('WebView2 fallback guard was not installed');
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{stats.microphones++;throw new Error('QA physical microphone disabled');};
  const fetchOriginal=window.fetch.bind(window);
  const nativeOrigins=new Set([location.origin,'http://ipc.localhost','https://ipc.localhost']);
  window.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);
    if(url.origin==='http://ipc.localhost'||url.origin==='https://ipc.localhost'){
      const command=decodeURIComponent(url.pathname.slice(1));
      if(!permit(command))return Promise.resolve(new Response(JSON.stringify('QA refuses non-local operation: '+command),{
        status:403,headers:{'Content-Type':'application/json','Tauri-Response':'error'}
      }));
    }
    if(!nativeOrigins.has(url.origin)&&url.protocol!=='blob:'&&url.protocol!=='data:'){
      stats.browserNetwork.push(url.origin);throw new Error('QA external/loopback browser network denied');
    }
    return fetchOriginal(input,options);
  };
  window.__qaWatchGuard=stats;
})();"""

READ_DATABASE = r"""async()=>{
  const database=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('voicestudio-next-automation',2);
    request.onupgradeneeded=()=>{request.transaction.abort();reject(new Error('Automation database must already exist'));};
    request.onerror=()=>reject(new Error('Cannot inspect own automation database'));
    request.onsuccess=()=>resolve(request.result);
  });
  try{
    const tables=await new Promise((resolve,reject)=>{
      const transaction=database.transaction(['recipes','runs','watchReceipts'],'readonly');
      const result={};for(const name of ['recipes','runs','watchReceipts']){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>result[name]=request.result;}
      transaction.oncomplete=()=>resolve(result);transaction.onerror=transaction.onabort=()=>reject(new Error('Read transaction failed'));
    });
    const digest=async(blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const audio=async(value)=>{
      if(value?.kind!=='audio'||!(value.blob instanceof Blob))return null;
      const bytes=await value.blob.arrayBuffer(),view=new DataView(bytes);
      const result={name:value.name,size:value.blob.size,mime:value.blob.type,sha256:await digest(value.blob)};
      if(bytes.byteLength>=44&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'){
        result.sampleRate=view.getUint32(24,true);result.channels=view.getUint16(22,true);result.bits=view.getUint16(34,true);
        let offset=12;while(offset+8<=bytes.byteLength){const id=new TextDecoder().decode(bytes.slice(offset,offset+4)),size=view.getUint32(offset+4,true);if(id==='data'){
          result.frames=size/(result.channels*result.bits/8);result.duration=result.frames/result.sampleRate;
          if(result.bits===16){let peak=0;for(let pos=offset+8;pos<offset+8+size;pos+=2)peak=Math.max(peak,Math.abs(view.getInt16(pos,true))/32768);result.peakDbfs=20*Math.log10(peak);}break;
        }offset+=8+size+(size%2);}
      }
      return result;
    };
    const runs=[];for(const run of tables.runs)runs.push({id:run.id,status:run.status,completedSteps:run.completedSteps,error:run.error,recipe:run.recipe,input:await audio(run.input),result:await audio(run.result)});
    return {recipes:tables.recipes,receipts:tables.watchReceipts,runs};
  }finally{database.close();}
}"""


def sha(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def second_version(original):
    if original[:4] != b"RIFF" or original[8:12] != b"WAVE":
        raise ValueError("Odbiór wymaga publicznej próbki RIFF WAV.")
    # Change only an owned copy, retaining exactly the same public speech.
    result = bytearray(original + b"JUNK" + struct.pack("<I", 8) + b"QA-v0002")
    struct.pack_into("<I", result, 4, len(result) - 8)
    return bytes(result)


def atomic_fixture(path, payload, folder):
    _no_link_ancestors(path)
    if path.resolve().parent != folder.resolve():
        raise ValueError("Plik fixture wykracza poza własny folder wejściowy.")
    temporary = folder / ("fixture-" + uuid.uuid4().hex + ".part")
    with temporary.open("xb") as handle:
        handle.write(payload); handle.flush(); os.fsync(handle.fileno())
    os.replace(temporary, path)  # both verified paths belong to this session


def native_receipts(path):
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    try:
        return connection.execute("SELECT fingerprint,run_id FROM receipts ORDER BY fingerprint").fetchall()
    finally:
        connection.close()


async def database(page):
    return await page.evaluate(READ_DATABASE)


async def complete_runs(page, count):
    value = await database(page)
    return value if len(value["runs"]) == count and all(run["status"] == "done" for run in value["runs"]) else None


async def scan_after(page, timestamp):
    state = await require_ipc(page, "watch_folder_status")
    if state["state"] == "error":
        raise RuntimeError(state["message"])
    return state if state["lastScan"] >= timestamp else None


async def automation_panel(page):
    await page.locator(".sidebar-search").first.press("Enter")
    await page.get_by_role("textbox", name="Szukaj ekranu", exact=True).fill("Automatyzacja")
    await page.get_by_role("dialog").get_by_role("button", name="Automatyzacja", exact=True).press("Enter")
    panel = page.get_by_role("region", name="Obserwowany folder", exact=True)
    await panel.wait_for()
    return panel


async def focus_owned_form(current, locator):
    window = next(value for value in current.native.owned_windows(current.process.pid)
                  if value["title"] and current.native.user.IsWindowVisible(value["handle"]))
    current.native.focus_owned(window, {current.process.pid})
    await locator.scroll_into_view_if_needed()
    await locator.focus()
    if not await current.page.evaluate("document.hasFocus()"):
        raise RuntimeError("Owned WebView2 form did not receive OS focus")


async def choose_saved_recipe(current, panel):
    combo = panel.get_by_role("combobox", name="Zapisana receptura dla folderu", exact=True)
    await combo.scroll_into_view_if_needed()
    await current.page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
    await combo.press("Enter")
    options = current.page.get_by_role("listbox", name="Zapisana receptura dla folderu", exact=True)
    try:
        await options.wait_for(timeout=1500)
        await options.press("Home")
        await options.press("Enter")
        method = "Visible Select popover through keyboard Enter/Home/Enter"
    except Exception as error:
        # WebView2/CDP pointer coordinates and transient popovers are not a
        # watch scanner assertion. Use the REAL form control's normal onchange,
        # never fake a recipe, enqueue operation, scanner or output Blob.
        await current.page.keyboard.press("Escape")
        recipe = await _recipe_saved(current.page)
        if not recipe:
            raise RuntimeError("Actual saved recipe is missing") from error
        await combo.locator("..").locator("select").select_option(recipe["id"], force=True)
        method = "Actual Select native form control onchange; popover not accepted by this run"
    if (await combo.inner_text()).strip() != RECIPE:
        raise RuntimeError("Visible recipe label does not match the actual selection")
    return method


async def guarded_session(arguments, playwright, session, local, roaming, webview, owner, native, number):
    current = ExeSession(arguments.exe.resolve(), session, local, roaming, webview, owner, native)
    current.denied_network = []
    try:
        await current.start(playwright, number)
        # The actual app must be cold BEFORE applying guards; no fixture readiness.
        if (await require_ipc(current.page, "runtime_status"))["state"] != "stopped":
            raise RuntimeError("EXE nie wystartował z zatrzymanym własnym runtime.")
        async def network_guard(route):
            if route.request.url.startswith(("http://tauri.localhost/", "https://tauri.localhost/", "tauri://localhost/", "http://ipc.localhost/", "https://ipc.localhost/", "blob:", "data:")):
                await route.continue_()
            else:
                current.denied_network.append(route.request.url.split('?', 1)[0]); await route.abort()
        for context in current.browser.contexts:
            await context.add_init_script(GUARD)
            await context.route("**/*", network_guard)
            for page in context.pages:
                await page.evaluate(GUARD)
        return current
    except BaseException:
        await current.close()
        raise


def no_backend_children(current):
    import psutil
    forbidden = {"uv.exe", "ffmpeg.exe", "ffprobe.exe"}
    for process in current.root_process.children(recursive=True):
        try:
            name = process.name().lower()
            if name.startswith("python") or name in forbidden:
                return False
        except psutil.NoSuchProcess:
            pass
    return True


async def acceptance(arguments):
    from playwright.async_api import async_playwright
    exe = arguments.exe.resolve(); _no_link_ancestors(exe)
    if not exe.is_file() or exe.suffix.lower() != ".exe":
        raise ValueError("Podaj istniejący zbudowany EXE.")
    original = ROOT / "public/demo/interface-tone.wav"
    public_bytes, original_hash = original.read_bytes(), sha(original)
    base = sandbox_parent(arguments.sandbox_base)
    assert_port_free(4312)
    session = Path(tempfile.mkdtemp(prefix="seventy-seven-watch-exe-", dir=base)).resolve()
    arguments.report = report_destination(arguments.report, session)
    local, roaming, webview, folder = (session / name for name in ("local", "roaming", "webview2", "watched"))
    for path in (local / "VoiceStudioNext/runtime", roaming, webview, folder): path.mkdir(parents=True, exist_ok=True)
    (session / ".qa-owner.json").write_text(json.dumps({"owner": OWNER, "id": uuid.uuid4().hex, "exe_sha256": sha(exe)}), encoding="utf-8")
    report = {"schema": 1, "session": str(session), "exe_sha256": sha(exe), "source": "public/demo/interface-tone.wav", "source_sha256": original_hash,
              "operation": "Actual edit-audio/default normalize -3 dBFS; no fixture operations or queue", "checks": [], "observations": [],
              "backend_started": False, "inference_performed": False, "models_downloaded": False, "cleanup_errors": []}
    def check(name, condition, detail=None):
        report["checks"].append({"name": name, "passed": bool(condition), **({"detail": detail} if detail is not None else {})})
        print(json.dumps({"check": name, "passed": bool(condition)}), flush=True)
        if not condition: raise AssertionError(name)
    native, owner = Native(), _owner_module(session)
    instances, current, writer = [], None, None
    initial_focus = native.identity(native.user.GetForegroundWindow())
    watched = folder / "public-probe.wav"
    playwright = None
    try:
        playwright = await async_playwright().start()
        current = await guarded_session(arguments, playwright, session, local, roaming, webview, owner, native, 1); instances.append(current)
        state = await require_ipc(current.page, "watch_folder_status")
        check("native_source_default_off_before_any_selection", not state["enabled"] and not state["pending"])
        panel = await automation_panel(current.page)
        await current.page.get_by_role("button", name="Audio → WAV · bez modelu", exact=True).press("Enter")
        await current.page.get_by_label("Nazwa receptury", exact=True).fill(RECIPE)
        await current.page.get_by_role("button", name="Zapisz recepturę", exact=True).press("Enter")
        await wait_for(lambda: _recipe_saved(current.page), 8, "Nie zapisano lokalnej receptury w IndexedDB.")
        check("selecting_and_saving_recipe_does_not_enqueue", not (await database(current.page))["runs"] and no_backend_children(current))
        await panel.get_by_label("Lokalny folder wejściowy", exact=True).fill(str(folder))
        await focus_owned_form(current, panel.get_by_label("Lokalny folder wejściowy", exact=True))
        report["recipe_selection_method"] = await choose_saved_recipe(current, panel)
        check("explicit_folder_and_recipe_selection_still_off", not (await require_ipc(current.page, "watch_folder_status"))["enabled"] and not (await database(current.page))["runs"])
        writer = watched.open("xb"); writer.write(public_bytes[:len(public_bytes)//2]); writer.flush(); os.fsync(writer.fileno())
        await panel.get_by_role("button", name="Włącz obserwację i kolejkę", exact=True).press("Enter")
        await wait_for(lambda: _enabled(current.page), 5, "Natywne źródło nie zostało jawnie włączone.")
        barrier = int(time.time()*1000) + 4500
        await wait_for(lambda: scan_after(current.page, barrier), 8, "Brak zakończonego skanu po oknie stabilizacji.")
        check("open_partial_wav_is_not_ingested", not (await database(current.page))["runs"] and not (await require_ipc(current.page, "watch_folder_status"))["pending"])
        writer.close(); writer = None
        barrier = int(time.time()*1000) + 4500
        await wait_for(lambda: scan_after(current.page, barrier), 8, "Brak kontroli zamkniętego częściowego WAV.")
        check("closed_truncated_wav_is_not_ingested", not (await database(current.page))["runs"])
        atomic_fixture(watched, public_bytes, folder)
        first = await wait_for(lambda: complete_runs(current.page, 1), 15, "Pełny WAV nie przeszedł przez rzeczywistą kolejkę do wyniku.")
        check_result(check, first["runs"][0], original_hash)
        await wait_for(lambda: _acknowledged(current.page, 1), 5, "Brak trwałego natywnego potwierdzenia pierwszego wejścia.")
        report["observations"].append(first)
        barrier = int(time.time()*1000) + 4500
        await wait_for(lambda: scan_after(current.page, barrier), 8, "Brak ponownego skanu do deduplikacji.")
        check("unchanged_file_is_deduplicated", len((await database(current.page))["runs"]) == 1)
        version = second_version(public_bytes); atomic_fixture(watched, version, folder)
        second = await wait_for(lambda: complete_runs(current.page, 2), 15, "Zmiana wersji nie utworzyła nowego wejścia.")
        await wait_for(lambda: _acknowledged(current.page, 2), 5, "Brak potwierdzenia drugiej wersji.")
        check("changed_path_size_mtime_version_adds_one_new_input", len({run["id"] for run in second["runs"]}) == 2 and len(second["receipts"]) == 2)
        changed = next(run for run in second["runs"] if run["id"] != first["runs"][0]["id"])
        check_result(check, changed, hashlib.sha256(version).hexdigest())
        check("changed_copy_is_retained_and_original_unchanged", watched.read_bytes() == version and sha(original) == original_hash)
        await panel.get_by_role("button", name="Zatrzymaj źródło wejść", exact=True).press("Enter")
        await wait_for(lambda: _disabled(current.page), 5, "Źródło nie potwierdziło zatrzymania.")
        check("explicit_stop_disables_native_source", not (await require_ipc(current.page, "watch_folder_status"))["enabled"])
        after_stop = folder / "after-stop.wav"; atomic_fixture(after_stop, public_bytes, folder)
        await asyncio.sleep(4.5)
        check("stopped_source_does_not_ingest_new_file", len((await database(current.page))["runs"]) == 2)
        saved_ids = {run["id"] for run in second["runs"]}
        check("native_sqlite_receipts_are_durable", len(native_receipts(local / "VoiceStudioNext/watch-folder.sqlite")) == 2)
        await assert_guards(check, current)
        check("first_exe_closes_gracefully", await current.close())
        assert_port_free(4312)
        current = await guarded_session(arguments, playwright, session, local, roaming, webview, owner, native, 2); instances.append(current)
        check("exe_restart_keeps_native_source_off", not (await require_ipc(current.page, "watch_folder_status"))["enabled"])
        panel = await automation_panel(current.page)
        persisted = await wait_for(lambda: complete_runs(current.page, 2), 8, "Wyniki i Blob nie przetrwały restartu EXE.")
        check("actual_audio_blobs_and_receipts_survive_exe_restart", len(persisted["receipts"]) == 2 and all(run["input"] and run["result"] for run in persisted["runs"]))
        await panel.get_by_role("button", name="Włącz obserwację i kolejkę", exact=True).press("Enter")
        third = await wait_for(lambda: complete_runs(current.page, 3), 15, "Nowy plik po wznowieniu nie został przetworzony.")
        await wait_for(lambda: _acknowledged(current.page, 3), 5, "Brak trzeciego potwierdzenia.")
        new = [run for run in third["runs"] if run["id"] not in saved_ids]
        check("restart_receipts_prevent_replay_of_previous_versions", len(new) == 1 and new[0]["input"]["name"] == "after-stop.wav" and len(third["receipts"]) == 3)
        check_result(check, new[0], original_hash)
        report["observations"].append(third)
        await panel.get_by_role("button", name="Zatrzymaj źródło wejść", exact=True).press("Enter")
        await wait_for(lambda: _disabled(current.page), 5, "Źródło po restarcie nie potwierdziło zatrzymania.")
        await assert_guards(check, current)
        check("owned_input_copies_remain_unmodified_by_app", watched.read_bytes() == version and after_stop.read_bytes() == public_bytes)
        check("final_native_source_off", not (await require_ipc(current.page, "watch_folder_status"))["enabled"])
        await current.page.screenshot(path=str(session / "watch-folder-final.png"))
        check("second_exe_closes_gracefully", await current.close())
    except Exception as error:
        report["error"] = str(error)[:1800]
        if current and current.page and not current.page.is_closed():
            try:
                report["failure_diagnostics"] = await current.page.evaluate("({guard:window.__qaWatchGuard,focused:document.hasFocus(),options:[...document.querySelectorAll('[role=option]')].map(e=>({text:e.textContent,visible:!!e.getClientRects().length})),alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)})")
                await current.page.screenshot(path=str(session / "watch-folder-failure.png"))
            except Exception as diagnostic_error: report["diagnostic_error"] = str(diagnostic_error)
    finally:
        if writer is not None: writer.close()
        for instance in reversed(instances):
            if instance.process is not None and instance.process.poll() is None:
                try:
                    await asyncio.wait_for(require_ipc(instance.page, "watch_folder_stop"), 3)
                except Exception as error: report["cleanup_errors"].append(str(error))
            # A disconnected/hung WebView must not skip closing our retained Job.
            try:
                await instance.close()
            except Exception as error: report["cleanup_errors"].append(str(error))
        if playwright:
            try:
                await playwright.stop()
            except Exception as error: report["cleanup_errors"].append(str(error))
        report["source_unchanged"] = sha(original) == original_hash
        current_focus = native.identity(native.user.GetForegroundWindow())
        owned_pids = {os.getpid(), *(instance.process.pid for instance in instances if instance.process)}
        if current_focus["pid"] in owned_pids and native.matches(initial_focus):
            report["focus_restored"] = bool(native.user.SetForegroundWindow(initial_focus["handle"]))
        report["passed"] = not report.get("error") and not report["cleanup_errors"] and report["source_unchanged"] and bool(report["checks"]) and all(item["passed"] for item in report["checks"])
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def check_result(check, run, input_hash):
    result = run["result"] or {}
    check("actual_local_recipe_completed_without_model_step", run["status"] == "done" and run["completedSteps"] == 1 and [step["kind"] for step in run["recipe"]["steps"]] == ["edit-audio"])
    check("actual_input_blob_matches_public_fixture", run["input"]["sha256"] == input_hash)
    check("actual_output_blob_is_normalized_pcm16_wav", result.get("mime") == "audio/wav" and result.get("bits") == 16 and result.get("sampleRate") == 24000 and result.get("channels") == 1 and abs(result.get("duration", 0) - 3.43) < .0001 and abs(result.get("peakDbfs", 0) + 3) < .01)


async def assert_guards(check, current):
    guard = await current.page.evaluate("window.__qaWatchGuard")
    check("no_backend_network_or_mutating_feature_dispatch", not guard["blocked"] and not guard["browserNetwork"] and not current.denied_network and guard["microphones"] == 0, guard)
    check("no_python_or_download_helpers_in_owned_exe_tree", no_backend_children(current))
    check("actual_native_runtime_remains_stopped", (await require_ipc(current.page, "runtime_status"))["state"] == "stopped")
    assert_port_free(4312)


async def _recipe_saved(page):
    state = await database(page)
    return next((recipe for recipe in state["recipes"] if recipe["name"] == RECIPE and [step["kind"] for step in recipe["steps"]] == ["edit-audio"]), None)


async def _enabled(page):
    state = await require_ipc(page, "watch_folder_status")
    return state if state["enabled"] else None


async def _disabled(page):
    state = await require_ipc(page, "watch_folder_status")
    return state if not state["enabled"] else None


async def _acknowledged(page, count):
    state = await require_ipc(page, "watch_folder_status")
    return state if state["acknowledged"] == count else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--sandbox-base", type=Path)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/watch-folder-exe.json")
    args = parser.parse_args()
    if not args.run: parser.error("Wymagane jawne --run po buildzie i sygnale roota. Sam import niczego nie uruchamia.")
    result = asyncio.run(acceptance(args))
    print(json.dumps({"passed": result["passed"], "checks": len(result["checks"]), "report": str(args.report)}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__": main()
