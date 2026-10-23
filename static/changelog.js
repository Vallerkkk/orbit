// Novidades da Órbita — edite aqui. A versão mais recente fica primeiro.
// Categorias: visual, chamadas, chat, feed, perfil, audio, correcoes.
export const CHANGELOG_CATEGORIES={
  visual:{label:'Visual',icon:'<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.7-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'},
  chamadas:{label:'Chamadas',icon:'<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>'},
  chat:{label:'Chat',icon:'<path d="M4 5h16v11H9l-5 4z"/>'},
  feed:{label:'Feed',icon:'<path d="M4 5h16M4 12h16M4 19h10"/>'},
  perfil:{label:'Perfil',icon:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'},
  audio:{label:'Áudio',icon:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'},
  correcoes:{label:'Correções',icon:'<path d="M20 6 9 17l-5-5"/>'}
};
export const CHANGELOG=[{
  version:'2026.10.22',date:'22 out 2026',
  highlights:[
    ['chamadas','Vídeo nítido nas chamadas: câmera e tela sem borrão'],
    ['chamadas','Ouvir juntos com player grande e controles próprios'],
    ['feed','Feed com nova barra de publicação e Novidades'],
    ['visual','Visual novo em todo o app, com configurações em abas']
  ],
  items:{
    visual:['Redesign geral do app: chat, canais, barra lateral e janelas','Configurações organizadas em abas','Ícones de "ao vivo" na lista de salas de voz'],
    chamadas:['Barra de controles flutuante na chamada (microfone, câmera, tela, Ouvir juntos, Mais, Sair)','Decorações do seu perfil aparecem no seu cartão da chamada','Ouvir juntos repaginado: player grande 16:9, fila com capa e quem adicionou, controles próprios e qualidade'],
    chat:['O envio de mensagens voltou a funcionar de forma confiável'],
    feed:['Feed novo, com abas Para você, Seguindo, Em alta e Salvos','Painel "Ao vivo agora" com as salas abertas','Barra de publicação mais limpa, com ícones','Stories saíram do feed','Esta área de Novidades'],
    perfil:['Decorações de perfil com quadros e efeitos animados','Fotos de perfil exibidas corretamente'],
    audio:['Filtro de ruído e medidor do microfone nas configurações de voz','Sons sutis e animações nos controles da chamada'],
    correcoes:['Vídeo da câmera e da tela não fica mais borrado ou escurecido','"Sobre você" atualizado aparece para todo mundo','Decorações não cobrem mais o vídeo das chamadas']
  }
}];
export const CHANGELOG_SEEN_KEY='orbita-changelog-seen';
export const latestChangelog=()=>CHANGELOG[0];
export function changelogUnseen(storage=globalThis.localStorage){try{return storage?.getItem(CHANGELOG_SEEN_KEY)!==CHANGELOG[0].version;}catch{return false;}}
export function markChangelogSeen(storage=globalThis.localStorage){try{storage?.setItem(CHANGELOG_SEEN_KEY,CHANGELOG[0].version);}catch{}}
