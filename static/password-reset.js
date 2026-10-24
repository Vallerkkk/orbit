// Recuperação de senha: lê o link do e-mail (hash implícito, ?code= PKCE ou token_hash) e mostra "Criar nova senha"
// no visual da tela de login. Funções puras exportadas para testes em node.
export const MIN_PASSWORD=8;
export const PENDING_KEY='orbita-reset-requested';
// ?code= sem type só conta como recuperação se este navegador pediu um link há menos de 1 hora.
export function pendingReset(storage=globalThis.localStorage){try{const at=Number(storage?.getItem(PENDING_KEY));return at>0&&Date.now()-at<3600e3;}catch{return false;}}
const TOKEN_KEYS=['access_token','refresh_token','expires_in','expires_at','token_type','type','code','token_hash','error','error_code','error_description','sb'];
export function parseRecovery(href,{pendingReset=false}={}){let url;try{url=new URL(href);}catch{return null;}
  const hash=new URLSearchParams(url.hash.replace(/^#/,'')),q=url.searchParams,get=k=>hash.get(k)??q.get(k);
  const err=get('error_code')||get('error');
  if(err&&(get('type')==='recovery'||/otp|expired|access_denied|invalid/i.test(err+' '+(get('error_description')||''))))return {kind:'error',code:err,description:(get('error_description')||'').replace(/\+/g,' ')};
  if(hash.get('access_token')&&hash.get('type')==='recovery')return {kind:'hash'};
  if(get('token_hash')&&get('type')==='recovery')return {kind:'token_hash',tokenHash:get('token_hash')};
  if(q.get('code')&&(q.get('type')==='recovery'||(pendingReset&&!q.get('type'))))return {kind:'code',code:q.get('code')};
  return null;}
// URL sem os parâmetros do token (mantém o resto, ex.: #convite=...).
export function cleanUrl(href){const url=new URL(href);for(const k of TOKEN_KEYS)url.searchParams.delete(k);
  const hash=new URLSearchParams(url.hash.replace(/^#/,''));let touched=false;for(const k of TOKEN_KEYS)if(hash.has(k)){hash.delete(k);touched=true;}
  if(touched){const rest=hash.toString();url.hash=rest?'#'+rest:'';}return url.pathname+url.search+url.hash;}
export function passwordProblem(password,confirm){if(String(password||'').length<MIN_PASSWORD)return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;if(password!==confirm)return 'As senhas não são iguais.';return '';}
export function resetErrorText(error){const m=String(error?.message||error?.code||error||'');
  if(/expired|otp_expired|invalid|not found|flow state|code verifier/i.test(m))return 'Este link de recuperação expirou ou já foi usado. Peça um novo abaixo.';
  if(/same.*password|different from the old/i.test(m))return 'Escolha uma senha diferente da atual.';
  if(/weak|at least/i.test(m))return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.';
  if(/rate|security purposes|too many/i.test(m))return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  return m||'Não foi possível concluir. Tente novamente.';}

export function initPasswordReset({$,el,db,enter,redirectTo=()=>location.origin}){
  let active=false,box;
  const card=()=>$('auth-view').querySelector('.auth-card');
  function hideLogin(hide){for(const id of ['auth-form','toggle-auth','auth-status','forgot-password'])if($(id))$(id).hidden=hide;for(const node of card().querySelectorAll('.social-login'))node.hidden=hide;const t=$('auth-title'),d=$('auth-description');if(hide){t.dataset.prev??=t.textContent;d.dataset.prev??=d.textContent;}else{if(t.dataset.prev!=null){t.textContent=t.dataset.prev;delete t.dataset.prev;}if(d.dataset.prev!=null){d.textContent=d.dataset.prev;delete d.dataset.prev;}}}
  function field(label,type,id,auto){const l=el('label','',label),wrap=el('span','pw-field'),input=el('input');input.type=type;input.id=id;input.required=true;input.autocomplete=auto;if(type==='password'){input.minLength=MIN_PASSWORD;input.placeholder='Pelo menos 8 caracteres';const eye=el('button','pw-eye','Mostrar');eye.type='button';eye.setAttribute('aria-label','Mostrar senha');eye.setAttribute('aria-pressed','false');eye.onclick=()=>{const show=input.type==='password';input.type=show?'text':'password';eye.textContent=show?'Ocultar':'Mostrar';eye.setAttribute('aria-pressed',String(show));eye.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');};wrap.append(input,eye);}else{input.placeholder='voce@exemplo.com';wrap.append(input);}l.append(wrap);return {l,input};}
  function mount(){box?.remove();box=el('div','reset-box');box.id='reset-box';card().querySelector('#auth-description').after(box);hideLogin(true);$('auth-view').hidden=false;$('app-view').hidden=true;return box;}
  function close(){box?.remove();box=null;active=false;hideLogin(false);}
  function showNewPassword(){active=true;mount();$('auth-title').textContent='Criar nova senha';$('auth-description').textContent='Escolha uma nova senha para a sua conta.';
    const form=el('form','reset-form');form.id='reset-form';const a=field('Nova senha','password','new-password','new-password'),b=field('Confirmar nova senha','password','confirm-password','new-password');
    const submit=el('button','primary','Salvar nova senha ↗');submit.type='submit';const status=el('p','muted reset-status');status.setAttribute('role','status');status.id='reset-status';
    form.append(a.l,b.l,submit);box.append(form,status);a.input.focus();
    form.onsubmit=async e=>{e.preventDefault();const problem=passwordProblem(a.input.value,b.input.value);if(problem){status.textContent=problem;status.dataset.tone='error';return;}
      submit.disabled=true;status.textContent='Salvando…';status.dataset.tone='';
      try{const {error}=await db.auth.updateUser({password:a.input.value});if(error)throw error;status.textContent='Senha alterada! Entrando…';status.dataset.tone='ok';
        const {data}=await db.auth.getSession();setTimeout(()=>{close();enter(data?.session||null);},700);}
      catch(err){status.textContent=resetErrorText(err);status.dataset.tone='error';submit.disabled=false;if(/expirou/.test(status.textContent))showRequest(status.textContent);}};}
  function showRequest(message='',email=''){active=true;mount();$('auth-title').textContent=message?'Link expirado':'Esqueci minha senha';$('auth-description').textContent=message||'Digite seu e-mail e enviaremos um link para criar uma nova senha.';
    const form=el('form','reset-form');form.id='reset-request';const f=field('E-mail','email','reset-email','email');f.input.value=email;const submit=el('button','primary','Enviar novo link ↗');submit.type='submit';
    const back=el('button','text-button','Voltar para o login');back.type='button';back.onclick=()=>close();const status=el('p','muted reset-status');status.id='reset-status';status.setAttribute('role','status');
    form.append(f.l,submit);box.append(form,status,back);f.input.focus();
    form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;status.textContent='Enviando…';status.dataset.tone='';
      try{const {error}=await db.auth.resetPasswordForEmail(f.input.value.trim(),{redirectTo:redirectTo()});if(error)throw error;try{localStorage.setItem(PENDING_KEY,String(Date.now()));}catch{}status.textContent='Pronto! Se existir uma conta com esse e-mail, o link chega em instantes. Confira também o spam.';status.dataset.tone='ok';}
      catch(err){status.textContent=resetErrorText(err);status.dataset.tone='error';}finally{submit.disabled=false;}};}
  // Chamado no boot, logo depois de criar o cliente. Devolve true quando a tela de recuperação assumiu.
  async function begin(recovery){if(!recovery)return false;try{localStorage.removeItem(PENDING_KEY);}catch{}try{history.replaceState(history.state,'',cleanUrl(location.href));}catch{}
    if(recovery.kind==='error'){showRequest(resetErrorText(recovery.description||recovery.code));return true;}
    try{if(recovery.kind==='token_hash'){const {error}=await db.auth.verifyOtp({token_hash:recovery.tokenHash,type:'recovery'});if(error)throw error;}
      else if(recovery.kind==='code'){const {error}=await db.auth.exchangeCodeForSession(recovery.code);if(error){const {data}=await db.auth.getSession();if(!data?.session)throw error;}}
      const {data}=await db.auth.getSession();if(!data?.session)throw Error('expired');showNewPassword();}
    catch(err){showRequest(resetErrorText(err));}return true;}
  return {begin,showNewPassword,showRequest,close,active:()=>active};
}
