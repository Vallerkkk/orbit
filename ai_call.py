"""
Sistema de IA para chamadas da Órbita — "Lula Droid"
Ativação por comando de voz: "Ei Lula Droid" + desejo ou pesquisa.
Integração preparada para LLM Grok + memória adaptável.
"""
from __future__ import annotations
import os
import time
import json
import re
import tempfile
import threading
import unicodedata
from typing import Any
from datetime import datetime, timezone
from pathlib import Path

# Configuração
STT_PROVIDER = os.getenv("AI_STT_PROVIDER", "simulation")
LLM_PROVIDER = os.getenv("AI_LLM_PROVIDER", "grok")  # preparado para Grok
AI_ENABLED = os.getenv("AI_CALL_ENABLED", "true").lower() == "true"
WAKE_WORD = "ei lula droid"
MEMORY_FILE = Path(os.getenv("LULA_MEMORY_FILE") or (Path(tempfile.gettempdir()) / "orbita_lula_droid_memory.json"))
MAX_TEXT = 2000
MAX_ENTRIES_PER_CALL = 200
MAX_CALLS = 100
TRANSCRIPT_TTL = 1800
_lock = threading.Lock()

# Memória adaptável (em produção pode ir para Supabase)
_memory: dict = {"facts": [], "preferences": {}, "conversation_style": "equilibrado", "learned": []}

def _load_memory():
    global _memory
    try:
        if MEMORY_FILE.exists():
            loaded = json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                _memory = {**_memory, **loaded}
                for key in ("facts", "learned"):
                    if not isinstance(_memory.get(key), list):
                        _memory[key] = []
                if not isinstance(_memory.get("preferences"), dict):
                    _memory["preferences"] = {}
    except Exception:
        pass

def _save_memory():
    try:
        MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        temp = MEMORY_FILE.with_suffix(".tmp")
        temp.write_text(json.dumps(_memory, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(MEMORY_FILE)
    except Exception:
        pass

_load_memory()

# Transcrições por chamada
_transcripts: dict[str, list[dict]] = {}

def is_enabled() -> bool:
    return AI_ENABLED

def add_transcript(call_id: str, user_id: str, display_name: str, text: str, start: float, end: float) -> dict:
    text = text.strip()[:MAX_TEXT]
    entry = {
        "user_id": str(user_id)[:80],
        "display_name": str(display_name or "Participante")[:60],
        "text": text,
        "start": float(start),
        "end": float(end),
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    now = time.time()
    with _lock:
        # Descarta chamadas inativas para não crescer indefinidamente.
        if len(_transcripts) >= MAX_CALLS:
            for key, rows in list(_transcripts.items()):
                if not rows or (rows[-1].get("start", 0) < now - TRANSCRIPT_TTL):
                    _transcripts.pop(key, None)
            while len(_transcripts) >= MAX_CALLS:
                _transcripts.pop(next(iter(_transcripts)), None)
        rows = _transcripts.setdefault(call_id, [])
        rows.append(entry)
        if len(rows) > MAX_ENTRIES_PER_CALL:
            del rows[:len(rows) - MAX_ENTRIES_PER_CALL]
    # Aprendizado leve: extrai preferências simples
    _learn_from_text(text, entry["display_name"])
    return entry

def _learn_from_text(text: str, speaker: str):
    """Memória adaptável simples: aprende fatos e preferências das conversas."""
    lower = text.lower()
    if any(w in lower for w in ["gosto de", "prefiro", "odeio", "não gosto", "nao gosto"]):
        with _lock:
            _memory["learned"].append({
                "speaker": str(speaker)[:60],
                "text": text[:200],
                "ts": datetime.now(timezone.utc).isoformat()
            })
            _memory["learned"] = _memory["learned"][-50:]  # mantém últimas 50
        _save_memory()

def get_recent_transcript(call_id: str, last_seconds: float = 180) -> list[dict]:
    now = time.time()
    cutoff = now - max(1.0, float(last_seconds))
    rows = _transcripts.get(call_id, [])
    recent = [item for item in rows if item.get("start", 0) >= cutoff]
    return recent[-40:]

def clear_call(call_id: str) -> None:
    with _lock:
        _transcripts.pop(call_id, None)

def _normalize(text: str) -> str:
    return unicodedata.normalize("NFD", text or "").encode("ascii", "ignore").decode().lower()

def detect_wake_word(text: str) -> tuple[bool, str]:
    """Detecta Ei/Eai/Oi/Ola Lula Droid e extrai o restante como comando."""
    raw = str(text or "")
    if not raw.strip():
        return False, ""
    # Aceita "eai", "e aí", "ei", "oi", "olá", com ou sem acento/hífen/espaço.
    pattern = re.compile(
        r"\b(?:ei|e\s*a[ií]|oi|ol[aá])\s*[,!.]?\s*lula\s*[-_]?\s*droid\b[\s,.:;!?\-]*(?P<command>.*)",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(raw)
    if match:
        return True, match.group("command").strip()
    # Fallback para textos já normalizados (sem acento).
    normalized = _normalize(raw)
    for variant in ("eai lula droid", "e ai lula droid", "ei lula droid", "ei luladroid", "eai luladroid", "oi lula droid", "ola lula droid"):
        if variant in normalized:
            idx = normalized.find(variant)
            return True, normalized[idx + len(variant):].strip(" ,.:;!?-")
    return False, ""

def simulate_stt(audio_chunk_info: dict) -> str:
    return audio_chunk_info.get("sample_text") or "Fala simulada."

def generate_opinion(context: list[dict], question: str = "", use_memory: bool = True) -> dict:
    """Gera resposta usando contexto + memória adaptável. Preparado para Grok."""
    if not context and not question:
        return {
            "answer": "Ainda não há contexto suficiente nesta chamada.",
            "source": "local",
            "searched": False,
            "wake_detected": False,
        }

    lines = []
    for item in context[-12:]:
        name = item.get("display_name") or item.get("user_id", "?")
        lines.append(f"{name}: {item.get('text', '')}")
    context_text = "\n".join(lines)

    # Incorpora memória
    memory_hint = ""
    if use_memory and _memory.get("learned"):
        recent = _memory["learned"][-3:]
        memory_hint = " (considerando preferências aprendidas anteriormente)"

    searched = any(w in (question + context_text).lower() for w in ["pesquisa", "busca", "internet", "atual", "notícia", "procure"])
    if searched:
        answer = (
            f"Lula Droid aqui. Com base no que foi falado{memory_hint} e numa consulta simulada: "
            "o assunto merece confirmação em fontes confiáveis. "
            f"Analisei {len(context)} falas recentes."
        )
    else:
        answer = (
            f"Lula Droid: analisei o contexto da chamada{memory_hint}. "
            "Minha opinião é que o ponto discutido está coerente e pode ser aprofundado. "
            "Se quiser que eu pesquise algo específico, é só pedir."
        )

    return {
        "answer": answer,
        "context_used": len(context),
        "source": LLM_PROVIDER,
        "searched": searched,
        "question": question or "(opinião geral)",
        "memory_used": bool(memory_hint),
        "wake_detected": True,
    }

def process_audio_chunk(call_id: str, user_id: str, display_name: str, chunk: dict) -> dict:
    start = time.time()
    text = simulate_stt(chunk)
    end = time.time()
    entry = add_transcript(call_id, user_id, display_name, text, start, end)
    woke, command = detect_wake_word(text)
    result = {"transcribed": True, "entry": entry, "latency_ms": round((end - start) * 1000, 1), "wake": woke}
    if woke:
        context = get_recent_transcript(call_id)
        opinion = generate_opinion(context, command)
        result["ai_response"] = opinion
    return result

def get_memory_summary() -> dict:
    return {
        "learned_count": len(_memory.get("learned", [])),
        "style": _memory.get("conversation_style"),
        "recent": _memory.get("learned", [])[-5:],
    }
