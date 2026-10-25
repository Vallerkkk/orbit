import test from 'node:test';
import assert from 'node:assert/strict';
import {createDmUnread} from '../static/dm-unread.js';

function node(tag,className,text=''){
  return {tag,className,textContent:text,children:[],dataset:{},attrs:{},hidden:false,parentElement:null,previousElementSibling:null,
    setAttribute(key,value){this.attrs[key]=value;},
    append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}},
    replaceChildren(...items){this.children=items;for(const item of items)item.parentElement=this;},
    after(item){const parent=this.parentElement;if(!parent)return;if(!parent.children.includes(item))parent.children.push(item);item.parentElement=parent;item.previousElementSibling=this;}};
}

function harness(){
  const root=node('div','root'),home=node('aside','home');
  home.parentElement=root;root.children.push(home);
  let countsResolve,readResolve;
  const calls=[];
  const db={rpc(name,args){
    calls.push({name,args});
    if(name==='dm_unread_counts')return new Promise(resolve=>{countsResolve=resolve;});
    if(name==='mark_conversation_read')return new Promise(resolve=>{readResolve=resolve;});
    return Promise.resolve({data:null,error:null});
  }};
  const ctx={el:node,person:id=>({id,display_name:'Pessoa '+id}),setAvatar(){},isOpen:()=>false,home:()=>home,open(){},me:()=>({id:'me'}),db:()=>db};
  return {unread:createDmUnread(ctx),calls,counts:payload=>countsResolve(payload),read:payload=>readResolve(payload)};
}

test('resposta de contagem anterior ao mark-read não restaura o badge',async()=>{
  const {unread,calls,counts,read}=harness();
  const loading=unread.load();
  const marking=unread.markRead('c1');
  assert.deepEqual(unread.rows,[]);
  counts({data:[{conversation_id:'c1',other_id:'u2',unread:3}],error:null});
  await loading;
  assert.deepEqual(unread.rows,[]);
  assert.equal(calls.filter(c=>c.name==='mark_conversation_read').length,1);
  read({data:null,error:null});
  await marking;
  unread.reset();
});

test('contagem carregada durante o mark-read ignora a conversa pendente e mantém as demais',async()=>{
  const {unread,counts,read}=harness();
  const marking=unread.markRead('c1');
  const loading=unread.load();
  counts({data:[{conversation_id:'c1',other_id:'u2',unread:3},{conversation_id:'c2',other_id:'u3',unread:1}],error:null});
  await loading;
  assert.deepEqual(unread.rows.map(r=>r.conversation_id),['c2']);
  read({data:null,error:null});
  await marking;
  unread.reset();
});

test('marcar a mesma conversa duas vezes faz um único RPC e nenhuma volta o badge',async()=>{
  const {unread,calls,read}=harness();
  const first=unread.markRead('c1');
  const second=unread.markRead('c1');
  await Promise.resolve();
  assert.equal(calls.filter(c=>c.name==='mark_conversation_read').length,1);
  read({data:null,error:null});
  await Promise.all([first,second]);
  assert.deepEqual(unread.rows,[]);
  unread.reset();
});
