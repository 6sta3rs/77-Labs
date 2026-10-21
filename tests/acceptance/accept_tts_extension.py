"""Public-sample acceptance of an installed Kokoro/Chatterbox sidecar.

Uses a disposable backend/database and the app's explicitly prepared private
environment. Never imports user profiles or changes the selected engine.
"""

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths

from pathlib import Path
import argparse
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import wave
import zipfile

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine',choices=['kokoro','chatterbox-multilingual'],required=True)
    parser.add_argument('--runtime',type=Path,default=Path(os.environ['LOCALAPPDATA'])/'VoiceStudioNext/runtime')
    parser.add_argument('--output',type=Path,default=Path('.tmp/tts-acceptance-output'))
    parser.add_argument('--reference',type=Path,help='Własna próbka mowy do testu klonowania; ton UI nie jest mową.')
    parser.add_argument('--reference-text',help='Dokładny tekst własnej próbki mowy.')
    args=parser.parse_args()
    if args.engine=='chatterbox-multilingual' and (not args.reference or not args.reference_text):
        parser.error('Test Chatterbox wymaga --reference i --reference-text z uprawnionej próbki mowy.')
    source=Path(__file__).resolve().parent
    repo=source.parents[1]
    runtime=args.runtime.resolve()
    family='kokoro' if args.engine=='kokoro' else 'chatterbox'
    if not (runtime/'tts-envs'/family/'.next-private-tts').is_file():
        raise RuntimeError('Najpierw przygotuj osobne biblioteki modelu w aplikacji.')
    for name in ['tts_catalog.py','tts_extensions.py','tts_worker.py','prepare_tts.py']:
        target=runtime/name
        if target.exists() and (target.is_symlink() or target.stat().st_nlink>1):
            raise RuntimeError('Zastano współdzielony plik kodu; zachowano go bez zmiany.')
        shutil.copy2(source/name,target)
    sys.path.insert(0,str(source))
    from model_management import selected_model_cache
    cache=selected_model_cache(runtime,runtime.parent/'data')
    output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    reference=args.reference.resolve(strict=True) if args.reference else None
    with tempfile.TemporaryDirectory(prefix='seventy-seven-tts-acceptance-') as folder:
        qa=Path(folder)
        with zipfile.ZipFile(source/'engine.zip') as archive:archive.extractall(qa/'engine')
        os.environ.update(OMNIVOICE_DATA_DIR=str(qa/'data'),OMNIVOICE_ENV_FILE=str(qa/'data/environment'),OMNIVOICE_CACHE_DIR=str(cache),HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
        sys.path[:0]=[str(qa/'engine'),str(qa/'engine/backend')]
        from tts_extensions import register,engine_state
        register(runtime)
        state=engine_state(args.engine,runtime)
        if not state['available']:raise RuntimeError(state['reason'])
        from services.tts_backend import get_backend_class
        engine=get_backend_class(args.engine)()
        timer=threading.Timer(600 if args.engine=='chatterbox-multilingual' else 180,engine.shutdown);timer.daemon=True;timer.start()
        start=time.monotonic()
        try:
            polish=args.engine=='chatterbox-multilingual'
            text='To jest krótki test polskiego głosu.' if polish else 'Hello. This is a local voice test.'
            language='Polish' if polish else 'English'
            options={'language':language,'speed':1}
            if polish:options.update(ref_audio=str(reference),ref_text=args.reference_text)
            audio=engine.generate(text,**options).numpy().reshape(-1)
            import numpy as np
            assert np.isfinite(audio).all() and 2400<audio.size<30*engine.sample_rate and np.max(np.abs(audio))>.01
            prefix='chatterbox' if polish else 'kokoro'
            wav=output/f'{prefix}-tts-test.wav'
            with wave.open(str(wav),'wb') as file:
                file.setnchannels(1);file.setsampwidth(2);file.setframerate(engine.sample_rate)
                file.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
            report={'engine':args.engine,'text':text,'language':language,'sample_rate':engine.sample_rate,'duration_s':len(audio)/engine.sample_rate,'peak':float(np.max(np.abs(audio))),'elapsed_s':time.monotonic()-start,'offline':True,'transport':'SubprocessBackend i prywatny worker','wav':wav.name}
            (output/f'{prefix}-tts-runtime.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=True),flush=True)
        finally:timer.cancel();engine.shutdown()

if __name__=='__main__':main()
