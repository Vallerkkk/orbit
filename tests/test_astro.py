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
    checks = 0
    def __init__(self, *args): self.room = self
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def get_participant(self, req):
        FakeLiveKit.checks += 1
        if not self.allowed: raise RuntimeError('not in room')
        return SimpleNamespace(name='João', permission=SimpleNamespace(can_publish=self.can_publish))

class CloeTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        async def user(): return ({'id':UID}, {})
        astro.install_astro(self.app, user, lambda: dict(LIVEKIT_URL='x',LIVEKIT_API_KEY='x',LIVEKIT_API_SECRET='x'))
        self.client=TestClient(self.app)
        self.lk=patch.object(astro.api, 'LiveKitAPI', FakeLiveKit);self.lk.start()
        self.addCleanup(self.lk.stop)
        FakeLiveKit.allowed=FakeLiveKit.can_publish=True
        FakeLiveKit.checks=0
        astro._TTS_CACHE.clear()
        astro.reset_daily_usage()

    def audio(self, data=None, chunk=CHUNK):
        return self.client.post(f'/api/astro/{ROOM}/audio?chunk_id={chunk}', content=data or wav(), headers={'Content-Type':'audio/wav'})

    def test_wake_split_question_and_user_isolation(self):
        c=astro.Call()
        self.assertIsNone(c.command('a','Ei Cloe'))
        self.assertIsNone(c.command('b','qual foi o combinado?'))
        self.assertEqual(c.command('a','qual foi o combinado?'),'qual foi o combinado?')
        self.assertIsNone(c.command('a','ei'))
        self.assertEqual(c.command('a','Cloe, resuma'),'resuma')
        self.assertIsNone(c.command('a','astrologia é interessante'))

    def test_real_time_window_not_last_n_rows(self):
        c=astro.Call();c.add('transcript','a','antigo');c.events[0]['at']=time.time()-901
        c.add('transcript','a','recente');c.add('answer','Cloe','resposta')
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
            if path=='audio/transcriptions': return {'text':'Ei Cloe, o que foi combinado?'}
            return {'choices':[{'message':{'content':'Combinamos testar o app.'}}]}
        with patch.object(astro,'groq_json',groq):
            self.assertEqual(self.audio().status_code,200)
            self.assertEqual(self.audio().json(),{'duplicate':True})
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['transcript','answer'])
        self.assertEqual(events[0]['name'],'João')
        self.assertEqual(events[1]['name'],'Cloe')
        self.assertEqual(requests[0][1]['data']['language'],'pt')
        self.assertEqual(len(requests),2)
        self.assertEqual(self.client.get('/api/astro/direct-44444444-4444-4444-8444-444444444444').json()['events'],[])

    def test_invalid_audio_rejected_before_provider(self):
        self.assertEqual(self.audio(b'not a wav').status_code,400)
        self.assertEqual(self.audio(b'x'*400001).status_code,413)

    def test_daily_quota_reservations(self):
        astro.reset_daily_usage()
        astro.reserve_daily(UID, 'stt', 60, 60, 'áudio transcrito')
        with self.assertRaises(HTTPException) as blocked:
            astro.reserve_daily(UID, 'stt', 1, 60, 'áudio transcrito')
        self.assertEqual(blocked.exception.status_code, 429)
        # Limite 0 desliga a cota (usado para rodar sem teto).
        astro.reserve_daily(UID, 'tts', 10**6, 0, 'voz da Cloe')
        astro.reset_daily_usage()

    def test_audio_seconds_count_against_daily_quota(self):
        async def groq(app, path, **kwargs):
            if path == 'audio/transcriptions': return {'text': 'Ei Cloe, tudo bem?'}
            return {'choices':[{'message':{'content':'Tudo certo.'}}]}
        with patch.object(astro, 'DAILY_STT_SECONDS', 1), patch.object(astro, 'groq_json', groq):
            self.assertEqual(self.audio(chunk='44444444-4444-4444-8444-444444444401').status_code, 200)
            call = self.app.state.astro_calls[ROOM]
            call.last_upload[UID] = 0
            call.recent.clear()
            blocked = self.audio(chunk='44444444-4444-4444-8444-444444444402')
        self.assertEqual(blocked.status_code, 429)
        self.assertIn('Limite diário', blocked.json()['detail'])

    def test_ask_quota_blocks_answer_but_not_transcription(self):
        async def groq(app, path, **kwargs):
            if path == 'audio/transcriptions': return {'text': 'Ei Cloe, tudo bem?'}
            return {'choices':[{'message':{'content':'Tudo certo.'}}]}
        with patch.object(astro, 'DAILY_ASKS', 1), patch.object(astro, 'groq_json', groq):
            self.assertEqual(self.audio(chunk='55555555-5555-4555-8555-555555555501').status_code, 200)
            call = self.app.state.astro_calls[ROOM]
            call.last_upload[UID] = 0
            call.recent.clear()
            blocked = self.audio(chunk='55555555-5555-4555-8555-555555555502')
        self.assertEqual(blocked.status_code, 429)
        self.assertIn('Limite diário', blocked.json()['detail'])

    def test_silence_and_provider_error_recovery(self):
        async def silence(*args,**kwargs):return {'text':'Ei Cloe','segments':[{'no_speech_prob':.99}]}
        with patch.object(astro,'groq_json',silence):self.assertFalse(self.audio().json()['transcribed'])
        self.assertEqual(self.client.get('/api/astro/'+ROOM).json()['events'],[])
        self.app.state.astro_calls.clear()
        async def fail(*args,**kwargs):raise HTTPException(429,'Limite')
        with patch.object(astro,'groq_json',fail):self.assertEqual(self.audio().status_code,429)
        self.assertEqual(self.app.state.astro_calls[ROOM].uploading,set())

    def test_wake_variants_and_false_positives(self):
        c=astro.Call()
        self.assertEqual(c.command('a','Ei cloe, qual é o resumo?'),'qual é o resumo?')
        self.assertEqual(c.command('b','Cloe, resuma a conversa'),'resuma a conversa')
        self.assertEqual(c.command('c','Cloe resuma'),'resuma')
        self.assertEqual(c.command('i','Chloe, quantos somos?'),'quantos somos?')
        self.assertEqual(c.command('j','Klôe, resuma'),'resuma')
        self.assertIsNone(c.command('e','a cloe do filme é bonita'))
        self.assertIsNone(c.command('f','clonagem é legal'))
        self.assertIsNone(c.command('g','Cloe é legal'))
        # Só "Cloe" acorda a assistente; o nome antigo não é mais um comando.
        self.assertIsNone(c.command('k','Ei Astro, qual é o resumo?'))
        self.assertIsNone(c.command('l','as tro, quantos somos?'))
        self.assertIsNone(c.command('m','eistro, resuma'))
        self.assertIsNone(c.command('n','o astro do filme é bonito'))

    def test_stop_command_does_not_trigger_the_model(self):
        c=astro.Call()
        self.assertEqual(c.parse('a','Cloe, pare')[0],'stop')
        self.assertEqual(c.parse('b','Cloe, para aí')[0],'stop')
        # "para que serve" é pergunta, não pedido para parar.
        self.assertEqual(c.parse('c','Cloe, para que serve o feed?')[0],'ask')
        # A ordem de parar vale sem o nome, com as frases mais naturais.
        self.assertEqual(c.parse('d','Para de falar')[0],'stop')
        self.assertEqual(c.parse('e','parar de falar, por favor')[0],'stop')
        self.assertEqual(c.parse('f','pode parar')[0],'stop')
        self.assertEqual(c.parse('g','Cloe, pare de responder')[0],'stop')
        self.assertEqual(c.parse('h','silencia')[0],'stop')
        self.assertFalse(astro.stop_command('Ei Astro, pare'))

    def test_audio_while_speaking_only_accepts_stop(self):
        texts=iter(['qual é o resumo?','Cloe, para de falar.'])
        first='55555555-5555-4555-8555-555555555555'
        second='66666666-6666-4666-8666-666666666666'
        async def groq(app,path,**kwargs):
            if path=='audio/transcriptions': return {'text':next(texts)}
            return {'choices':[{'message':{'content':'resposta'}}]}
        with patch.object(astro,'groq_json',groq):
            ignored=self.client.post(f'/api/astro/{ROOM}/audio?chunk_id={first}&stop_only=1',content=wav(),headers={'Content-Type':'audio/wav'})
            time.sleep(1.05)
            stopped=self.client.post(f'/api/astro/{ROOM}/audio?chunk_id={second}&stop_only=1',content=wav(),headers={'Content-Type':'audio/wav'})
        self.assertEqual(ignored.json(),{'transcribed':False})
        self.assertEqual(stopped.json(),{'transcribed':True,'stop':True})
        # Nada da fala da Cloe entra na transcrição; só o evento de parada é criado.
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['stop'])

    def test_hallucination_is_filtered_before_transcript(self):
        async def hallucination(*args,**kwargs):return {'text':'Legendas pela comunidade Amara.org','segments':[]}
        with patch.object(astro,'groq_json',hallucination):self.assertFalse(self.audio().json()['transcribed'])
        self.assertEqual(self.client.get('/api/astro/'+ROOM).json()['events'],[])

    def test_ask_by_text_uses_the_same_pipeline(self):
        async def groq(app,path,**kwargs):return {'choices':[{'message':{'content':'Somos três na call.'}}]}
        with patch.object(astro,'groq_json',groq):
            response=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'quantos somos?'})
        body=response.json()
        self.assertEqual(response.status_code,200)
        self.assertEqual((body['ok'],body['cursor']), (True,2))
        self.assertEqual(body['answer']['text'],'Somos três na call.')
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
            'que música que está tocando':'/agora',
            'limpa a fila':'/limpar',
            'embaralha a fila':'/embaralhar',
            'repete':'/repetir',
            'remove o item 2 da fila':'/remover 2',
            'volume 40':'/volume 40',
            'aumenta o volume para 30':'/volume 30',
            # "próxima música" sem objeto é pular (antes virava busca por "música").
            'próxima música':'/pular',
            'pula a música':'/pular',
            'toca a próxima':'/pular',
            # Fila, lista de reprodução e playlist são o mesmo lugar.
            'limpar lista de reprodução':'/limpar',
            'limpa a playlist':'/limpar',
            'apaga a lista de reprodução':'/limpar',
            'mostra a lista de reprodução':'/fila',
            'o que tem na playlist':'/fila',
            'remove a segunda da fila':'/remover 2',
            'apaga a terceira música':'/remover 3',
            'pausa a música, por favor, Cloe':'/pausar',
            'próxima música, Cloe':'/pular',
        }
        for text,command in cases.items():self.assertEqual(astro.watch_request(text),command,text)
        self.assertIsNone(astro.watch_request('toque essa música'))
        self.assertIsNone(astro.watch_request('qual é a capital da França?'))

    def test_name_at_the_end_and_without_comma_still_controls_the_player(self):
        c=astro.Call()
        self.assertEqual(c.command('a','próxima música Cloe'),'próxima música')
        self.assertEqual(c.command('b','pausa a música, Cloe'),'pausa a música')
        self.assertEqual(c.command('c','Cloe limpar lista de reprodução'),'limpar lista de reprodução')
        self.assertEqual(c.command('d','Cloe pausa a música'),'pausa a música')
        self.assertEqual(c.command('e','Cloe coloca Bohemian Rhapsody na fila'),'coloca Bohemian Rhapsody na fila')
        self.assertEqual(c.parse('f','para de falar, Cloe')[0],'stop')
        # O nome no fim só acorda a assistente quando antes dele há um comando.
        self.assertIsNone(c.command('g','eu gosto muito da Cloe'))
        self.assertIsNone(c.command('h','a Cloe é legal'))
        self.assertIsNone(c.command('i','o filme da Cloe'))

    def test_unrecognized_music_order_gets_a_command_hint_instead_of_invention(self):
        self.assertEqual(astro.route_request('pausa aí a música')[0],'answer')
        self.assertIn('Ei Cloe, pular',astro.route_request('pausa aí a música')[1])
        # Pergunta comum sobre o recurso continua indo para o modelo.
        self.assertIsNone(astro.route_request('como funciona a fila'))

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
            if path=='audio/transcriptions':return {'text':'Ei Cloe, toque Suicideboys For the Last Time'}
            raise AssertionError('o modelo não deve ser chamado para um pedido de música')
        with patch.object(astro,'groq_json',groq):response=self.audio()
        self.assertEqual(response.status_code,200)
        body=response.json()
        self.assertEqual((body['transcribed'],body['watch'],body['cursor']),
            (True,'/tocar Suicideboys For the Last Time',1))
        self.assertEqual(calls,['audio/transcriptions'])
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['transcript'])
        self.assertTrue(events[0]['wake'])

    def test_ask_with_music_returns_watch_command(self):
        async def groq(*args,**kwargs):raise AssertionError('o modelo não deve ser chamado')
        with patch.object(astro,'groq_json',groq):
            response=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'toque Wonderwall'})
        self.assertEqual(response.json(),{'ok':True,'watch':'/tocar Wonderwall','cursor':1})
        self.assertEqual(self.client.get('/api/astro/'+ROOM).json()['events'][0]['kind'],'transcript')

    def test_ask_with_time_answers_without_the_model(self):
        async def groq(*args,**kwargs):raise AssertionError('o modelo não deve ser chamado')
        with patch.object(astro,'groq_json',groq):
            response=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'que horas são?'})
        body=response.json()
        self.assertEqual((body['ok'],body['cursor']), (True,2))
        self.assertRegex(body['answer']['text'],r'^São \d{2}:\d{2}, horário de Brasília\.$')
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
        FakeLiveKit.allowed=False;self.app.state.astro_members.clear()
        self.assertEqual(speech(text='oi',voice='pt-BR-FranciscaNeural').status_code,403)

    def test_natural_voice_failure_is_reported_to_the_panel(self):
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

    def test_answers_return_in_the_same_response_and_duplicates_are_ignored(self):
        async def groq(app,path,**kwargs):return {'choices':[{'message':{'content':'Resposta pronta.'}}]}
        with patch.object(astro,'groq_json',groq):
            first=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'qual é o resumo?'}).json()
            self.app.state.astro_calls[ROOM].last_ask[UID]=0
            second=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'qual é o resumo?'}).json()
        self.assertEqual(first['answer']['text'],'Resposta pronta.')
        self.assertNotIn('answer',second)
        self.assertEqual(second['cursor'],3)

    def test_full_answer_queue_does_not_consume_the_daily_quota(self):
        with patch.object(astro,'ANSWER_QUEUE',0), patch.object(astro,'DAILY_ASKS',1):
            first=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'primeira pergunta'})
            self.app.state.astro_calls[ROOM].last_ask[UID]=0
            second=self.client.post(f'/api/astro/{ROOM}/ask',json={'text':'outra pergunta'})
        self.assertEqual(first.status_code,200)
        self.assertEqual(second.status_code,200)
        self.assertIn('outras perguntas',first.json()['answer']['text'])
        self.assertEqual(self.app.state.astro_calls[ROOM].waiting,0)

    def test_context_is_trimmed_to_the_configured_limit(self):
        c=astro.Call();c.add('transcript','a','x'*200)
        with patch.object(astro,'CONTEXT_CHARS',60):text=c.context()
        self.assertEqual(len(text),60)
        self.assertTrue(text.endswith('x'*60))

    def test_repeated_polls_reuse_the_presence_check(self):
        self.assertEqual(self.client.get('/api/astro/'+ROOM).status_code,200)
        self.assertEqual(self.client.get('/api/astro/'+ROOM).status_code,200)
        self.assertEqual(FakeLiveKit.checks,1)
        # Presença negativa não fica no cache: quem sai da call perde o acesso na hora.
        self.app.state.astro_members.clear();FakeLiveKit.allowed=False
        self.assertEqual(self.client.get('/api/astro/'+ROOM).status_code,403)
        self.assertEqual(self.client.get('/api/astro/'+ROOM).status_code,403)
        self.assertEqual(FakeLiveKit.checks,3)

if __name__=='__main__':unittest.main()
