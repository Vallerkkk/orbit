import asyncio
import io
import time
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import astro_call as astro

ROOM = 'channel-11111111-1111-4111-8111-111111111111'
UID = '22222222-2222-4222-8222-222222222222'
CHUNK = '33333333-3333-4333-8333-333333333333'

def wav():
    b = io.BytesIO()
    with wave.open(b, 'wb') as a:
        a.setnchannels(1); a.setsampwidth(2); a.setframerate(16000); a.writeframes(b'\0\0' * 16000)
    return b.getvalue()

class FakeLiveKit:
    allowed = True
    can_publish = True
    def __init__(self, *args): self.room = self
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def get_participant(self, req):
        if not self.allowed: raise RuntimeError('not in room')
        return SimpleNamespace(name='João', permission=SimpleNamespace(can_publish=self.can_publish))

class AstroTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        async def user(): return ({'id':UID}, {})
        astro.install_astro(self.app, user, lambda: dict(LIVEKIT_URL='x',LIVEKIT_API_KEY='x',LIVEKIT_API_SECRET='x'))
        self.client=TestClient(self.app)
        self.lk=patch.object(astro.api, 'LiveKitAPI', FakeLiveKit);self.lk.start()
        self.addCleanup(self.lk.stop)
        FakeLiveKit.allowed=FakeLiveKit.can_publish=True

    def audio(self, data=None):
        return self.client.post(f'/api/astro/{ROOM}/audio?chunk_id={CHUNK}', content=data or wav(), headers={'Content-Type':'audio/wav'})

    def test_wake_split_question_and_user_isolation(self):
        c=astro.Call()
        self.assertIsNone(c.command('a','Ei Astro'))
        self.assertIsNone(c.command('b','qual foi o combinado?'))
        self.assertEqual(c.command('a','qual foi o combinado?'),'qual foi o combinado?')
        self.assertIsNone(c.command('a','ei'))
        self.assertEqual(c.command('a','Astro, resuma'),'resuma')
        self.assertIsNone(c.command('a','astrologia é interessante'))

    def test_real_time_window_not_last_n_rows(self):
        c=astro.Call();c.add('transcript','a','antigo');c.events[0]['at']=time.time()-901
        c.add('transcript','a','recente');c.add('answer','Astro','resposta')
        self.assertEqual(c.context(),'a: recente')
        self.assertEqual(len(c.events),2)

    def test_room_presence_and_publish_permission(self):
        FakeLiveKit.allowed=False
        self.assertEqual(self.client.get('/api/astro/'+ROOM).status_code,403)
        FakeLiveKit.allowed=True;FakeLiveKit.can_publish=False
        self.assertEqual(self.audio().status_code,403)

    def test_pipeline_and_idempotency(self):
        requests=[]
        async def groq(app,path,**kwargs):
            requests.append((path,kwargs))
            if path=='audio/transcriptions': return {'text':'Ei Astro, o que foi combinado?'}
            return {'choices':[{'message':{'content':'Combinamos testar o app.'}}]}
        with patch.object(astro,'groq_json',groq):
            self.assertEqual(self.audio().status_code,200)
            self.assertEqual(self.audio().json(),{'duplicate':True})
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['transcript','answer'])
        self.assertEqual(events[0]['name'],'João')
        self.assertEqual(requests[0][1]['data']['language'],'pt')
        self.assertEqual(len(requests),2)
        self.assertEqual(self.client.get('/api/astro/direct-44444444-4444-4444-8444-444444444444').json()['events'],[])

    def test_invalid_audio_rejected_before_provider(self):
        self.assertEqual(self.audio(b'not a wav').status_code,400)
        self.assertEqual(self.audio(b'x'*400001).status_code,413)

    def test_silence_and_provider_error_recovery(self):
        async def silence(*args,**kwargs):return {'text':'Ei Astro','segments':[{'no_speech_prob':.99}]}
        with patch.object(astro,'groq_json',silence):self.assertFalse(self.audio().json()['transcribed'])
        self.assertEqual(self.client.get('/api/astro/'+ROOM).json()['events'],[])
        self.app.state.astro_calls.clear()
        async def fail(*args,**kwargs):raise HTTPException(429,'Limite')
        with patch.object(astro,'groq_json',fail):self.assertEqual(self.audio().status_code,429)
        self.assertEqual(self.app.state.astro_calls[ROOM].uploading,set())

if __name__=='__main__':unittest.main()
