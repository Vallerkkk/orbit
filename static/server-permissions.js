// Espelha o RLS: só o dono do servidor e os ADMs globais (site_roles creator/admin)
// editam os dados/configurações do servidor. Cargos dão ferramentas específicas.
const SITE_ADMIN_ROLES=new Set(['creator','admin']);
export function isSiteAdmin(siteRoles,userId){return !!userId&&(siteRoles||[]).some(r=>r.user_id===userId&&SITE_ADMIN_ROLES.has(r.role));}
export function isCommunityOwner(community,userId){return !!userId&&!!community&&community.created_by===userId;}
export function canEditServer({siteRoles,community,userId}){return isSiteAdmin(siteRoles,userId)||isCommunityOwner(community,userId);}
export function hasServerPermission({siteRoles,community,userId,memberRoles,roles,permission}){
  if(canEditServer({siteRoles,community,userId}))return true;
  if(!userId||!community)return false;
  const mine=new Set((memberRoles||[]).filter(m=>m.user_id===userId&&(!m.community_id||m.community_id===community.id)).map(m=>m.role_id));
  return (roles||[]).some(r=>mine.has(r.id)&&(!r.community_id||r.community_id===community.id)&&(r.permissions||[]).includes(permission));
}
