// Canal de texto #ouvir-juntos: só comandos e links do YouTube. O autor executa o comando na sessão
// do Ouvir juntos da sala de voz em que está (no mesmo servidor) e salva a resposta em command_result.
import {parseWatchInput,COMMANDS} from './watch-commands.js';

export const isMusicChannel=c=>!!c&&!c.private&&c.kind==='text'&&!!c.is_music;
export function checkMusicMessage(text){const r=parseWatchInput(text);return r.error?{ok:false,error:r.error}:{ok:true,parsed:r};}
// Decide se quem enviou pode controlar a sessão: precisa estar conectado numa sala de voz do mesmo servidor.
export function callScope(state,channel){const call=state.callChannel,room=state.room;if(!room||room.state!=='connected'||!call)return 'Você não está em uma sala de voz. Entre numa sala deste servidor e mande o comando de novo.';if(call.community_id!==channel.community_id)return 'Sua chamada é em outro servidor. Entre numa sala de voz deste servidor para controlar o Ouvir juntos daqui.';return '';}
export const MUSIC_PLACEHOLDER='/tocar <link ou busca>, /pular, /fila, /ajuda…';

export function initMusicChannel({el,state,checked,toast,watchCommand}){
  const done=new Set();let card;
  function buildCard(){const box=el('details','music-card');box.id='music-card';{const saved=localStorage.getItem('orbita-music-card');box.open=saved?saved==='open':!matchMedia('(max-width:640px)').matches;}box.ontoggle=()=>localStorage.setItem('orbita-music-card',box.open?'open':'closed');
    const sum=el('summary');sum.append(el('span','music-card-icon','♪'),el('strong','','Canal do Ouvir juntos'),el('span','music-card-hint','comandos'));
    const intro=el('p','','Controle a música e os vídeos da sala de voz em que você está. Só comandos e links do YouTube são aceitos aqui; o resultado aparece logo abaixo de cada comando. Playlists entram inteiras (até 200 vídeos).');
    const list=el('ul','music-card-cmds');for(const [n,a,d] of COMMANDS){const li=el('li'),code=el('button','music-cmd','/'+n+(a?' '+a:''));code.type='button';code.title='Escrever /'+n;code.onclick=()=>{const input=document.getElementById('message-input');input.value='/'+n+(a?' ':'');input.focus();input.dispatchEvent(new Event('input'));};li.append(code,el('span','',d));list.append(li);}
    box.append(sum,intro,list);return box;}
  function sync(){const {selected,home}=state(),on=!home&&isMusicChannel(selected),list=document.getElementById('message-list');document.body.dataset.ouvirCanal=on?'1':'';
    const input=document.getElementById('message-input');if(input){if(on){if(!input.dataset.musicPrev)input.dataset.musicPrev=input.placeholder||'';input.placeholder=MUSIC_PLACEHOLDER;}else if(input.dataset.musicPrev!==undefined&&input.placeholder===MUSIC_PLACEHOLDER){input.placeholder=input.dataset.musicPrev;delete input.dataset.musicPrev;}}
    if(!list)return;if(on){card=card||buildCard();if(card.nextElementSibling!==list||!card.isConnected)list.before(card);card.hidden=false;}else if(card)card.hidden=true;}
  function decorateRow(node,message){if(!message.command_result)return node;const reply=el('div','music-reply');reply.append(el('span','music-reply-tag','Ouvir juntos'),el('span','music-reply-text',message.command_result));(node.querySelector('.message-content')||node).append(reply);return node;}
  // Intercepta o envio: texto comum não sai do navegador (o banco também recusa).
  function guard(event){if(!isMusicChannel(state().selected)||state().home)return;const input=document.getElementById('message-input'),value=input.value.trim();if(!value)return;const r=checkMusicMessage(value);if(!r.ok){event.preventDefault();event.stopImmediatePropagation();toast(r.error);}}
  async function execute(message,channel){if(!isMusicChannel(channel)||done.has(message.id)||message.command_result)return;done.add(message.id);const {db}=state();
    let result=callScope(state(),channel);if(!result){try{result=String(await watchCommand(message.content)||'Feito.');}catch(e){result=e?.message||'Não foi possível executar o comando.';}}
    result=result.slice(0,400);try{await checked(db.from('messages').update({command_result:result}).eq('id',message.id).select('id'));}catch(e){toast(result);}return result;}
  return {sync,decorateRow,guard,execute};
}
