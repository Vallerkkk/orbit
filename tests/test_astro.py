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
        astro._TTS_CACHE.clear()

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

    def test_wake_variants_and_false_positives(self):
        c=astro.Call()
        self.assertEqual(c.command('a','Ei astro, qual é o resumo?'),'qual é o resumo?')
        self.assertEqual(c.command('b','Astro, resuma a conversa'),'resuma a conversa')
        self.assertEqual(c.command('c','Astro resuma'),'resuma')
        self.assertEqual(c.command('d','as tro, quantos somos?'),'quantos somos?')
        self.assertEqual(c.command('h','eistro, resuma'),'resuma')
        self.assertIsNone(c.command('e','o astro do filme é bonito'))
        self.assertIsNone(c.command('f','astronomia é legal'))
        self.assertIsNone(c.command('g','Astro é legal'))

    def test_stop_command_does_not_trigger_the_model(self):
        c=astro.Call()
        self.assertEqual(c.parse('a','Astro, pare')[0],'stop')
        self.assertEqual(c.parse('b','Astro, para aí')[0],'stop')
        # "para que serve" é pergunta, não pedido para parar.
        self.assertEqual(c.parse('c','Astro, para que serve o feed?')[0],'ask')

    def test_hallucination_is_filtered_before_transcript(self):
        async def hallucination(*args,**kwargs):return {'text':'Legendas pela comunidade Amara.org','segments':[]}
        with patch.object(astro,'groq_json',hallucination):self.assertFalse(self.audio().json()['transcribed'])
        self.assertEqual(self.client.get('/api/astro/'+ROOM).json()['events'],[])

    def test_ask_by_text_uses_the_same_pipeline(self):
        async def groq(app,path,**kwargs):return {'choices':[{'message':{'content':'Somos três na call.'}}]}
        with patch.object(astro,'groq_json',groq):
            response=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'quantos somos?'})
        self.assertEqual((response.status_code,response.json()), (200,{'ok':True}))
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['transcript','answer'])
        self.assertTrue(events[0]['wake'])
        self.assertEqual(self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'x'}).status_code,400)

    def test_music_requests_map_to_watch_commands(self):
        cases={
            'toque Suicideboys For the Last Time':'/tocar Suicideboys For the Last Time',
            'toca agora Wonderwall':'/tocar agora Wonderwall',
            'coloca a música Bohemian Rhapsody na fila':'/tocar Bohemian Rhapsody',
            'adiciona Wonderwall na fila':'/adicionar Wonderwall',
            'próxima música Wonderwall':'/proxima Wonderwall',
            'pausa a música':'/pausar',
            'continua':'/continuar',
            'pula essa':'/pular',
            'volta':'/voltar',
            'que música está tocando?':'/agora',
            'limpa a fila':'/limpar',
            'embaralha a fila':'/embaralhar',
            'repete':'/repetir',
            'remove o item 2 da fila':'/remover 2',
            'volume 40':'/volume 40',
            'aumenta o volume para 30':'/volume 30',
        }
        for text,command in cases.items():self.assertEqual(astro.watch_request(text),command,text)
        self.assertIsNone(astro.watch_request('toque essa música'))
        self.assertIsNone(astro.watch_request('qual é a capital da França?'))

    def test_direct_time_date_and_math_answers(self):
        self.assertRegex(astro.direct_answer('que horas são?'),r'^São \d{2}:\d{2}, horário de Brasília\.$')
        self.assertRegex(astro.direct_answer('que horas são agora?'),r'^São \d{2}:\d{2}, horário de Brasília\.$')
        self.assertRegex(astro.direct_answer('que dia é hoje?'),r'^Hoje é .+, \d{1,2} de .+ de \d{4}\.$')
        self.assertEqual(astro.direct_answer('quanto é 12 * 7 + 3?'),'O resultado é 87.')
        self.assertEqual(astro.direct_answer('10 / 4'),'O resultado é 2,5.')
        self.assertIsNone(astro.direct_answer('quanto é a multa?'))
        self.assertIsNone(astro.direct_answer('qual é a capital da França?'))

    def test_music_request_is_executed_by_the_asker_without_the_model(self):
        calls=[]
        async def groq(app,path,**kwargs):
            calls.append(path)
            if path=='audio/transcriptions':return {'text':'Ei Astro, toque Suicideboys For the Last Time'}
            raise AssertionError('o modelo não deve ser chamado para um pedido de música')
        with patch.object(astro,'groq_json',groq):response=self.audio()
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json(),{'transcribed':True,'watch':'/tocar Suicideboys For the Last Time'})
        self.assertEqual(calls,['audio/transcriptions'])
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['transcript'])
        self.assertTrue(events[0]['wake'])

    def test_ask_with_music_returns_watch_command(self):
        async def groq(*args,**kwargs):raise AssertionError('o modelo não deve ser chamado')
        with patch.object(astro,'groq_json',groq):
            response=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'toque Wonderwall'})
        self.assertEqual(response.json(),{'ok':True,'watch':'/tocar Wonderwall'})
        self.assertEqual(self.client.get('/api/astro/'+ROOM).json()['events'][0]['kind'],'transcript')

    def test_ask_with_time_answers_without_the_model(self):
        async def groq(*args,**kwargs):raise AssertionError('o modelo não deve ser chamado')
        with patch.object(astro,'groq_json',groq):
            response=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'que horas são?'})
        self.assertEqual(response.json(),{'ok':True})
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['transcript','answer'])
        self.assertRegex(events[-1]['text'],r'^São \d{2}:\d{2}, horário de Brasília\.$')

    def test_natural_voice_endpoint_returns_mp3_and_reuses_cache(self):
        calls=[]
        async def fake(text,voice,rate):
            calls.append((text,voice,rate));return b'ID3\x04\x00\x00\x00\x00\x00\x00fake'
        payload={'text':'Olá a todos','voice':'pt-BR-ThalitaMultilingualNeural','rate':1.1}
        with patch.object(astro,'synthesize_speech',fake):
            first=self.client.post(f'/api/astro/{ROOM}/speech',json=payload)
            self.app.state.astro_calls[ROOM].last_speech.clear()
            second=self.client.post(f'/api/astro/{ROOM}/speech',json=payload)
        self.assertEqual(first.status_code,200)
        self.assertEqual(first.headers['content-type'],'audio/mpeg')
        self.assertTrue(first.content.startswith(b'ID3'))
        self.assertEqual(second.content,first.content)
        self.assertEqual(calls,[('Olá a todos','pt-BR-ThalitaMultilingualNeural','+10%')])

    def test_natural_voice_validates_text_voice_and_presence(self):
        def speech(**payload):
            return self.client.post(f'/api/astro/{ROOM}/speech',json=payload)
        self.assertEqual(speech(text='oi',voice='voz-desconhecida').status_code,400)
        self.assertEqual(speech(text='x',voice='pt-BR-FranciscaNeural').status_code,400)
        self.assertEqual(speech(text='x'*601,voice='pt-BR-FranciscaNeural').status_code,400)
        FakeLiveKit.allowed=False
        self.assertEqual(speech(text='oi',voice='pt-BR-FranciscaNeural').status_code,403)

    def test_natural_voice_failure_is_reported_for_device_fallback(self):
        async def broken(*args,**kwargs):raise HTTPException(503,'A voz natural está indisponível agora.')
        with patch.object(astro,'synthesize_speech',broken):
            response=self.client.post(f'/api/astro/{ROOM}/speech',
                json={'text':'Olá a todos','voice':'pt-BR-FranciscaNeural'})
        self.assertEqual(response.status_code,503)
        self.assertIn('indisponível',response.json()['detail'])

    def test_events_announce_natural_voices(self):
        data=self.client.get('/api/astro/'+ROOM).json()
        self.assertEqual([v['id'] for v in data['voices']],
            ['pt-BR-ThalitaMultilingualNeural','pt-BR-FranciscaNeural'])
        self.assertIsInstance(data['tts'],bool)
        self.assertEqual((astro.tts_rate(None),astro.tts_rate(.8),astro.tts_rate(2)),('+0%','-20%','+30%'))

if __name__=='__main__':unittest.main()
