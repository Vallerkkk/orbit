"""Unit tests for OpenRouter LulaDroid: no real network or API key needed."""
import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from ai_call import generate_answer


class OpenRouterAnswerTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_key_fails_closed(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}):
            with self.assertRaises(HTTPException) as error:
                await generate_answer([], "O que aconteceu?")
            self.assertEqual(error.exception.status_code, 503)

    async def test_answer_uses_openrouter_and_history(self):
        class FakeResponse:
            status_code = 200
            def json(self):
                return {"choices": [{"message": {"content": "A reunião será sexta-feira."}}]}

        class FakeClient:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                return None
            async def post(self, url, **kwargs):
                self_url = "https://openrouter.ai/api/v1/chat/completions"
                assert url == self_url
                assert kwargs["headers"]["Authorization"] == "Bearer test-secret"
                assert "Ana: reunião na sexta" in kwargs["json"]["messages"][1]["content"]
                return FakeResponse()

        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "test-secret",
            "OPENROUTER_LULADROID_MODEL": "openrouter/auto",
        }), patch("ai_call.httpx.AsyncClient", return_value=FakeClient()):
            answer = await generate_answer([{
                "display_name": "Ana", "text": "reunião na sexta"
            }], "Quando é a reunião?")
        self.assertEqual(answer["source"], "openrouter")
        self.assertIn("sexta-feira", answer["answer"])

    async def test_invalid_model_rejected(self):
        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "test-secret",
            "OPENROUTER_LULADROID_MODEL": "bad model\n",
        }):
            with self.assertRaises(HTTPException) as error:
                await generate_answer([], "Olá")
            self.assertEqual(error.exception.status_code, 503)
