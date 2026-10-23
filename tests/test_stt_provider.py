import os, unittest
from unittest.mock import patch
import app


class SttProviderTests(unittest.TestCase):
    def test_groq_preferred(self):
        with patch.dict(os.environ, {"STT_API_KEY": "k", "GEMINI_API_KEY": "g"}):
            self.assertEqual(app.stt_provider(), "groq")

    def test_gemini_fallback(self):
        with patch.dict(os.environ, {"STT_API_KEY": "", "GEMINI_API_KEY": "g"}):
            self.assertEqual(app.stt_provider(), "gemini")

    def test_none(self):
        with patch.dict(os.environ, {"STT_API_KEY": "", "GEMINI_API_KEY": ""}):
            self.assertEqual(app.stt_provider(), "")
