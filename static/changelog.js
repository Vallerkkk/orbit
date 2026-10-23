import NOTES from './release-notes.json' with {type:'json'};
// Novidades da Órbita. Texto curado: static/changelog-overrides.json ou trailer "Novidade: ..." no commit.
// Categorias: visual, chamadas, chat, feed, perfil, audio, correcoes.
export const CHANGELOG_CATEGORIES={
  visual:{label:'Visual',icon:'<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.7-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'},
  chamadas:{label:'Chamadas',icon:'<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>'},
  chat:{label:'Chat',icon:'<path d="M4 5h16v11H9l-5 4z"/>'},
  feed:{label:'Feed',icon:'<path d="M4 5h16M4 12h16M4 19h10"/>'},
  perfil:{label:'Perfil',icon:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'},
  audio:{label:'Áudio',icon:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'},
  loja:{label:'Loja',icon:'<path d="M4 8h16l-1.5 11a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'},
  adm:{label:'Administração',icon:'<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/>'},
  correcoes:{label:'Correções',icon:'<path d="M20 6 9 17l-5-5"/>'}
};
// As versões vêm de release-notes.json, gerado no build a partir do git (scripts/release-notes.mjs).
export const CHANGELOG=(NOTES.releases||[]).filter(r=>r&&r.version&&Array.isArray(r.highlights));
export const CHANGELOG_SEEN_KEY='orbita-changelog-seen';
export const latestChangelog=()=>CHANGELOG[0];
export function changelogUnseen(storage=globalThis.localStorage){try{return !!CHANGELOG[0]&&storage?.getItem(CHANGELOG_SEEN_KEY)!==CHANGELOG[0].version;}catch{return false;}}
export function markChangelogSeen(storage=globalThis.localStorage){try{if(CHANGELOG[0])storage?.setItem(CHANGELOG_SEEN_KEY,CHANGELOG[0].version);}catch{}}
