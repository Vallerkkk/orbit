// Catálogo de insígnias da Órbita: fonte única da apresentação e dos requisitos.
// scripts/badges-sql.mjs gera a tabela badge_catalog da migration a partir deste arquivo;
// a concessão e o progresso são calculados SOMENTE no banco (public.badge_state).
export const LEVELS=[
  {id:'iniciante',name:'Iniciante',color:'#9aa4b8'},{id:'bronze',name:'Bronze',color:'#d27a3e'},{id:'prata',name:'Prata',color:'#c8d0dc'},{id:'ouro',name:'Ouro',color:'#f2b632'},
  {id:'platina',name:'Platina',color:'#4fc3c9'},{id:'diamante',name:'Diamante',color:'#8b6cff'},{id:'esmeralda',name:'Esmeralda',color:'#2fbf71'},{id:'rubi',name:'Rubi',color:'#e9435f'}];
export const RARITIES={comum:{name:'Comum',color:'#9aa4b8'},rara:{name:'Rara',color:'#5b8cff'},epica:{name:'Épica',color:'#b46cff'},lendaria:{name:'Lendária',color:'#f2b632'},exclusiva:{name:'Exclusiva',color:'#ff4f9a'}};
export const CATEGORIES={inicio:'Para todos',tempo:'Tempo de uso',chat:'Chat',voz:'Voz e chamadas',feed:'Feed',social:'Social',estilo:'Personalização',eventos:'Eventos e sazonais',secretas:'Raras e secretas',exclusivas:'Exclusivas'};
// unit: texto do requisito. t: limites por nível (1 = só desbloqueio). anim: animação da arte.
const B=(id,name,cat,metric,t,rarity,glyph,hue,unit,anim='pulse',extra={})=>({id,name,cat,metric,t,rarity,glyph,hue,unit,anim,...extra});
export const BADGES=[
  B('boas-vindas','Boas-vindas','inicio','account',[1],'comum','wave',265,'Criar sua conta'),
  B('fundador','Membro fundador','inicio','founder',[1],'lendaria','rocket',290,'Conta criada na fase beta','orbit'),
  B('beta','Testador beta','inicio','founder',[1],'epica','flask',200,'Participar do beta da Órbita','bubble'),
  B('primeiro-passo','Primeiro passo','inicio','messages',[1],'comum','foot',160,'Enviar a primeira mensagem'),
  B('veterano','Veterano','tempo','join_days',[1,30,90,180,365,730,1095,1825],'rara','calendar',30,'dias de conta','spin'),
  B('sequencia','Em chamas','tempo','streak',[2,7,14,30,60,100,200,365],'epica','flame',15,'dias seguidos','flame'),
  B('primeiro-dia','Primeiro dia','tempo','active_days',[1],'comum','sun',45,'Usar a Órbita num dia'),
  B('semana','Uma semana','tempo','active_days',[7],'comum','week',55,'7 dias de uso'),
  B('mes','Um mês','tempo','active_days',[30],'rara','moon',230,'30 dias de uso','orbit'),
  B('tagarela','Tagarela','chat','messages',[10,100,500,1000,5000,10000,25000,50000],'rara','chat',265,'mensagens enviadas'),
  B('reator','Reator','chat','reactions',[10,50,200,500,1000,2500,5000,10000],'comum','heart',340,'reações dadas'),
  B('mencionado','Popular no chat','chat','mentions',[1,10,50,100,250,500,1000,2500],'rara','at',190,'menções recebidas'),
  B('gifeiro','Gifeiro','chat','gifs',[1,10,50,100,250,500,1000,2000],'comum','gif',310,'GIFs enviados','glitch'),
  B('colecionador-figurinhas','Figurinhas','chat','stickers',[1,10,50,100,250,500,1000,2000],'comum','sticker',50,'figurinhas enviadas','bounce'),
  B('respondao','Respondão','chat','replies',[5,50,200,500,1000,2500,5000,10000],'comum','reply',175,'respostas a mensagens'),
  B('enquete','Pesquisador','chat','polls',[1,5,20,50,100,200,350,500],'rara','poll',95,'enquetes criadas'),
  B('arquivista','Arquivista','chat','attachments',[1,10,50,100,250,500,1000,2000],'comum','clip',210,'arquivos enviados'),
  B('editor','Revisor','chat','edits',[1,10,50,100,250,500,1000,2500],'comum','pencil',120,'mensagens editadas'),
  B('voz-ativa','Voz ativa','voz','call_minutes',[10,60,300,600,1500,3000,6000,12000],'rara','mic',275,'minutos em chamada','wave'),
  B('primeira-chamada','Alô?','voz','call_minutes',[1],'comum','phone',150,'Entrar numa chamada'),
  B('telao','Telão','voz','screenshare',[1,5,20,50,100,200,400,800],'rara','screen',205,'minutos compartilhando tela','scan'),
  B('camera','Na câmera','voz','camera',[1,10,60,300,600,1500,3000,6000],'comum','camera',350,'minutos com câmera'),
  B('ouvir-juntos','Ouvir juntos','voz','watch_party',[1,5,15,30,60,120,250,500],'epica','headphones',300,'sessões de Ouvir juntos','eq'),
  B('maratonista','Maratonista','voz','long_call',[1],'epica','hourglass',25,'Ficar 3 horas numa chamada'),
  B('autor','Autor','feed','posts',[1,10,50,100,250,500,1000,2500],'rara','quill',35,'publicações no feed'),
  B('curtido','Curtido','feed','likes_received',[1,25,100,500,1000,5000,10000,50000],'epica','star',48,'curtidas recebidas','sparkle'),
  B('seguido','Influente','feed','followers',[1,10,50,100,500,1000,5000,10000],'lendaria','crown',42,'seguidores','shine'),
  B('repostado','Viral','feed','reposts_received',[1,10,50,100,250,500,1000,5000],'epica','repost',140,'reposts recebidos','spin'),
  B('primeira-publicacao','Primeira publicação','feed','posts',[1],'comum','post',20,'Publicar no feed'),
  B('seguidor','Curioso','feed','following',[1,10,50,100,250,500,750,1000],'comum','eye',185,'perfis seguidos'),
  B('amigavel','Amigável','social','friends',[1,5,10,25,50,100,200,500],'rara','handshake',130,'amizades'),
  B('papo-reto','Papo reto','social','dms',[1,25,100,500,1000,5000,10000,25000],'comum','envelope',220,'mensagens diretas'),
  B('construtor','Construtor','social','communities_created',[1,2,3,5,8,12,16,20],'epica','castle',260,'servidores criados','bounce'),
  B('explorador','Explorador','social','communities_joined',[1,3,5,10,20,35,50,100],'comum','compass',170,'servidores em que entrou','spin'),
  B('conversas','Rede de contatos','social','conversations',[1,5,10,25,50,100,150,250],'comum','users',240,'conversas privadas'),
  B('estiloso','Estiloso','estilo','decorations',[1,2,3,4,5,6,7,8],'rara','brush',320,'itens de personalização equipados','shine'),
  B('perfil-completo','Perfil completo','estilo','profile_complete',[4],'epica','idcard',280,'Bio, pronomes, avatar e banner preenchidos'),
  B('bio','Sobre mim','estilo','has_bio',[1],'comum','quote',100,'Escrever o “Sobre você”'),
  B('avatar','Rosto novo','estilo','has_avatar',[1],'comum','portrait',10,'Enviar um avatar'),
  B('banner','Capa nova','estilo','has_banner',[1],'comum','image',200,'Enviar um banner'),
  B('fonte','Tipógrafo','estilo','has_font',[1],'rara','type',300,'Usar uma fonte no nome'),
  B('halloween','Halloween','eventos','halloween',[1,10,50,100,200,300,400,500],'epica','pumpkin',28,'mensagens no Halloween (25/10–02/11)','flicker'),
  B('natal','Natal','eventos','natal',[1,10,50,100,200,300,400,500],'epica','tree',140,'mensagens no Natal (20–26/12)','sparkle'),
  B('ano-novo','Ano-novo','eventos','ano_novo',[1],'lendaria','firework',50,'Mandar mensagem na virada (31/12–01/01)','burst'),
  B('carnaval','Carnaval','eventos','carnaval',[1,10,50,100,200,300,400,500],'rara','mask',320,'mensagens em fevereiro','bounce'),
  B('junina','Festa junina','eventos','junina',[1,10,50,100,200,300,400,500],'rara','bonfire',30,'mensagens em junho','flame'),
  B('dia-orbita','Aniversário da Órbita','eventos','orbita_day',[1],'lendaria','cake',330,'Estar na Órbita em 19/10','orbit'),
  B('ferias','Férias','eventos','ferias',[1,25,100,250,500,750,1000,2000],'comum','palm',165,'mensagens em janeiro e julho'),
  B('coruja','Coruja','secretas','night',[1,10,50,100,250,500,1000,2000],'epica','owl',235,'mensagens entre 2h e 5h','flicker',{secret:true}),
  B('madrugador','Madrugador','secretas','early',[1,10,50,100,250,500,1000,2000],'rara','rooster',40,'mensagens entre 5h e 7h','pulse',{secret:true}),
  B('fim-de-semana','Fim de semana','secretas','weekend',[10,50,100,250,500,1000,2500,5000],'rara','couch',205,'mensagens no sábado e domingo','pulse',{secret:true}),
  B('enciclopedia','Enciclopédia','secretas','long_message',[1,10,25,50,100,200,350,500],'epica','book',90,'mensagens com mais de 1.000 caracteres','pulse',{secret:true}),
  B('fixador','Curador','secretas','pinned',[1,5,10,25,50,100,150,250],'rara','pin',0,'mensagens suas fixadas','pulse',{secret:true}),
  B('emoji-mestre','Mestre dos emojis','secretas','emoji_variety',[5,10,20,30,40,50,75,100],'lendaria','smile',55,'emojis diferentes usados em reações','spin',{secret:true}),
  B('pioneiro','Pioneiro','secretas','early_member',[1],'lendaria','flag',0,'Estar entre as 100 primeiras contas','shine',{secret:true}),
  B('constelacao','Constelação','secretas','all_categories',[1,2,3,4,5,6,7,8],'lendaria','constellation',250,'categorias com ao menos uma insígnia','orbit',{secret:true}),
  B('eco','Eco','secretas','threads',[1,10,25,50,100,200,350,500],'rara','echo',180,'threads iniciadas','wave',{secret:true}),
  B('anfitriao','Anfitrião','secretas','invites',[1,5,10,25,50,100,200,500],'epica','door',30,'convites criados','pulse',{secret:true}),
  B('adm','Guardião da Órbita','exclusivas','admin',[1],'exclusiva','shield',275,'Ser administrador global do app','shine',{exclusive:'admin'}),
  B('criador','Criadores','exclusivas','creator',[1],'exclusiva','spark',300,'Fazer parte da equipe criadora','orbit',{exclusive:'creator'}),
  B('dono','Dono da Órbita','exclusivas','owner',[1],'exclusiva','crownstar',45,'Insígnia permanente do dono','burst',{exclusive:'owner'}),
];
// Descrição curta (até ~60 caracteres) mostrada no tooltip de cada insígnia.
export const DESC={
'boas-vindas':'Criou a conta e chegou à Órbita.',
'fundador':'Esteve aqui desde a fase beta da Órbita.',
'beta':'Ajudou a testar a Órbita durante o beta.',
'primeiro-passo':'Enviou a primeira mensagem no chat.',
'veterano':'Acumula dias de conta na Órbita.',
'sequencia':'Volta à Órbita vários dias seguidos.',
'primeiro-dia':'Usou a Órbita pela primeira vez.',
'semana':'Completou 7 dias de uso da Órbita.',
'mes':'Completou 30 dias de uso da Órbita.',
'tagarela':'Não para de conversar: muitas mensagens enviadas.',
'reator':'Reage às mensagens da galera com emojis.',
'mencionado':'É lembrado: recebe muitas menções no chat.',
'gifeiro':'Responde tudo com o GIF certo.',
'colecionador-figurinhas':'Manda figurinhas nas conversas.',
'respondao':'Sempre responde às mensagens dos outros.',
'enquete':'Cria enquetes para ouvir a comunidade.',
'arquivista':'Compartilha arquivos e anexos no chat.',
'editor':'Revisa e edita as próprias mensagens.',
'voz-ativa':'Passa bastante tempo em chamadas de voz.',
'primeira-chamada':'Entrou numa chamada pela primeira vez.',
'telao':'Compartilha a tela durante as chamadas.',
'camera':'Liga a câmera nas chamadas.',
'ouvir-juntos':'Assiste e ouve conteúdo junto com a galera.',
'maratonista':'Ficou 3 horas seguidas numa chamada.',
'autor':'Publica posts no feed da Órbita.',
'curtido':'Os posts recebem muitas curtidas.',
'seguido':'Tem muitos seguidores no feed.',
'repostado':'Os posts são repostados pela comunidade.',
'primeira-publicacao':'Fez a primeira publicação no feed.',
'seguidor':'Segue outros perfis para acompanhar o feed.',
'amigavel':'Faz amizades dentro da Órbita.',
'papo-reto':'Conversa bastante por mensagem direta.',
'construtor':'Criou servidores para a comunidade.',
'explorador':'Entra em servidores para conhecer gente.',
'conversas':'Mantém conversas diretas com muitas pessoas.',
'estiloso':'Usa itens de personalização no perfil.',
'perfil-completo':'Bio, pronomes, avatar e banner preenchidos.',
'bio':'Escreveu o “Sobre você” no perfil.',
'avatar':'Enviou uma foto de avatar.',
'banner':'Enviou um banner para o perfil.',
'fonte':'Usa uma fonte especial no nome.',
'halloween':'Conversou durante o Halloween.',
'natal':'Mandou mensagens no Natal.',
'ano-novo':'Mandou mensagem na virada do ano.',
'carnaval':'Conversou durante o Carnaval.',
'junina':'Conversou durante as festas juninas.',
'dia-orbita':'Estava na Órbita no aniversário dela.',
'ferias':'Conversou nas férias de janeiro e julho.',
'coruja':'Manda mensagens de madrugada.',
'madrugador':'Conversa bem cedinho, antes de todo mundo.',
'fim-de-semana':'Aparece no chat nos fins de semana.',
'enciclopedia':'Escreve mensagens longas e detalhadas.',
'fixador':'Teve mensagens fixadas no canal.',
'emoji-mestre':'Usa uma enorme variedade de emojis.',
'pioneiro':'Está entre as 100 primeiras contas.',
'constelacao':'Tem insígnias de todas as categorias.',
'eco':'Inicia threads que movimentam a conversa.',
'anfitriao':'Cria convites e traz gente nova.',
'adm':'Administrador global da Órbita.',
'criador':'Faz parte da equipe que cria a Órbita.',
'dono':'Insígnia permanente do dono da Órbita.'};
export const badgeDesc=id=>DESC[id]||'';
export const badgeById=new Map(BADGES.map(b=>[b.id,b]));
// Glifos SVG (24x24), um por insígnia.
const G={wave:'M4 14c2-6 4-6 6 0s4 6 6 0 3-4 4-2',rocket:'M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2zM9 15l-3 4 4-1M15 15l3 4-4-1M12 8a1.5 1.5 0 1 0 0 .1',flask:'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8',foot:'M8 4c2 0 3 2 3 5s-1 4-3 4-3-2-3-5 1-4 3-4zM15 11c2 0 3 2 3 4s-1 4-3 4-2-2-2-4 0-4 2-4z',calendar:'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h3v3H8z',flame:'M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z',sun:'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',week:'M3 8h18v11H3zM6 12h2M10 12h2M14 12h2M6 15h2M10 15h2M14 15h2M18 12h0',moon:'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',chat:'M4 5h16v11H9l-5 4z',heart:'M12 20s-8-5-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-8 11-8 11z',at:'M16 12a4 4 0 1 1-1-3v4a2 2 0 0 0 4 0 8 8 0 1 0-3 6',gif:'M3 6h18v12H3zM9 10H7v4h2v-2M12 10v4M15 14v-4h2M15 12h2',sticker:'M5 4h10l4 4v11H5zM15 4v4h4M9 13a3 3 0 0 0 6 0',reply:'M10 8V4L3 11l7 7v-4c5 0 8 1 11 5-1-6-4-11-11-11z',poll:'M5 20V10M10 20V4M15 20v-7M20 20v-4',clip:'M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7',pencil:'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',mic:'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',phone:'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z',screen:'M3 4h18v12H3zM8 20h8M12 16v4M9 10l3-3 3 3M12 7v6',camera:'M3 7h12v10H3zM15 10l6-3v10l-6-3',headphones:'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',hourglass:'M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9',quill:'M20 4C10 4 6 10 5 19l2-2c2-1 5-2 7-5-2 0-3 0-4-1 3 0 5-1 6-3-2 0-3 0-3-1 3 0 5-2 7-3z',star:'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',crown:'M3 8l4 4 5-7 5 7 4-4-2 11H5zM5 19h14',repost:'M4 9h13l-3-3M20 15H7l3 3',post:'M5 3h10l4 4v14H5zM8 11h8M8 15h8M8 7h4',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',handshake:'M2 11l4-4 4 2 3-2 4 1 5 3-4 5-3-2-3 3-3-2-3 1z',envelope:'M3 6h18v12H3zM3 6l9 7 9-7',castle:'M4 21V9h3V6h2v3h2V6h2v3h2V6h2v3h3v12zM10 21v-5h4v5',compass:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9l-2 5-4 1 2-5z',users:'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-4 3-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M18 14c2 1 3 3 3 6',brush:'M14 4l6 6-8 8-6-6zM6 12c-3 1-3 4-3 8 4 0 7 0 8-3',idcard:'M3 5h18v14H3zM9 10a2 2 0 1 0 0 .1M6 16c0-2 2-3 3-3s3 1 3 3M14 9h4M14 13h4',quote:'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6',portrait:'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-5 4-7 8-7s8 2 8 7',image:'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M16 9a1.5 1.5 0 1 0 0 .1',type:'M4 6V4h16v2M12 4v16M9 20h6',pumpkin:'M12 6c5 0 8 3 8 7s-3 7-8 7-8-3-8-7 3-7 8-7zM12 6V3M9 12l1 1M14 12l1 1M9 16h6',tree:'M12 2l5 7h-3l4 6h-3l3 4H6l3-4H6l4-6H7zM12 19v3',firework:'M12 12l0-9M12 12l7-5M12 12l8 3M12 12l3 8M12 12l-4 8M12 12l-8 2M12 12l-6-6',mask:'M3 7c5-2 13-2 18 0 0 7-3 11-9 11S3 14 3 7zM8 11h2M14 11h2',bonfire:'M12 4c3 3 4 5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-5 0 2 1 3 2 3 0-2-1-4 0-6zM4 20l16-3M4 17l16 3',cake:'M4 13h16v8H4zM4 16c3 2 5-2 8 0s5 2 8 0M12 6v7M12 3l1 2-1 1-1-1z',palm:'M12 21V10M12 10c-2-4-6-5-9-4 3 0 6 1 9 4zM12 10c2-4 6-5 9-4-3 0-6 1-9 4zM12 10c-1-4 0-7 3-8',owl:'M5 9l2-5 3 3h4l3-3 2 5v6a7 7 0 0 1-14 0zM9 11a1.5 1.5 0 1 0 0 .1M15 11a1.5 1.5 0 1 0 0 .1M11 15h2',rooster:'M8 20c-3-3-3-8 0-11 0-3 2-5 4-5l1 2 2-1-1 3 3 2-3 1c2 3 2 6 0 9zM8 20h8',couch:'M3 11h18v7H3zM5 11V7h14v4M5 18v2M19 18v2',book:'M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-7v16a2 2 0 0 1 2-2h5z',pin:'M9 3h6l-1 6 3 3H7l3-3zM12 12v9',smile:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14c2 3 6 3 8 0M9 9h0M15 9h0',flag:'M5 21V4M5 4h11l-2 4 2 4H5',constellation:'M4 18l5-7 5 3 6-9M4 18h.1M9 11h.1M14 14h.1M20 5h.1',echo:'M4 12a8 8 0 0 1 8-8M8 12a4 4 0 0 1 4-4M12 12h.1M20 12a8 8 0 0 1-8 8M16 12a4 4 0 0 1-4 4',door:'M6 21V3h10v18M16 21h3M13 12h.1M6 21H4',shield:'M12 3l8 3v6c0 5-3 8-8 9-5-1-8-4-8-9V6zM9 12l2 2 4-4',spark:'M12 2l2 7 7 3-7 3-2 7-2-7-7-3 7-3z',crownstar:'M3 9l4 3 5-7 5 7 4-3-2 10H5zM12 11l1 2h2l-1.5 1.5.5 2-2-1-2 1 .5-2L9 13h2z'};
// Arte premium: emblema por categoria, metal por nível, raridade no acabamento.
const pt=(r,a)=>[32+r*Math.sin(a),32-r*Math.cos(a)];
const poly=(n,r,rot=0)=>'M'+Array.from({length:n},(_,i)=>pt(r,rot+i*2*Math.PI/n).map(v=>v.toFixed(2)).join(' ')).join('L')+'Z';
const starP=(n,r1,r2,rot=0)=>'M'+Array.from({length:n*2},(_,i)=>pt(i%2?r2:r1,rot+i*Math.PI/n).map(v=>v.toFixed(2)).join(' ')).join('L')+'Z';
const flower=(n,r,b)=>'M'+Array.from({length:n*8},(_,i)=>{const a=i*2*Math.PI/(n*8);return pt(r-b+b*Math.cos(a*n),a).map(v=>v.toFixed(2)).join(' ');}).join('L')+'Z';
const SHAPES={
  inicio:'M32 4a28 28 0 1 0 .01 0Z',
  tempo:poly(6,29,0),
  chat:'M32 4C46 4 58 8 58 8v24c0 15-11 24-26 28C17 56 6 47 6 32V8s12-4 26-4Z',
  voz:poly(8,29,Math.PI/8),
  feed:'M32 3 60 32 32 61 4 32Z',
  social:'M32 3l25 9v18c0 16-11 27-25 31C18 57 7 46 7 30V12Z',
  estilo:flower(10,29,3.2),
  eventos:starP(10,30,24),
  secretas:'M32 3 56 22 46 59H18L8 22Z',
  exclusivas:'M32 2l8 7 11-2 2 11 7 8-5 10 1 11-11 4-6 9-7-5-7 5-6-9-11-4 1-11-5-10 7-8 2-11 11 2Z'};
// Metal por nível: [claro, médio, escuro, reflexo].
const METAL=[['#e6e9f0','#9aa4b8','#4b5263','#ffffff'],['#ffd0a8','#d27a3e','#6b3414','#fff1e0'],['#ffffff','#c8d0dc','#6d7685','#ffffff'],['#fff4b8','#f2b632','#8a5a00','#fffbe6'],['#d9fbff','#4fc3c9','#16676d','#ffffff'],['#e9e2ff','#8b6cff','#3b2a99','#ffffff'],['#c8ffe1','#2fbf71','#0d5a31','#effff6'],['#ffc6cf','#e9435f','#7a0f22','#fff0f2']];
let artSeq=0;
export function badgeSvg(badge,level=1,{locked=false,size=48}={}){const b=typeof badge==='string'?badgeById.get(badge):badge;if(!b)return '';
  const lv=Math.max(0,Math.min(7,level-1)),m=b.t.length>1||b.rarity==='comum'?METAL[lv]:METAL[{rara:4,epica:5,lendaria:3,exclusiva:7}[b.rarity]||lv],u='b'+(++artSeq),shape=SHAPES[b.cat]||SHAPES.inicio,r=b.rarity,holo=!locked&&(r==='exclusiva'||b.id==='dono'),small=size<30;
  const h=b.hue,core1=`hsl(${h} 80% 62%)`,core2=`hsl(${(h+35)%360} 75% 30%)`;
  const label=`${b.name}${locked?' (bloqueada)':''}`;
  if(locked)return `<svg class="badge-art badge-locked" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${label}"><defs><linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3848"/><stop offset="1" stop-color="#1b1a24"/></linearGradient></defs><path d="${shape}" fill="url(#${u}s)" stroke="#4d4a5e" stroke-width="1.5"/><path d="${shape}" transform="translate(32 32) scale(.84) translate(-32 -32)" fill="none" stroke="#ffffff10" stroke-width="1.2"/>${small?'':`<g transform="translate(32 33)"><rect x="-8" y="-3" width="16" height="12" rx="3" fill="#8f8aa6"/><path d="M-5-3v-4a5 5 0 0 1 10 0v4" fill="none" stroke="#8f8aa6" stroke-width="2.4" stroke-linecap="round"/><circle cy="2.5" r="1.6" fill="#2a2836"/></g>`}</svg>`;
  const sparks=r==='epica'||r==='lendaria'||holo?[[12,14],[52,12],[56,44],[9,46],[32,5]].map(([x,y],i)=>`<path class="bx-spark" style="animation-delay:${i*.45}s" d="M${x} ${y-2.6}L${x+.8} ${y-.8} ${x+2.6} ${y} ${x+.8} ${y+.8} ${x} ${y+2.6} ${x-.8} ${y+.8} ${x-2.6} ${y} ${x-.8} ${y-.8}Z" fill="${m[3]}"/>`).join(''):'';
  return `<svg class="badge-art bx-${r}${holo?' bx-holo':''} badge-anim-${b.anim}" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${label}" style="--bx-glow:${m[1]}">
<defs>
<linearGradient id="${u}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${m[0]}"/><stop offset=".45" stop-color="${m[1]}"/><stop offset=".55" stop-color="${m[2]}"/><stop offset=".8" stop-color="${m[1]}"/><stop offset="1" stop-color="${m[0]}"/></linearGradient>
<linearGradient id="${u}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m[2]}"/><stop offset="1" stop-color="#0c0a14"/></linearGradient>
<radialGradient id="${u}c" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="${core1}"/><stop offset="1" stop-color="${core2}"/></radialGradient>
<radialGradient id="${u}g" cx=".5" cy=".18" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="${u}a" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="${m[1]}" stop-opacity=".55"/><stop offset="1" stop-color="${m[1]}" stop-opacity="0"/></radialGradient>
${holo?`<linearGradient id="${u}h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4f9a"/><stop offset=".25" stop-color="#ffd166"/><stop offset=".5" stop-color="#5ef2c2"/><stop offset=".75" stop-color="#6c8bff"/><stop offset="1" stop-color="#ff4f9a"/></linearGradient>`:''}
<clipPath id="${u}k"><path d="${shape}"/></clipPath>
</defs>
${r==='lendaria'||holo?`<circle class="bx-aura" cx="32" cy="32" r="32" fill="url(#${u}a)"/>`:''}
<ellipse cx="32" cy="60" rx="18" ry="3" fill="#000" opacity=".35"/>
<path d="${shape}" fill="url(#${u}e)" transform="translate(0 1.6)"/>
<path d="${shape}" fill="url(#${u}m)" stroke="${m[2]}" stroke-width="1.2"/>
<path d="${shape}" transform="translate(32 32) scale(.84) translate(-32 -32)" fill="url(#${u}c)" stroke="${m[0]}" stroke-width="1.4" stroke-opacity=".9"/>
${holo?`<path class="bx-holo-layer" d="${shape}" transform="translate(32 32) scale(.84) translate(-32 -32)" fill="url(#${u}h)" opacity=".38" style="mix-blend-mode:screen"/>`:''}
<path d="${shape}" transform="translate(32 32) scale(.84) translate(-32 -32)" fill="url(#${u}g)"/>
<g clip-path="url(#${u}k)">${r==='comum'?'':`<rect class="bx-shine" x="-40" y="-10" width="16" height="90" fill="#fff" opacity=".28" transform="rotate(25 32 32)"/>`}</g>
<g transform="translate(17.6 17.6) scale(1.2)"><path d="${G[b.glyph]||G.star}" fill="none" stroke="#0007" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(.4 .9)"/><path d="${G[b.glyph]||G.star}" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></g>
${sparks}
</svg>`.replace(/\n/g,'');}
