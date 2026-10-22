"""LulaDroid NVIDIA NIM unit tests. No real credentials or network needed."""
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from ai_call import generate_answer


class NvidiaNimAnswerTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_key_fails_closed(self):
        with patch.dict(os.environ, {"NVIDIA_API_KEY": ""}):
            with self.assertRaises(HTTPException) as error:
                await generate_answer([], "O que aconteceu?")
        self.assertEqual(error.exception.status_code, 503)

    async def test_response_uses_nvidia_endpoint_and_context(self):
        class FakeResponse:
            status_code = 200

            def json(self):
                return {"choices": [{"message": {"content": "A reunião será sexta-feira."}}]}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def post(self, url, **kwargs):
                assert url == "https://integrate.api.nvidia.com/v1/chat/completions"
                assert kwargs["headers"]["Authorization"] == "Bearer test-secret"
                body = kwargs["json"]
                assert body["model"] == "nvidia/nemotron-3-ultra-550b-a55b"
                assert body["stream"] is False
                assert body["reasoning_effort"] == "none"
                assert "Ana: reunião na sexta" in body["messages"][1]["content"]
                return FakeResponse()

        with patch.dict(os.environ, {
            "NVIDIA_API_KEY": "test-secret",
            "NVIDIA_NIM_MODEL": "nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b",
        }), patch("ai_call.httpx.AsyncClient", FakeClient):
            answer = await generate_answer(
                [{"display_name": "Ana", "text": "reunião na sexta"}],
                "Quando é a reunião?",
            )
        self.assertEqual(answer["source"], "nvidia-nim")
        self.assertEqual(answer["model"], "nvidia/nemotron-3-ultra-550b-a55b")
        self.assertIn("sexta-feira", answer["answer"])

    async def test_invalid_model_fails_before_network(self):
        with patch.dict(os.environ, {
            "NVIDIA_API_KEY": "test-secret",
            "NVIDIA_NIM_MODEL": "bad model",
        }):
            with self.assertRaises(HTTPException) as error:
                await generate_answer([], "Olá")
        self.assertEqual(error.exception.status_code, 503)

    async def test_rate_limit_does_not_expose_provider_body(self):
        class FakeResponse:
            status_code = 429
            text = "private provider response"
        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                return None
            async def post(self, *args, **kwargs):
                return FakeResponse()

        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-secret"}):
            with patch("ai_call.httpx.AsyncClient", FakeClient):
                with self.assertRaises(HTTPException) as error:
                    await generate_answer([], "Olá")
        self.assertEqual(error.exception.status_code, 429)
        self.assertNotIn("private provider response", str(error.exception.detail))

    async def test_empty_answer_is_an_error(self):
        class FakeResponse:
            status_code = 200
            def json(self):
                return {"choices": [{"message": {"content": None}}]}
        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                return None
            async def post(self, *args, **kwargs):
                return FakeResponse()

        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-secret"}):
            with patch("ai_call.httpx.AsyncClient", FakeClient):
                with self.assertRaises(HTTPException) as error:
                    await generate_answer([], "Olá")
        self.assertEqual(error.exception.status_code, 502)
