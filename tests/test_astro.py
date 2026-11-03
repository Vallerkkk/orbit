import asyncio
import io
import os
import time
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
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

    def test_direct_audio_accepts_question_without_wake(self):
        requests=[]
        async def groq(app,path,**kwargs):
            requests.append((path,kwargs))
            if path=='audio/transcriptions': return {'text':'qual é a capital da França?'}
            return {'choices':[{'message':{'content':'É Paris.'}}]}
        with patch.object(astro,'groq_json',groq):
            response=self.client.post(
                f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777701&direct=1',
                content=wav(),headers={'Content-Type':'audio/wav'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['answer']['text'],'É Paris.')
        events=self.client.get('/api/astro/'+ROOM).json()['events']
        self.assertEqual([e['kind'] for e in events],['transcript','answer'])
        self.assertNotIn('wake',events[0])
        self.assertIn('Pergunta de João: qual é a capital da França?',
                      requests[-1][1]['json']['messages'][1]['content'])

    def test_direct_audio_strips_the_optional_wake_word(self):
        content={}
        async def groq(app,path,**kwargs):
            if path=='audio/transcriptions': return {'text':'Ei Cloe, quanto é dois mais dois?'}
            content['text']=kwargs['json']['messages'][1]['content']
            return {'choices':[{'message':{'content':'Quatro.'}}]}
        with patch.object(astro,'groq_json',groq):
            self.client.post(
                f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777702&direct=1',
                content=wav(),headers={'Content-Type':'audio/wav'})
        self.assertNotIn('Ei Cloe',content['text'])
        self.assertIn('Pergunta de João: quanto é dois mais dois?',content['text'])

    def test_speech_not_addressed_to_cloe_is_not_saved(self):
        calls=[]
        async def groq(app,path,**kwargs):
            calls.append(path)
            return {'text':'bom dia, pessoal'}
        with patch.object(astro,'groq_json',groq):
            response=self.audio(chunk='77777777-7777-4777-8777-777777777703')
        self.assertEqual(response.json(),{'transcribed':True})
        self.assertEqual(calls,['audio/transcriptions'])
        self.assertEqual(self.client.get('/api/astro/'+ROOM).json()['events'],[])

    def test_direct_owner_confirmation_executes(self):
        executed=[];proposal=self.owner_plan()
        async def plan_for(self,text,room,headers,user_id=None):
            return proposal
        async def execute(self,plan,headers,room):
            executed.append(plan.kind);return plan.result
        texts=iter(['apaga a última mensagem do canal geral','Eu Kalil Confirmo'])
        async def groq(app,path,**kwargs):
            if path=='audio/transcriptions': return {'text':next(texts)}
            return {'choices':[{'message':{'content':'não deveria responder'}}]}
        with patch.dict(os.environ,{'CLOE_OWNER_ID':UID,'CLOE_CONFIRM_PHRASE':'Eu Kalil Confirmo'}), \
                patch.object(astro.OwnerAdmin,'plan_for',plan_for), \
                patch.object(astro.OwnerAdmin,'execute',execute), \
                patch.object(astro,'groq_json',groq):
            first=self.client.post(
                f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777704&direct=1',
                content=wav(),headers={'Content-Type':'audio/wav'}).json()
            self.assertIn('frase de confirmação',first['answer']['text'])
            self.assertEqual(executed,[])
            self.app.state.astro_calls[ROOM].last_upload[UID]=0
            second=self.client.post(
                f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777705&direct=1',
                content=wav(),headers={'Content-Type':'audio/wav'}).json()
        self.assertEqual(second['answer']['text'],'Pronto. Apaguei a mensagem.')
        self.assertEqual(executed,['delete_message'])

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

    def test_stop_chunk_is_not_stuck_behind_a_busy_upload(self):
        # Com a Cloe falando, o pedido de parar não pode esperar o trecho anterior terminar.
        async def groq(app,path,**kwargs):return {'text':'Cloe, para de falar.'}
        self.assertEqual(self.client.get('/api/astro/'+ROOM).status_code,200)
        call=self.app.state.astro_calls[ROOM]
        call.uploading.add(UID);call.last_upload[UID]=time.time()
        with patch.object(astro,'groq_json',groq):
            blocked=self.audio(chunk='77777777-7777-4777-8777-777777777703')
            stopped=self.client.post(f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777704&stop_only=1',content=wav(),headers={'Content-Type':'audio/wav'})
        self.assertEqual(blocked.status_code,429)
        self.assertEqual(stopped.status_code,200)
        self.assertEqual(stopped.json(),{'transcribed':True,'stop':True})
        # O trecho de parada não solta a reserva do upload que ainda está em andamento.
        self.assertIn(UID,call.uploading)

    def test_stop_chunks_are_limited_to_one_per_half_second(self):
        calls=[]
        async def groq(app,path,**kwargs):
            calls.append(path);return {'text':'ignorado'}
        with patch.object(astro,'groq_json',groq):
            first=self.client.post(f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777707&stop_only=1',content=wav(),headers={'Content-Type':'audio/wav'})
            second=self.client.post(f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777708&stop_only=1',content=wav(),headers={'Content-Type':'audio/wav'})
        self.assertEqual(first.json(),{'transcribed':False})
        self.assertEqual(second.json(),{'transcribed':False})
        # O trecho descartado nem chega a custar uma transcrição na Groq.
        self.assertEqual(calls,['audio/transcriptions'])

    def test_failed_transcription_gives_the_audio_seconds_back(self):
        async def fail(*args,**kwargs):raise HTTPException(429,'Limite da Groq atingido.')
        with patch.object(astro,'DAILY_STT_SECONDS',1), patch.object(astro,'groq_json',fail):
            first=self.audio(chunk='77777777-7777-4777-8777-777777777709')
            self.app.state.astro_calls[ROOM].last_upload[UID]=0
            second=self.audio(chunk='77777777-7777-4777-8777-777777777710')
        self.assertIn('Groq',first.json()['detail'])
        # A tentativa recusada devolveu o segundo reservado, então a cota não bloqueia a seguinte.
        self.assertIn('Groq',second.json()['detail'])

    def test_audio_warms_the_voice_before_the_panel_asks(self):
        calls=[]
        async def fake(text,voice,rate):
            calls.append((text,voice,rate));return b'ID3\x04\x00\x00\x00\x00\x00\x00fake'
        async def groq(app,path,**kwargs):
            if path=='audio/transcriptions': return {'text':'Ei Cloe, tudo bem?'}
            return {'choices':[{'message':{'content':'Tudo certo por aqui.'}}]}
        with patch.object(astro,'synthesize_speech',fake), patch.object(astro,'groq_json',groq):
            answered=self.client.post(f'/api/astro/{ROOM}/audio?chunk_id=77777777-7777-4777-8777-777777777706'
                                      '&voice=pt-BR-FranciscaNeural&rate=1.1',content=wav(),headers={'Content-Type':'audio/wav'})
            speech=self.client.post(f'/api/astro/{ROOM}/speech',
                                    json={'text':'Tudo certo por aqui.','voice':'pt-BR-FranciscaNeural','rate':1.1})
        self.assertEqual(answered.json()['answer']['text'],'Tudo certo por aqui.')
        self.assertEqual(speech.status_code,200)
        # A voz já foi gerada durante a resposta: o painel recebe o mesmo MP3 sem nova síntese.
        self.assertEqual(calls,[('Tudo certo por aqui.','pt-BR-FranciscaNeural','+10%')])

    def test_ask_text_warms_the_voice_chosen_in_the_panel(self):
        calls=[]
        async def fake(text,voice,rate):
            calls.append((text,voice,rate));return b'ID3\x04\x00\x00\x00\x00\x00\x00fake'
        async def groq(app,path,**kwargs):return {'choices':[{'message':{'content':'Resposta curta.'}}]}
        with patch.object(astro,'synthesize_speech',fake), patch.object(astro,'groq_json',groq):
            data=self.client.post(f'/api/astro/{ROOM}/ask',
                                  json={'text':'qual é o resumo?','voice':'pt-BR-ThalitaMultilingualNeural','rate':.9}).json()
            speech=self.client.post(f'/api/astro/{ROOM}/speech',
                                    json={'text':data['answer']['text'],'voice':'pt-BR-ThalitaMultilingualNeural','rate':.9})
        self.assertEqual(speech.status_code,200)
        self.assertEqual(calls,[('Resposta curta.','pt-BR-ThalitaMultilingualNeural','-10%')])

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

    def owner_plan(self, kind='delete_message', result='Pronto. Apaguei a mensagem.'):
        from cloe_admin import Plan
        return Plan(kind, 'Vou apagar a última mensagem. Para confirmar, diga a sua frase de confirmação.',
                    {'message': 'x'}, result, {'community': 'Servidor'})

    def test_owner_command_needs_spoken_confirmation(self):
        executed = []
        proposal = self.owner_plan()

        async def plan_for(self, text, room, headers, user_id=None):
            return proposal

        async def execute(self, plan, headers, room):
            executed.append(plan.kind)
            return plan.result

        texts = iter(['Ei Cloe, apaga a última mensagem do canal geral', 'Eu Kalil Confirmo'])

        async def groq(app, path, **kwargs):
            if path == 'audio/transcriptions':
                return {'text': next(texts)}
            return {'choices': [{'message': {'content': 'não deveria responder'}}]}

        with patch.dict(os.environ, {'CLOE_OWNER_ID': UID, 'CLOE_CONFIRM_PHRASE': 'Eu Kalil Confirmo'}), \
                patch.object(astro.OwnerAdmin, 'plan_for', plan_for), \
                patch.object(astro.OwnerAdmin, 'execute', execute), \
                patch.object(astro, 'groq_json', groq):
            first = self.audio(chunk='99999999-9999-4999-8999-999999999901').json()
            self.assertEqual(first['answer']['kind'], 'answer')
            self.assertIn('frase de confirmação', first['answer']['text'])
            self.assertEqual(executed, [])
            self.app.state.astro_calls[ROOM].last_upload[UID] = 0
            second = self.audio(chunk='99999999-9999-4999-8999-999999999902').json()
        self.assertEqual(second['answer']['text'], 'Pronto. Apaguei a mensagem.')
        self.assertEqual(executed, ['delete_message'])
        context = self.app.state.astro_calls[ROOM].context()
        self.assertNotIn('Kalil', context)
        self.assertIn('[fala de confirmação]', context)

    def test_typed_confirmation_never_executes(self):
        executed = []

        async def execute(self, plan, headers, room):
            executed.append(plan.kind)

        with patch.dict(os.environ, {'CLOE_OWNER_ID': UID}), \
                patch.object(astro.OwnerAdmin, 'execute', execute):
            response = self.client.post(f'/api/astro/{ROOM}/ask',
                                        json={'text': 'Eu Kalil Confirmo'}).json()
        self.assertIn('falada no microfone', response['answer']['text'])
        self.assertEqual(executed, [])

    def test_admin_commands_are_denied_to_other_users(self):
        async def groq(app, path, **kwargs):
            if path == 'audio/transcriptions':
                return {'text': 'Ei Cloe, apaga a última mensagem do canal geral'}
            return {'choices': [{'message': {'content': 'não deveria responder'}}]}

        plan_for = AsyncMock()
        with patch.dict(os.environ, {'CLOE_OWNER_ID': 'outra-pessoa'}), \
                patch.object(astro.OwnerAdmin, 'plan_for', plan_for), \
                patch.object(astro, 'groq_json', groq):
            response = self.audio(chunk='99999999-9999-4999-8999-999999999903').json()
        self.assertIn('Só o dono', response['answer']['text'])
        plan_for.assert_not_awaited()

    def test_three_wrong_confirmations_cancel_the_action(self):
        executed = []
        proposal = self.owner_plan()
        texts = iter(['Ei Cloe, apaga a última mensagem do canal geral',
                      'Eu Kalil Aprovo', 'Eu Kalil Aprovo', 'Eu Kalil Aprovo'])

        async def plan_for(self, text, room, headers, user_id=None):
            return proposal

        async def execute(self, plan, headers, room):
            executed.append(plan.kind)
            return 'não deveria executar'

        async def groq(app, path, **kwargs):
            if path == 'audio/transcriptions':
                return {'text': next(texts)}
            return {'choices': [{'message': {'content': 'não deveria responder'}}]}

        with patch.dict(os.environ, {'CLOE_OWNER_ID': UID, 'CLOE_OWNER_ATTEMPTS': '3'}), \
                patch.object(astro.OwnerAdmin, 'plan_for', plan_for), \
                patch.object(astro.OwnerAdmin, 'execute', execute), \
                patch.object(astro, 'groq_json', groq):
            self.audio(chunk='99999999-9999-4999-8999-999999999904')
            replies = []
            for index in range(3):
                self.app.state.astro_calls[ROOM].last_upload[UID] = 0
                replies.append(self.audio(
                    chunk=f'99999999-9999-4999-8999-99999999991{index}').json()['answer']['text'])
        self.assertEqual(executed, [])
        self.assertIn('cancelei o pedido', replies[-1])
        self.assertNotIn(UID, self.app.state.astro_calls[ROOM].owner_pending)

    def test_expired_proposal_is_not_executed(self):
        executed = []
        proposal = self.owner_plan()
        texts = iter(['Ei Cloe, apaga a última mensagem do canal geral', 'Eu Kalil Confirmo'])

        async def plan_for(self, text, room, headers, user_id=None):
            return proposal

        async def execute(self, plan, headers, room):
            executed.append(plan.kind)

        async def groq(app, path, **kwargs):
            if path == 'audio/transcriptions':
                return {'text': next(texts)}
            return {'choices': [{'message': {'content': 'não deveria responder'}}]}

        with patch.dict(os.environ, {'CLOE_OWNER_ID': UID}), \
                patch.object(astro.OwnerAdmin, 'plan_for', plan_for), \
                patch.object(astro.OwnerAdmin, 'execute', execute), \
                patch.object(astro, 'groq_json', groq):
            self.audio(chunk='99999999-9999-4999-8999-999999999920')
            self.app.state.astro_calls[ROOM].owner_pending[UID]['until'] = 0
            self.app.state.astro_calls[ROOM].last_upload[UID] = 0
            response = self.audio(chunk='99999999-9999-4999-8999-999999999921').json()
        self.assertNotIn('answer', response)
        self.assertEqual(executed, [])

    def test_web_answer_returns_sources_and_marks_them_untrusted(self):
        captured = {}
        found = {'sources': [{'title': 'Banco Central', 'url': 'https://exemplo.com/cotacao'}],
                 'context': '[1] Banco Central\no dólar caiu hoje.'}

        async def groq(app, path, **kwargs):
            captured['body'] = kwargs.get('json', {})
            return {'choices': [{'message': {'content': 'O dólar caiu hoje, segundo o Banco Central.'}}]}

        with patch.object(astro.cloe_web, 'wants_search', lambda text: True), \
                patch.object(astro.cloe_web, 'configured', lambda: True), \
                patch.object(astro.cloe_web, 'research', AsyncMock(return_value=found)), \
                patch.object(astro, 'groq_json', groq):
            response = self.client.post(f'/api/astro/{ROOM}/ask',
                                        json={'text': 'pesquisa o preço do dólar'}).json()
        answer = response['answer']
        self.assertEqual(answer['sources'], found['sources'])
        messages = captured['body']['messages']
        self.assertIn('dados não confiáveis', messages[-1]['content'])
        self.assertIn('o dólar caiu hoje', messages[-1]['content'])

if __name__=='__main__':unittest.main()
