"""Shared scratch directory for verification artifacts."""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_SCRATCH = Path(
    r"C:\Users\steph\AppData\Local\Temp\grok-goal-159df59e34f0\implementer"
)


def scratch_dir() -> Path:
    return Path(os.environ.get("DOGE2MOON_SCRATCH", DEFAULT_SCRATCH))