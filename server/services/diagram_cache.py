"""Bounded local image cache; downloaded images outlive Napkin's temporary URLs."""
from contextlib import closing
import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path


def cache_key(content: str, label: str, profile: dict) -> str:
    return hashlib.sha256(json.dumps([content, label, profile], sort_keys=True).encode()).hexdigest()


def _connect():
    path = Path(os.getenv("NAPKIN_CACHE_PATH", str(Path(__file__).resolve().parents[1] / "data" / "diagrams.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE IF NOT EXISTS diagrams (key TEXT PRIMARY KEY, result TEXT NOT NULL, created REAL NOT NULL)")
    return db


def read_diagram(key: str) -> dict | None:
    with closing(_connect()) as db:
        row = db.execute("SELECT result FROM diagrams WHERE key=? AND created>?", (key, time.time() - 30 * 86400)).fetchone()
    return json.loads(row[0]) if row else None


def save_diagram(key: str, result: dict) -> None:
    with closing(_connect()) as db:
        db.execute("INSERT OR REPLACE INTO diagrams VALUES (?, ?, ?)", (key, json.dumps(result), time.time()))
        db.execute("DELETE FROM diagrams WHERE key NOT IN (SELECT key FROM diagrams ORDER BY created DESC LIMIT 40)")
        db.commit()
