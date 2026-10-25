import unittest
from unittest.mock import patch
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from media_search import install_media_search, simplify, safe_media_url


class MediaResilienceTests(unittest.TestCase):
    def test_malformed_gif_metadata_is_skipped(self):
        for images in ([], 'bad', {'fixed_height': ['bad']}, {'fixed_height': {'url': 'https://media.giphy.com/a.gif', 'width': []}}):
            with self.subTest(images=images):
                result = simplify({'images': images})
                self.assertTrue(result is None or result['width'] == 0)
        self.assertIsNone(safe_media_url('https://user:password@media.giphy.com/a.gif'))

    def test_invalid_provider_response_is_recoverable_and_not_cached(self):
        app = FastAPI()
        async def identity(): return ({'id': 'test-user'}, {})
        install_media_search(app, identity)
        client = TestClient(app)
        async def request(*args, **kwargs):
            return httpx.Response(200, json={'data': 123})
        with patch.dict('os.environ', {'GIPHY_API_KEY': 'test'}), patch.object(httpx.AsyncClient, 'request', request):
            self.assertEqual(client.get('/api/media/trending').status_code, 503)
