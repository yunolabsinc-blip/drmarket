# Vercel 서버리스 진입점 — backend/main.py의 FastAPI 앱을 그대로 노출
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402,F401
