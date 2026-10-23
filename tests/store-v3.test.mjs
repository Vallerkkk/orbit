import test from 'node:test';import assert from 'node:assert/strict';
globalThis.document??={};
const {ITEMS,itemById,cleanAppearance,ADMIN_ONLY}=await import('../static/cosmetics.js');
const {CLASSICS,LEGACY_DECOR}=await import('../static/store-collections.js');
const {DECORATIONS}=await import('../static/profile-decoration-catalog.js');
const fx=await import('../static/fx-engine.js').catch(()=>null);
const KINDS=['frame','effect','card_border','name_style','server'];
test('coleções clássicas têm conjunto completo, raridade e descrição',()=>{
  assert.equal(CLASSICS.length,16);
  for(const c of CLASSICS)for(const k of KINDS){const i=itemById.get(`${c.id}-${k}`);assert.ok(i?.v2&&i.classic,`${c.id}-${k}`);assert.ok(i.name&&i.desc&&i.rarity);}
});
test('ids antigos continuam válidos e viram apelidos',()=>{
  for(const p of ['cyberpunk','anime','espaco','natureza','halloween','lofi','retro','oceano','glitch','orbita-staff'])for(const k of ['frame','border','effect','server','plate'])assert.ok(itemById.get(`${p}-${k}`),`${p}-${k}`);
  const a=cleanAppearance({border:'anime-border',plate:'glitch-plate'});
  assert.equal(a.card_border,'anime-card_border');assert.equal(a.name_style,'glitch-name_style');assert.equal(a.border,'');assert.equal(a.plate,'');
  assert.ok(ADMIN_ONLY.includes('orbita-staff-card_border'));
});
test('todas as decorações antigas têm item equivalente na Loja',()=>{
  for(const d of DECORATIONS.filter(d=>(d.type==='frame'||d.type==='effect')&&d.id!=='none')){const p=LEGACY_DECOR[d.type][d.id];assert.ok(p,d.id);assert.ok(itemById.get(`${p}-${d.type}`));}
  const a=cleanAppearance({legacy_frame:'angel',legacy_effect:'snow'});assert.equal(a.frame,'divino-frame');assert.equal(a.effect,'natal-effect');
});
test('ids únicos',()=>{assert.equal(new Set(ITEMS.map(i=>i.id)).size,ITEMS.length);});
