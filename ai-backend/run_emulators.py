"""Runs the AI backend against the local Firebase emulators (`npm run emulators`), for testing only.

    python ai-backend/run_emulators.py        (or: npm run agent:emulators)

The Gemini key is read from ai-backend/.env.local (GEMINI_API_KEY=...; git-ignored). No service account is needed:
Firebase is set up here with anonymous credentials for the emulators of the demo-smartinc project, and app.py skips
its own set-up when an app already exists, so it never reaches the real project.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ID = "demo-smartinc"

try:
    from dotenv import load_dotenv

    load_dotenv(HERE / ".env.local")
except ImportError:
    pass

for name in ("FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_B64", "GOOGLE_APPLICATION_CREDENTIALS"):
    os.environ.pop(name, None)
os.environ.update(
    {
        "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8080",
        "FIREBASE_AUTH_EMULATOR_HOST": "127.0.0.1:9099",
        "FIREBASE_STORAGE_EMULATOR_HOST": "127.0.0.1:9199",
        "GOOGLE_CLOUD_PROJECT": PROJECT_ID,
        "GCLOUD_PROJECT": PROJECT_ID,
        "FIREBASE_PROJECT_ID": PROJECT_ID,
    }
)
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

import firebase_admin  # noqa: E402
from firebase_admin import credentials  # noqa: E402
from google.auth.credentials import AnonymousCredentials  # noqa: E402


class _EmulatorCredential(credentials.Base):
    def get_credential(self):
        return AnonymousCredentials()


firebase_admin.initialize_app(_EmulatorCredential(), {"projectId": PROJECT_ID})

if __name__ == "__main__":
    if not os.getenv("GEMINI_API_KEY"):
        print("GEMINI_API_KEY is not set (ai-backend/.env.local): the assistant will answer with an error.")
    sys.path.insert(0, str(HERE))

    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=int(os.getenv("AGENT_PORT", "8000")))
