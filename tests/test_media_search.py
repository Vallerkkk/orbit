import os
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
import app
from test_integrations import ENV, USER

AUTH = {'Authorization': 'Bearer test'}


class MediaSearchTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {**ENV, 'GIPHY_API_KEY': ''}); self.env.start(); self.client = TestClient(app.app); self.seen = []
    def tearDown(self):
        self.env.stop()

    def remote(self):
        async def request(_client, method, url, **kwargs):
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200, json={'id': USER})
            if url.startswith('https://api.giphy.com/v1/'):
                self.seen.append((url, kwargs.get('params')))
                return httpx.Response(200, json={'data': [
                    {'id': 'a', 'title': 'oi', 'images': {'fixed_height': {'url': 'https://media2.giphy.com/media/a/200.gif?cid=x', 'width': '200', 'height': '200'}}},
                    {'id': 'evil', 'images': {'fixed_height': {'url': 'https://evil.example/x.gif'}}}]})
            raise AssertionError('Unexpected outbound request: ' + url)
        return patch.object(httpx.AsyncClient, 'request', request)

    def test_without_key_degrades(self):
        with self.remote():
            r = self.client.get('/api/media/trending?type=gifs', headers=AUTH)
        self.assertEqual(r.json(), {'available': False, 'results': [], 'provider': 'GIPHY'}); self.assertFalse(self.seen)

    def test_key_stays_on_server_and_hosts_are_filtered(self):
        with patch.dict(os.environ, {'GIPHY_API_KEY': 'segredo-giphy'}), self.remote():
            r = self.client.get('/api/media/search?type=stickers&q=gato', headers=AUTH)
            again = self.client.get('/api/media/search?type=stickers&q=gato', headers=AUTH)
        self.assertNotIn('segredo-giphy', r.text)
        self.assertEqual([x['url'] for x in r.json()['results']], ['https://media2.giphy.com/media/a/200.gif'])
        self.assertTrue(self.seen[0][0].endswith('/stickers/search')); self.assertEqual(len(self.seen), 1, 'cache curto')
        self.assertEqual(again.json(), r.json())

    def test_requires_login_and_valid_type(self):
        self.assertIn(self.client.get('/api/media/trending').status_code, (401, 403))
        with self.remote():
            self.assertEqual(self.client.get('/api/media/trending?type=videos', headers=AUTH).status_code, 422)

    def test_rate_limit(self):
        with patch.dict(os.environ, {'GIPHY_API_KEY': 'k'}), self.remote():
            codes = [self.client.get(f'/api/media/search?q=t{i}', headers=AUTH).status_code for i in range(32)]
        self.assertIn(429, codes)


if __name__ == '__main__':
    unittest.main()
