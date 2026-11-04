import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {canEditServer,canManageServerInvites,hasServerPermission,isSiteAdmin} from '../static/server-permissions.js';
const c={id:'c1',created_by:'owner'};const site=[{user_id:'adm',role:'admin'},{user_id:'cr',role:'creator'},{user_id:'x',role:'viewer'}];
test('só dono e ADM global editam o servidor',()=>{
  assert.equal(canEditServer({siteRoles:site,community:c,userId:'owner'}),true);
  assert.equal(canEditServer({siteRoles:site,community:c,userId:'adm'}),true);
  assert.equal(canEditServer({siteRoles:site,community:c,userId:'cr'}),true);
  assert.equal(canEditServer({siteRoles:site,community:c,userId:'member'}),false);
  assert.equal(isSiteAdmin(site,'x'),false);
  assert.equal(canEditServer({siteRoles:site,community:{id:'d',created_by:null},userId:null}),false);});
test('permissão de cargo vale só no próprio servidor',()=>{
  const roles=[{id:'r1',community_id:'c1',permissions:['manage_channels']},{id:'r2',community_id:'c2',permissions:['manage_roles']}];
  const memberRoles=[{user_id:'mod',role_id:'r1',community_id:'c1'},{user_id:'mod',role_id:'r2',community_id:'c2'}];
  assert.equal(hasServerPermission({siteRoles:site,community:c,userId:'mod',memberRoles,roles,permission:'manage_channels'}),true);
  assert.equal(hasServerPermission({siteRoles:site,community:c,userId:'mod',memberRoles,roles,permission:'manage_roles'}),false);
  assert.equal(hasServerPermission({siteRoles:site,community:c,userId:'member',memberRoles,roles,permission:'manage_channels'}),false);
  assert.equal(canEditServer({siteRoles:site,community:c,userId:'mod'}),false);});
test('convite de servidor privado é exclusivo do criador',()=>{
  const roles=[{id:'r1',community_id:'c1',permissions:['create_invite']}];
  const memberRoles=[{user_id:'mod',role_id:'r1',community_id:'c1'}];
  const privateServer={id:'c1',created_by:'owner',invite_only:true};
  assert.equal(canManageServerInvites({siteRoles:site,community:privateServer,userId:'owner',memberRoles,roles}),true);
  assert.equal(canManageServerInvites({siteRoles:site,community:privateServer,userId:'adm',memberRoles,roles}),false);
  assert.equal(canManageServerInvites({siteRoles:site,community:privateServer,userId:'mod',memberRoles,roles}),false);
  const publicServer={...privateServer,invite_only:false};
  assert.equal(canManageServerInvites({siteRoles:site,community:publicServer,userId:'mod',memberRoles,roles}),true);
  assert.equal(canManageServerInvites({siteRoles:site,community:publicServer,userId:'adm',memberRoles,roles}),true);
  assert.equal(canManageServerInvites({siteRoles:site,community:publicServer,userId:'member',memberRoles,roles}),false);
});
test('app.js usa o gate na engrenagem e no formulário do servidor',()=>{
  const app=readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
  assert.match(app,/from '\.\/server-permissions\.js'/);
  assert.match(app,/function syncServerSettingsButton/);
  assert.match(app,/function openServerSettings\(\) \{\s*if\(!canEditActiveServer\(\)\)/);
  assert.match(app,/const managesCommunity=\(\)=>canEditActiveServer\(\)/);});
test('app.js restringe convites do servidor fechado e permite entrada de ADM',()=>{
  const app=readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
  assert.match(app,/import \{canEditServer,canManageServerInvites,isSiteAdmin\}/);
  assert.match(app,/const canManageActiveServerInvites=\(\)=>canManageServerInvites\(/);
  assert.match(app,/function serverStepChannels\(/);
  assert.match(app,/join_community_as_admin/);
  assert.match(app,/create_community_invite',\{target:community\.id,expires_hours:720,uses_limit:500\}/);
  assert.match(app,/list_community_invites/);
  assert.doesNotMatch(app,/hasCommunityPermission\('create_invite'\)/);
});
