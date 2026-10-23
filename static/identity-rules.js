// Regras do @ (username) e do nickname (display_name), espelhando o banco.
export const HANDLE_RE=/^[a-z0-9_]{3,24}$/;
export const RESERVED=new Set(['admin','adm','administrador','root','suporte','support','orbita','sistema','system','moderador','moderacao','mod','staff','equipe','oficial','official','null','undefined','everyone','here','todos','api','www','help','ajuda','dono','owner','seguranca','security']);
export function handleProblem(v){v=String(v||'').trim().toLowerCase();if(!HANDLE_RE.test(v))return 'invalid';if(RESERVED.has(v))return 'reserved';return '';}
export function nicknameProblem(v){v=String(v||'').trim();if(!v)return 'O nickname não pode ficar vazio.';if([...v].length>32)return 'Use até 32 caracteres.';if(/[\u0000-\u001f\u007f-\u009f]/.test(v))return 'Remova caracteres de controle.';return '';}
