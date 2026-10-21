"""Acceptance of the REAL built Windows EXE; never runs on import.

Explicit --run is required. This script was prepared separately from the build.
It owns its EXE/Job, WebView2 user data, fake app-data roots and native EDIT HWND.
No physical microphone is opened. Clipboard mutation is OFF by default; the
optional positive test runs ONLY when the entire clipboard is initially empty.
No user's process/window is closed and no registry setting is changed.
"""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths


import argparse
import asyncio
import ctypes as ct
from ctypes import wintypes as wt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile

from model_management import _no_link_ancestors

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]
OFF = {"enabled": False, "shortcut": "Ctrl+Alt+Shift+D", "paste_enabled": False}
PAYLOAD = "QA własnego okna: Zażółć gęślą jaźń. Bez mikrofonu."


class Native:
    """Small Win32 surface; every focus/message mutation checks owned HWND/PID."""
    def __init__(self):
        if os.name != "nt" or ct.sizeof(ct.c_void_p) != 8:
            raise RuntimeError("Odbiór wymaga 64-bitowego Windows i Pythona.")
        self.user = ct.WinDLL("user32", use_last_error=True)
        self.kernel = ct.WinDLL("kernel32", use_last_error=True)
        prototypes = {
            "GetForegroundWindow": ([], wt.HWND), "IsWindow": ([wt.HWND], wt.BOOL),
            "IsWindowVisible": ([wt.HWND], wt.BOOL), "SetForegroundWindow": ([wt.HWND], wt.BOOL),
            "GetWindowThreadProcessId": ([wt.HWND, ct.POINTER(wt.DWORD)], wt.DWORD),
            "GetWindowTextLengthW": ([wt.HWND], ct.c_int), "GetWindowTextW": ([wt.HWND, wt.LPWSTR, ct.c_int], ct.c_int),
            "SetWindowTextW": ([wt.HWND, wt.LPCWSTR], wt.BOOL), "SetFocus": ([wt.HWND], wt.HWND),
            "ShowWindow": ([wt.HWND, ct.c_int], wt.BOOL), "PostMessageW": ([wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM], wt.BOOL),
            "RegisterHotKey": ([wt.HWND, ct.c_int, wt.UINT, wt.UINT], wt.BOOL),
            "UnregisterHotKey": ([wt.HWND, ct.c_int], wt.BOOL), "GetAsyncKeyState": ([ct.c_int], ct.c_short),
            "GetClipboardSequenceNumber": ([], wt.DWORD), "OpenClipboard": ([wt.HWND], wt.BOOL),
            "CloseClipboard": ([], wt.BOOL), "EnumClipboardFormats": ([wt.UINT], wt.UINT),
            "EmptyClipboard": ([], wt.BOOL), "GetClipboardData": ([wt.UINT], wt.HANDLE),
        }
        for name, (arguments, result) in prototypes.items():
            function = getattr(self.user, name); function.argtypes, function.restype = arguments, result
        self.kernel.GetModuleHandleW.argtypes, self.kernel.GetModuleHandleW.restype = [wt.LPCWSTR], wt.HINSTANCE
        self.kernel.GetCurrentThreadId.restype = wt.DWORD
        self.kernel.GlobalLock.argtypes, self.kernel.GlobalLock.restype = [wt.HGLOBAL], ct.c_void_p
        self.kernel.GlobalUnlock.argtypes, self.kernel.GlobalUnlock.restype = [wt.HGLOBAL], wt.BOOL
        self.kernel.GlobalSize.argtypes, self.kernel.GlobalSize.restype = [wt.HGLOBAL], ct.c_size_t
        self.hotkeys = set()

    def identity(self, handle):
        pid = wt.DWORD()
        thread = self.user.GetWindowThreadProcessId(handle, ct.byref(pid))
        return {"handle": int(handle or 0), "pid": int(pid.value), "thread": int(thread), "title": self.text(handle)}

    def text(self, handle):
        length = self.user.GetWindowTextLengthW(handle)
        buffer = ct.create_unicode_buffer(min(max(length + 1, 1), 100_001))
        self.user.GetWindowTextW(handle, buffer, len(buffer))
        return buffer.value

    def matches(self, value):
        return bool(value["handle"] and self.user.IsWindow(value["handle"]) and self.identity(value["handle"])["pid"] == value["pid"] and self.text(value["handle"]) == value["title"])

    def owned_windows(self, pid):
        found = []
        callback_type = ct.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
        @callback_type
        def callback(handle, _):
            window_pid = wt.DWORD()
            self.user.GetWindowThreadProcessId(handle, ct.byref(window_pid))
            if window_pid.value == pid:
                found.append(self.identity(handle))
            return True
        self.user.EnumWindows.argtypes, self.user.EnumWindows.restype = [callback_type, wt.LPARAM], wt.BOOL
        self.user.EnumWindows(callback, 0)
        return found

    def focus_owned(self, value, allowed_pids):
        if value["pid"] not in allowed_pids or not self.matches(value):
            raise RuntimeError("Odmowa zmiany fokusu: HWND nie należy do tego testu.")
        self.user.ShowWindow(value["handle"], 9)
        self.user.SetForegroundWindow(value["handle"])
        if self.user.GetForegroundWindow() != value["handle"]:
            raise RuntimeError("Windows odmówił aktywowania własnego okna QA; nie wysłano klawiszy.")

    def claim_hotkey(self, identifier, key):
        ct.set_last_error(0)
        ok = bool(self.user.RegisterHotKey(None, identifier, 0x4000 | 1 | 2 | 4, key))
        error = ct.get_last_error()
        if ok:
            self.hotkeys.add(identifier)
        return ok, error

    def click_owned_client(self, value, x, y, allowed_pids):
        """Real OS click, only over the exact foreground root owned by this run."""
        self.focus_owned(value, allowed_pids)
        if self.user.GetAsyncKeyState(1) < 0:
            raise RuntimeError("Przycisk myszy jest wciśnięty; nie wysłano kliknięcia QA.")
        self.user.GetCursorPos.argtypes, self.user.GetCursorPos.restype = [ct.POINTER(wt.POINT)], wt.BOOL
        self.user.ClientToScreen.argtypes, self.user.ClientToScreen.restype = [wt.HWND, ct.POINTER(wt.POINT)], wt.BOOL
        self.user.GetAncestor.argtypes, self.user.GetAncestor.restype = [wt.HWND, wt.UINT], wt.HWND
        self.user.WindowFromPoint.argtypes, self.user.WindowFromPoint.restype = [wt.POINT], wt.HWND
        self.user.SetCursorPos.argtypes, self.user.SetCursorPos.restype = [ct.c_int, ct.c_int], wt.BOOL
        self.user.mouse_event.argtypes = [wt.DWORD, wt.DWORD, wt.DWORD, wt.DWORD, ct.c_size_t]
        original, target = wt.POINT(), wt.POINT(round(x), round(y))
        if not self.user.GetCursorPos(ct.byref(original)) or not self.user.ClientToScreen(value["handle"], ct.byref(target)):
            raise RuntimeError("Nie ustalono punktu własnego kliknięcia QA.")
        under = self.user.WindowFromPoint(target)
        if self.user.GetAncestor(under, 2) != value["handle"] or self.user.GetForegroundWindow() != value["handle"]:
            raise RuntimeError("Punkt kliknięcia nie należy do aktywnego własnego widgetu.")
        if not self.user.SetCursorPos(target.x, target.y):
            raise RuntimeError("Nie ustawiono kursora nad własnym polem QA.")
        try:
            if self.user.GetForegroundWindow() != value["handle"] or self.user.GetAncestor(self.user.WindowFromPoint(target), 2) != value["handle"]:
                raise RuntimeError("Własny widget utracił fokus przed kliknięciem; odmowa.")
            self.user.mouse_event(2, 0, 0, 0, 0)
            self.user.mouse_event(4, 0, 0, 0, 0)
        finally:
            current = wt.POINT()
            if self.user.GetCursorPos(ct.byref(current)) and (current.x, current.y) == (target.x, target.y):
                self.user.SetCursorPos(original.x, original.y)

    def release_hotkey(self, identifier):
        if identifier in self.hotkeys:
            if not self.user.UnregisterHotKey(None, identifier):
                raise RuntimeError("Nie zwolniono własnej rejestracji QA.")
            self.hotkeys.remove(identifier)

    def hotkey(self, key, foreground):
        if self.user.GetForegroundWindow() != foreground:
            raise RuntimeError("Cel QA utracił fokus; nie wysłano skrótu.")
        if any(self.user.GetAsyncKeyState(code) < 0 for code in (0x10, 0x11, 0x12, 0x5B, 0x5C)):
            raise RuntimeError("Modyfikator jest fizycznie wciśnięty; nie wysłano skrótu QA.")
        class Keyboard(ct.Structure):
            _fields_ = [("key", wt.WORD), ("scan", wt.WORD), ("flags", wt.DWORD), ("time", wt.DWORD), ("extra", ct.c_size_t)]
        class Mouse(ct.Structure):
            _fields_ = [("x", wt.LONG), ("y", wt.LONG), ("data", wt.DWORD), ("flags", wt.DWORD), ("time", wt.DWORD), ("extra", ct.c_size_t)]
        class Hardware(ct.Structure):
            _fields_ = [("message", wt.DWORD), ("low", wt.WORD), ("high", wt.WORD)]
        class Payload(ct.Union):
            _fields_ = [("keyboard", Keyboard), ("mouse", Mouse), ("hardware", Hardware)]
        class Input(ct.Structure):
            _fields_ = [("type", wt.DWORD), ("payload", Payload)]
        def event(code, up):
            value = Input(); value.type = 1; value.payload.keyboard = Keyboard(code, 0, 2 if up else 0, 0, 0); return value
        codes = [0x11, 0x12, 0x10, key]
        values = (Input * 8)(*[event(code, False) for code in codes], *[event(code, True) for code in reversed(codes)])
        self.user.SendInput.argtypes, self.user.SendInput.restype = [wt.UINT, ct.POINTER(Input), ct.c_int], wt.UINT
        if self.user.SendInput(8, values, ct.sizeof(Input)) != 8:
            releases = (Input * 4)(*[event(code, True) for code in reversed(codes)])
            self.user.SendInput(4, releases, ct.sizeof(Input))
            raise RuntimeError("Windows nie przyjął całego własnego skrótu QA.")

    def clipboard_formats(self):
        if not self.user.OpenClipboard(None):
            raise RuntimeError("Nie można potwierdzić stanu schowka; test dodatni pominięty.")
        try:
            result, current = [], 0
            while True:
                ct.set_last_error(0)
                current = self.user.EnumClipboardFormats(current)
                if not current:
                    if ct.get_last_error():
                        raise RuntimeError("Nie można wyliczyć wszystkich formatów schowka.")
                    return result
                result.append(int(current))
                if len(result) > 1000:
                    raise RuntimeError("Nietypowa liczba formatów schowka; nie zmieniono go.")
        finally:
            self.user.CloseClipboard()

    def restore_empty_clipboard(self, expected_sequence, expected_text):
        """Restore only our known payload; never replace a later user copy."""
        if not self.user.OpenClipboard(None):
            return False
        try:
            if self.user.GetClipboardSequenceNumber() != expected_sequence:
                return False
            handle = self.user.GetClipboardData(13)  # only our expected CF_UNICODETEXT
            if not handle or self.kernel.GlobalSize(handle) < (len(expected_text) + 1) * 2:
                return False
            address = self.kernel.GlobalLock(handle)
            if not address:
                return False
            try:
                if ct.wstring_at(address, len(expected_text) + 1).split("\0", 1)[0] != expected_text:
                    return False
            finally:
                self.kernel.GlobalUnlock(handle)
            return bool(self.user.EmptyClipboard())
        finally:
            self.user.CloseClipboard()


class OwnedEditWindow:
    def __init__(self, native):
        self.native, self.handle, self.edit = native, 0, 0
        self.title = "Seventy Seven QA target " + uuid.uuid4().hex
        self.ready, self.failure = threading.Event(), None
        self.thread = threading.Thread(target=self._loop, name="owned-qa-edit-window", daemon=True)

    def _loop(self):
        user, kernel = self.native.user, self.native.kernel
        self.thread_id = kernel.GetCurrentThreadId()
        result_type = ct.c_ssize_t
        callback_type = ct.WINFUNCTYPE(result_type, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)
        class WindowClass(ct.Structure):
            _fields_ = [("style", wt.UINT), ("procedure", callback_type), ("class_extra", ct.c_int), ("window_extra", ct.c_int),
                        ("instance", wt.HINSTANCE), ("icon", wt.HICON), ("cursor", wt.HANDLE), ("background", wt.HBRUSH),
                        ("menu_name", wt.LPCWSTR), ("class_name", wt.LPCWSTR)]
        user.DefWindowProcW.argtypes, user.DefWindowProcW.restype = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM], result_type
        user.DestroyWindow.argtypes, user.DestroyWindow.restype = [wt.HWND], wt.BOOL
        @callback_type
        def procedure(handle, message, wparam, lparam):
            if message == 0x8001:
                user.ShowWindow(handle, 9); user.SetForegroundWindow(handle); user.SetFocus(self.edit); return 0
            if message == 2:
                user.PostQuitMessage(0); return 0
            return user.DefWindowProcW(handle, message, wparam, lparam)
        self.callback = procedure
        try:
            instance = kernel.GetModuleHandleW(None)
            class_name = "SeventySevenQaEdit" + uuid.uuid4().hex
            value = WindowClass(0, procedure, 0, 0, instance, None, None, None, None, class_name)
            user.RegisterClassW.argtypes, user.RegisterClassW.restype = [ct.POINTER(WindowClass)], wt.ATOM
            if not user.RegisterClassW(ct.byref(value)):
                raise ct.WinError(ct.get_last_error())
            user.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ct.c_int, ct.c_int, ct.c_int, ct.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, ct.c_void_p]
            user.CreateWindowExW.restype = wt.HWND
            self.handle = user.CreateWindowExW(0x80, class_name, self.title, 0x10CF0000, 80, 80, 580, 260, None, None, instance, None)
            self.edit = user.CreateWindowExW(0, "EDIT", "", 0x508010C4, 15, 15, 535, 185, self.handle, None, instance, None)
            if not self.handle or not self.edit:
                raise ct.WinError(ct.get_last_error())
            self.ready.set()
            message = wt.MSG()
            user.GetMessageW.argtypes, user.GetMessageW.restype = [ct.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT], wt.BOOL
            user.TranslateMessage.argtypes, user.TranslateMessage.restype = [ct.POINTER(wt.MSG)], wt.BOOL
            user.DispatchMessageW.argtypes, user.DispatchMessageW.restype = [ct.POINTER(wt.MSG)], result_type
            while user.GetMessageW(ct.byref(message), None, 0, 0) > 0:
                user.TranslateMessage(ct.byref(message)); user.DispatchMessageW(ct.byref(message))
            user.UnregisterClassW.argtypes = [wt.LPCWSTR, wt.HINSTANCE]
            user.UnregisterClassW(class_name, instance)
        except Exception as exc:
            self.failure = str(exc); self.ready.set()

    def start(self):
        self.thread.start()
        if not self.ready.wait(8) or self.failure:
            raise RuntimeError(self.failure or "Nie utworzono własnego okna testowego.")
        return self

    async def focus(self):
        self.native.user.PostMessageW(self.handle, 0x8001, 0, 0)
        await wait_for(lambda: self.native.user.GetForegroundWindow() == self.handle, 3, "Własne okno QA nie uzyskało fokusu.")

    def close(self):
        if self.handle and self.native.user.IsWindow(self.handle):
            self.native.user.PostMessageW(self.handle, 0x10, 0, 0)
        self.thread.join(5)
        return not self.native.user.IsWindow(self.handle)


async def wait_for(predicate, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if asyncio.iscoroutine(value):
            value = await value
        if value:
            return value
        await asyncio.sleep(.1)
    raise RuntimeError(message)


async def ipc(page, command, args=None):
    return await page.evaluate("""async ({command,args})=>{
      try{return {ok:true,value:await window.__TAURI_INTERNALS__.invoke(command,args||{})};}
      catch(cause){return {ok:false,error:String(cause?.message||cause)};}
    }""", {"command": command, "args": args or {}})


async def require_ipc(page, command, args=None):
    result = await ipc(page, command, args)
    if not result["ok"]:
        raise RuntimeError(command + ": " + result["error"])
    return result.get("value")


def _free_port():
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", 0))
        return guard.getsockname()[1]


def sandbox_parent(raw=None):
    """Reject aliases and real app roots BEFORE any acceptance writes."""
    requested = Path(raw or tempfile.gettempdir())
    _no_link_ancestors(requested)
    base = requested.resolve()
    if not base.is_dir() or base.is_relative_to(ROOT):
        raise ValueError("Sandbox musi powstać w istniejącym katalogu poza repozytorium.")
    protected = []
    for key in ("LOCALAPPDATA", "APPDATA"):
        if os.environ.get(key):
            appdata = Path(os.environ[key]).resolve()
            protected.extend(appdata / suffix for suffix in ("VoiceStudioNext", "OmniVoice", "Programs/VoiceStudio"))
    if any(base == root or base.is_relative_to(root) for root in protected):
        raise ValueError("Sandbox nie może znajdować się w rzeczywistych danych ani instalacji VoiceStudio.")
    return base


def report_destination(raw, session):
    path = Path(raw)
    _no_link_ancestors(path)
    resolved = path.resolve()
    if resolved.suffix.lower() != ".json" or not (resolved.is_relative_to(ROOT / ".tmp/qa") or resolved.is_relative_to(session)):
        raise ValueError("Raport QA może trafić wyłącznie do .tmp/qa lub własnego sandboxu.")
    return resolved


def assert_webview_profile_environment(environment, webview, session, *, reuse_owned=False):
    """BEFORE process creation: require the SDK's documented folder override.

    WebView2 replaces even an explicit Tauri/Wry userDataFolder parameter with
    WEBVIEW2_USER_DATA_FOLDER. LOCALAPPDATA alone is not a Known Folder override.
    No registry or actual user profile is inspected by this preflight.
    """
    _no_link_ancestors(session); _no_link_ancestors(webview)
    session, expected = Path(session).resolve(), Path(webview).resolve()
    if expected.parent != session or not expected.is_dir():
        raise ValueError("Profil WebView2 musi być własnym katalogiem w sandboxie tej sesji.")
    keys = [key for key in environment if key.upper() == "WEBVIEW2_USER_DATA_FOLDER"]
    raw = environment.get(keys[0]) if len(keys) == 1 else None
    # Lexical comparison first: don't resolve/open a foreign profile path just
    # to reject it. Only our expected directory has been inspected above.
    if not isinstance(raw, str) or not Path(raw).is_absolute() or os.path.normcase(os.path.abspath(raw)) != os.path.normcase(str(expected)):
        raise ValueError("Brak jednoznacznego WEBVIEW2_USER_DATA_FOLDER wskazującego własny sandbox. EXE nie zostanie uruchomiony.")
    if "--user-data-dir" in environment.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "").lower():
        raise ValueError("Profil musi być wybrany przez oficjalny override WebView2, bez konkurencyjnego --user-data-dir.")
    owner_path = session / ".webview-profile-owner.json"
    owner = {"schema": 1, "owner": "Seventy Seven Labs QA WebView2 profile v1", "profile": str(expected)}
    _no_link_ancestors(owner_path)
    if reuse_owned:
        try:
            if json.loads(owner_path.read_text(encoding="utf-8")) != owner:
                raise ValueError("owner mismatch")
        except (OSError, ValueError) as exc:
            raise ValueError("Nie potwierdzono własności profilu przy restarcie EXE; nie odczytano jego zawartości.") from exc
    else:
        if owner_path.exists() or any(expected.iterdir()):
            raise ValueError("Pierwszy start wymaga nowego, pustego profilu WebView2.")
        with owner_path.open("x", encoding="utf-8") as output:
            json.dump(owner, output)
    return {"sdk_override": "WEBVIEW2_USER_DATA_FOLDER", "user_data_folder": str(expected),
            "empty_before_first_launch": not reuse_owned, "reusing_owned_profile": reuse_owned,
            "validated_before_process_creation": True}


def verify_cdp_ownership(process, port, webview):
    """Read only OUR descendant command lines, and never attach a foreign CDP."""
    import psutil
    root = psutil.Process(process.pid)
    children = root.children(recursive=True)
    owned_pids = {process.pid, *(child.pid for child in children)}
    listeners = [item for item in psutil.net_connections(kind="tcp") if item.laddr and item.laddr.port == port and item.status == "LISTEN"]
    if not listeners or any(item.pid not in owned_pids or item.laddr.ip not in {"127.0.0.1", "::1"} for item in listeners):
        raise RuntimeError("Port CDP nie jest lokalnym listenerem własnego drzewa EXE.")
    command_lines = [argument for child in children for argument in child.cmdline()]
    if not any(str(webview).lower() in argument.lower() for argument in command_lines):
        raise RuntimeError("Własne WebView2 nie potwierdziło wydzielonego userData.")
    return root


def _owner_module(session):
    path = session / "contained_subprocess.py"
    with zipfile.ZipFile(ROOT / "scripts/runtime/vendor/engine.zip") as archive:
        path.write_bytes(archive.read("backend/core/contained_subprocess.py"))
    spec = importlib.util.spec_from_file_location("qa_owned_process", path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


async def acceptance(arguments):
    from playwright.async_api import async_playwright
    native = Native()
    exe, interpreter, pointer = arguments.exe.resolve(), arguments.runtime_python.resolve(), arguments.model_cache_manifest.resolve()
    for path in (exe, interpreter, pointer):
        if not path.is_file():
            raise ValueError("Brak wymaganego pliku: " + str(path))
    # Do not start a backend or borrow a listener during this handler/window test.
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 4312)) == 0:
            raise RuntimeError("Port 4312 jest zajęty. Nie zatrzymano obcego backendu; odbiór wstrzymany.")
    sandbox_base = sandbox_parent(arguments.sandbox_base)
    session = Path(tempfile.mkdtemp(prefix="seventy-seven-dictation-exe-", dir=sandbox_base)).resolve()
    arguments.report = report_destination(arguments.report, session)
    local, roaming, webview = session / "local", session / "roaming", session / "webview2"
    runtime = local / "VoiceStudioNext/runtime"
    for directory in (runtime, roaming, webview):
        directory.mkdir(parents=True, exist_ok=True)
    metadata = json.loads(pointer.read_text(encoding="utf-8"))
    if not isinstance(metadata.get("path"), str) or not Path(metadata["path"]).is_absolute():
        raise ValueError("Manifest modeli nie zawiera bezwzględnego wskaźnika path.")
    # A read-only byte copy of the pointer. No cache traversal/copy/mutation.
    copied_pointer = runtime / "model-cache.json"
    copied_pointer.write_bytes(pointer.read_bytes())
    copied_pointer.chmod(0o444)
    original_foreground = native.identity(native.user.GetForegroundWindow())
    clipboard_start = native.user.GetClipboardSequenceNumber()
    port = _free_port()
    environment = dict(os.environ)
    for key in list(environment):
        if key.startswith(("WEBVIEW2_", "OMNIVOICE_", "HF_", "HUGGINGFACE_", "HUGGING_FACE_", "TRANSFORMERS_", "UV_", "PIP_")) or key in {"PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"}:
            environment.pop(key, None)
    environment.update(LOCALAPPDATA=str(local), APPDATA=str(roaming), WEBVIEW2_USER_DATA_FOLDER=str(webview),
                       WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1 --disable-background-networking --disable-component-update --no-first-run --disable-sync",
                       VOICESTUDIO_NEXT_PYTHON=str(interpreter), VOICESTUDIO_NEXT_PRELOAD_TTS="0")
    with exe.open("rb") as source:
        exe_sha = hashlib.file_digest(source, "sha256").hexdigest()
    (session / ".qa-owner.json").write_text(json.dumps({"owner": "Seventy Seven Labs dictation acceptance v1", "id": uuid.uuid4().hex, "exe_sha256": exe_sha}), encoding="utf-8")
    profile_preflight = assert_webview_profile_environment(environment, webview, session)
    with (session / "webview-profile-preflight.json").open("x", encoding="utf-8") as proof:
        json.dump(profile_preflight, proof, indent=2)
    report = {"schema": 1, "exe_sha256": exe_sha, "session": str(session),
              "webview_profile_preflight": profile_preflight,
              "checks": [], "physical_microphone_used": False, "clipboard_write_requested": False, "positive_paste": "not_requested",
              "graceful_exit": False, "cleanup": {}, "cleanup_errors": []}
    def check(name, passed, detail=None):
        report["checks"].append({"name": name, "passed": bool(passed), **({"detail": detail} if detail is not None else {})})
        if not passed:
            raise AssertionError(name + (": " + str(detail) if detail else ""))
    owner, process, fixture, browser, main = _owner_module(session), None, None, None, None
    shortcut, key = None, None
    positive_sequence = None
    payload_in_clipboard = False
    private_preferences = local / "VoiceStudioNext/data/dictation-desktop.json"
    log = (session / "exe.log").open("wb")
    try:
        process = owner.spawn_owned([str(exe)], cwd=str(exe.parent), env=environment, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
        async with async_playwright() as playwright:
            async def endpoint_ready():
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=.2):
                        return True
                except OSError:
                    if process.poll() is not None:
                        raise RuntimeError("EXE zakończył działanie przed utworzeniem własnego WebView2.")
                    return False
            await wait_for(endpoint_ready, 40, "Brak dedykowanego CDP WebView2.")
            root_process = verify_cdp_ownership(process, port, webview)
            check("cdp_listener_owned_and_loopback_only", True)
            check("dedicated_webview_profile", True)
            browser = await playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            async def page_named(label):
                for context in browser.contexts:
                    for page in context.pages:
                        try:
                            if await page.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label") == label:
                                return page
                        except Exception:
                            continue
                return None
            main = await wait_for(lambda: page_named("main"), 15, "Brak lokalnego głównego okna Tauri.")
            report["packaged_url"] = main.url
            check("packaged_webview_origin", main.url.startswith(("http://tauri.localhost/", "tauri://localhost/")), main.url)
            # Applies to future widget pages BEFORE any app code requests mic.
            guard = """(()=>{window.__qaMicRequests=0;window.__qaAudioContexts=0;
              if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.__qaMicRequests++;throw new Error('QA: physical microphone disabled');};
              for(const key of ['AudioContext','webkitAudioContext'])if(window[key])window[key]=new Proxy(window[key],{construct(target,args){window.__qaAudioContexts++;return Reflect.construct(target,args);}});
            })();"""
            for context in browser.contexts:
                await context.add_init_script(guard)
                for page in context.pages:
                    await page.evaluate(guard)
            status = await require_ipc(main, "dictation_desktop_status")
            check("fresh_hotkey_and_paste_default_off", status["supported"] and not status["preferences"]["enabled"] and not status["preferences"]["paste_enabled"] and not status["registered"] and not status["widget_visible"])
            check("cold_runtime_stopped", (await require_ipc(main, "runtime_status"))["state"] == "stopped")
            fixture = OwnedEditWindow(native)
            fixture.start()
            # Claim a free combination ourselves, then verify the product's
            # actual official-plugin collision error without changing others.
            for number in (17, 18, 19, 20, 21, 22):
                trial = 0x70 + number - 1
                if native.claim_hotkey(0x7711, trial)[0]:
                    key, shortcut = trial, f"Ctrl+Alt+Shift+F{number}"
                    break
            check("own_free_qa_shortcut_found", key is not None)
            collision = await ipc(main, "dictation_desktop_configure", {"preferences": {"enabled": True, "shortcut": shortcut, "paste_enabled": False}})
            check("native_plugin_reports_occupied_shortcut", not collision["ok"] and "zajęta" in collision.get("error", ""))
            check("failed_registration_keeps_off", not (await require_ipc(main, "dictation_desktop_status"))["registered"])
            native.release_hotkey(0x7711)
            preferences = {"enabled": True, "shortcut": shortcut, "paste_enabled": False}
            registered = await require_ipc(main, "dictation_desktop_configure", {"preferences": preferences})
            check("product_registered_hotkey", registered["registered"] and registered["active_shortcut"] == shortcut)
            repeated = await require_ipc(main, "dictation_desktop_configure", {"preferences": preferences})
            check("same_registration_is_idempotent", repeated["registered"] and repeated["active_shortcut"] == shortcut)
            busy, error = native.claim_hotkey(0x7712, key)
            if busy:
                native.release_hotkey(0x7712)
            check("windows_sees_product_registration", not busy and error == 1409)
            await fixture.focus()
            native.hotkey(key, fixture.handle)
            widget = await wait_for(lambda: page_named("dictation-widget"), 15, "Globalny skrót nie utworzył widgetu.")
            await widget.get_by_role("main", name="Pływające okno dyktowania").wait_for()
            status = await require_ipc(main, "dictation_desktop_status")
            check("real_hotkey_handler_shows_widget", status["widget_visible"])
            check("show_does_not_record_or_start_backend", await widget.evaluate("window.__qaMicRequests===0&&window.__qaAudioContexts===0") and (await require_ipc(main, "runtime_status"))["state"] == "stopped")
            check("widget_has_explicit_start_button", await widget.get_by_role("button", name="Rozpocznij dyktowanie", exact=True).count() == 1)
            check("paste_button_disabled_by_default", await widget.get_by_role("button", name="Wklej do poprzedniego okna", exact=True).is_disabled())
            widget_window = next(value for value in native.owned_windows(process.pid) if value["title"] == "Dyktowanie — Seventy Seven Labs")
            async def focus_widget():
                native.focus_owned(widget_window, {process.pid})
                # A foreground top-level HWND is insufficient: WebView2 must
                # receive focus in its own child surface, just like a real click.
                await widget.get_by_role("textbox").click()
                box = await widget.get_by_role("textbox").bounding_box()
                ratio = await widget.evaluate("devicePixelRatio")
                native.click_owned_client(widget_window, (box["x"] + box["width"] / 2) * ratio, (box["y"] + box["height"] / 2) * ratio, {process.pid})
                report["focus_after_owned_os_click"] = {"window_focused": await require_ipc(widget, "plugin:window|is_focused", {"label": "dictation-widget"}), "dom_focused": await widget.evaluate("document.hasFocus()&&document.activeElement?.tagName==='TEXTAREA'"), "own_root_foreground": native.user.GetForegroundWindow() == widget_window["handle"]}
                await wait_for(lambda: require_ipc(widget, "plugin:window|is_focused", {"label": "dictation-widget"}), 3, "WebView2 widgetu nie uzyskał fokusu po kliknięciu własnego pola.")
            await focus_widget()
            sequence = native.user.GetClipboardSequenceNumber()
            rejected = await ipc(widget, "dictation_desktop_paste", {"text": PAYLOAD})
            check("native_paste_off_refuses_without_clipboard_write", not rejected["ok"] and "wyłączone" in rejected.get("error", "") and native.user.GetClipboardSequenceNumber() == sequence,
                  {"response": rejected, "clipboard_sequence_before": sequence, "clipboard_sequence_after": native.user.GetClipboardSequenceNumber(), "own_widget_foreground": native.user.GetForegroundWindow() == widget_window["handle"]})
            rejected_main = await ipc(main, "dictation_desktop_paste", {"text": PAYLOAD})
            check("main_cannot_bypass_widget_paste_boundary", not rejected_main["ok"] and native.user.GetClipboardSequenceNumber() == sequence)
            refused_config = await ipc(widget, "dictation_desktop_configure", {"preferences": {**preferences, "paste_enabled": True}})
            check("widget_cannot_enable_paste_itself", not refused_config["ok"])
            await require_ipc(main, "dictation_desktop_configure", {"preferences": {**preferences, "paste_enabled": True}})
            await require_ipc(main, "dictation_widget_show")  # manual open clears target
            await focus_widget()
            no_target = await ipc(widget, "dictation_desktop_paste", {"text": PAYLOAD})
            check("manual_show_has_no_implicit_target", not no_target["ok"] and "Brak okna" in no_target.get("error", "") and native.user.GetClipboardSequenceNumber() == sequence)
            await require_ipc(main, "dictation_widget_hide")
            await fixture.focus()
            native.hotkey(key, fixture.handle)
            await wait_for(lambda: _visible(main), 5, "Skrót nie pokazał widgetu ponownie.")
            target = (await require_ipc(main, "dictation_desktop_status"))["target"]
            check("hotkey_captures_only_owned_test_target", target and target["available"] and target["title"] == fixture.title)
            # Change OUR title so native HWND/PID/title verification must refuse.
            native.user.SetWindowTextW(fixture.handle, fixture.title + " changed")
            await focus_widget()
            invalid = await ipc(widget, "dictation_desktop_paste", {"text": PAYLOAD})
            check("changed_target_refused_before_clipboard", not invalid["ok"] and native.user.GetClipboardSequenceNumber() == sequence)
            native.user.SetWindowTextW(fixture.handle, fixture.title)
            if arguments.positive_paste_if_clipboard_empty:
                # Full preservation is provable ONLY for an actually empty
                # clipboard. Never clear an existing clipboard to enable QA.
                try:
                    empty = not native.clipboard_formats() and native.user.GetClipboardSequenceNumber() == clipboard_start
                except RuntimeError:
                    empty = False
                if empty:
                    await require_ipc(main, "dictation_widget_hide")
                    await fixture.focus(); native.hotkey(key, fixture.handle)
                    await wait_for(lambda: _visible(main), 5, "Brak widgetu dla dodatniej próby.")
                    target = (await require_ipc(main, "dictation_desktop_status"))["target"]
                    check("positive_paste_target_is_owned_edit_window", target and target["available"] and target["title"] == fixture.title)
                    await focus_widget()
                    await widget.get_by_role("textbox").fill(PAYLOAD)
                    check("clipboard_still_fully_empty_before_paste", not native.clipboard_formats() and native.user.GetClipboardSequenceNumber() == clipboard_start)
                    report["clipboard_write_requested"] = True
                    # Arm cleanup BEFORE dispatch: native paste can write the
                    # clipboard even if Windows later refuses SendInput.
                    payload_in_clipboard = True
                    await widget.get_by_role("button", name="Wklej do poprzedniego okna", exact=True).click()
                    # Only GetWindowText of our explicitly retained EDIT HWND.
                    await wait_for(lambda: native.text(fixture.edit) == PAYLOAD, 5, "Tekst nie dotarł do własnego EDIT HWND.")
                    positive_sequence = native.user.GetClipboardSequenceNumber(); payload_in_clipboard = True
                    check("positive_paste_reached_only_owned_hwnd", native.user.GetForegroundWindow() == fixture.handle and native.text(fixture.edit) == PAYLOAD)
                    check("paste_target_consumed_once", (await require_ipc(main, "dictation_desktop_status"))["target"] is None)
                    report["positive_paste"] = "passed"
                    restored = native.restore_empty_clipboard(positive_sequence, PAYLOAD)
                    report["cleanup"]["empty_clipboard_restored"] = restored
                    payload_in_clipboard = not restored
                    check("full_initial_empty_clipboard_restored", restored and not native.clipboard_formats())
                else:
                    report["positive_paste"] = "skipped_clipboard_not_empty_or_changed"
            else:
                check("default_acceptance_never_changed_clipboard", native.user.GetClipboardSequenceNumber() == clipboard_start)
            await require_ipc(main, "dictation_widget_hide")
            check("hide_stops_widget_without_backend", not (await require_ipc(main, "dictation_desktop_status"))["widget_visible"] and (await require_ipc(main, "runtime_status"))["state"] == "stopped")
            await require_ipc(main, "dictation_desktop_configure", {"preferences": OFF})
            check("explicit_off_unregisters", not (await require_ipc(main, "dictation_desktop_status"))["registered"])
            reusable, _ = native.claim_hotkey(0x7713, key)
            check("shortcut_reusable_after_off", reusable)
            native.release_hotkey(0x7713)
            # Leave registration ACTIVE in memory for the exit cleanup test;
            # the harness restores its private persisted preferences OFF below.
            await require_ipc(main, "dictation_desktop_configure", {"preferences": preferences})
            await require_ipc(main, "dictation_widget_show")
            check("shutdown_arranged_with_visible_widget_and_hotkey", (await require_ipc(main, "dictation_desktop_status"))["widget_visible"])
            main_window = next(value for value in native.owned_windows(process.pid) if value["title"] and value["title"] != "Dyktowanie — Seventy Seven Labs" and native.user.IsWindowVisible(value["handle"]))
            native.user.PostMessageW(main_window["handle"], 0x10, 0, 0)
            await asyncio.to_thread(process.wait, timeout=12)
            report["graceful_exit"] = process.returncode == 0
            check("main_close_exits_even_with_widget", report["graceful_exit"])
            check("widget_hwnd_destroyed_after_exit", not native.user.IsWindow(widget_window["handle"]))
            released, _ = native.claim_hotkey(0x7714, key)
            check("shortcut_reusable_after_real_exe_exit", released)
            native.release_hotkey(0x7714)
            check("opening_and_closing_did_not_start_python", not any(child.is_running() for child in root_process.children(recursive=True)) if root_process.is_running() else True)
    except Exception as exc:
        report["error"] = str(exc)[:1200]
    finally:
        # Best-effort opt-out through IPC, then own Job only. No taskkill / PID
        # discovery termination, and no mutation of real application prefs.
        if main is not None and process is not None and process.poll() is None:
            try:
                await asyncio.wait_for(require_ipc(main, "dictation_desktop_configure", {"preferences": OFF}), 3)
                await asyncio.wait_for(require_ipc(main, "dictation_widget_hide"), 3)
            except Exception:
                pass
        if process is not None and process.poll() is None:
            try:
                process.terminate()
                await asyncio.to_thread(process.wait, timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill(); await asyncio.to_thread(process.wait, timeout=5)
                except (OSError, subprocess.TimeoutExpired) as exc:
                    report["cleanup_errors"].append("Nie potwierdzono zamknięcia własnego Job: " + str(exc))
        report["cleanup"]["owned_exe_exited"] = process is None or process.poll() is not None
        if browser is not None:
            try:
                await asyncio.wait_for(browser.close(), 5)
            except Exception:
                pass
        for identifier in list(native.hotkeys):
            try:
                native.release_hotkey(identifier)
            except Exception as exc:
                report["cleanup_errors"].append(str(exc))
        if payload_in_clipboard:
            sequence_to_restore = positive_sequence if positive_sequence is not None else native.user.GetClipboardSequenceNumber()
            report["cleanup"]["empty_clipboard_restored"] = native.restore_empty_clipboard(sequence_to_restore, PAYLOAD)
            if not report["cleanup"]["empty_clipboard_restored"]:
                report["cleanup_errors"].append("Nie przywrócono pustego schowka: format/treść/sekwencja zmieniły się lub schowek jest zajęty. Nie nadpisano późniejszej zmiany.")
        if fixture is not None:
            report["cleanup"]["own_edit_window_closed"] = fixture.close()
            if not report["cleanup"]["own_edit_window_closed"]:
                report["cleanup_errors"].append("Nie potwierdzono zamknięcia własnego HWND QA.")
        try:
            private_preferences.parent.mkdir(parents=True, exist_ok=True)
            temporary = private_preferences.with_suffix(".qa.tmp")
            temporary.write_text(json.dumps(OFF), encoding="utf-8"); os.replace(temporary, private_preferences)
            report["cleanup"]["private_preferences_off"] = True
        except OSError as exc:
            report["cleanup_errors"].append("Nie przywrócono własnych ustawień OFF: " + str(exc))
        # Restore only the original HWND/document, and only if the foreground
        # is still one of ours. Never steal focus from a later user action.
        current = native.identity(native.user.GetForegroundWindow())
        our_pids = {os.getpid(), process.pid if process else 0}
        if current["pid"] in our_pids and native.matches(original_foreground):
            report["cleanup"]["original_focus_restored"] = bool(native.user.SetForegroundWindow(original_foreground["handle"]))
        else:
            report["cleanup"]["original_focus_restored"] = "skipped_foreground_changed_or_target_gone"
        log.close()
        report["passed"] = not report.get("error") and not report["cleanup_errors"] and all(item["passed"] for item in report["checks"]) and bool(report["checks"])
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


async def _visible(main):
    return (await require_ipc(main, "dictation_desktop_status"))["widget_visible"]


def main():
    parser = argparse.ArgumentParser(description="Jawny odbiór własnego EXE/widgetu, bez fizycznego mikrofonu.")
    parser.add_argument("--run", action="store_true", help="Zezwala uruchomić własny EXE i zmieniać fokus wyłącznie własnych okien QA.")
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--runtime-python", type=Path, required=True)
    parser.add_argument("--model-cache-manifest", type=Path, required=True)
    parser.add_argument("--sandbox-base", type=Path, default=None)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/dictation-desktop-exe.json")
    parser.add_argument("--positive-paste-if-clipboard-empty", action="store_true")
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error("Skrypt wymaga jawnego --run po przygotowaniu i uzgodnieniu odbioru EXE.")
    result = asyncio.run(acceptance(arguments))
    print(json.dumps({"passed": result["passed"], "checks": len(result["checks"]), "positive_paste": result["positive_paste"], "report": str(arguments.report)}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
