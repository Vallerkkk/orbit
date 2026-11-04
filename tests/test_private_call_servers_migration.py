import pathlib, re, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
MIG = ROOT / 'supabase' / 'migrations' / '20261103200000_private_call_servers.sql'

class PrivateCallServersMigration(unittest.TestCase):
    def setUp(self):
        self.sql = MIG.read_text(encoding='utf-8')

    def test_definer_functions_pin_search_path(self):
        for m in re.finditer(r'create (?:or replace )?function ([\w.]+)\(.*?\$\$(.*?)\$\$', self.sql, re.S):
            self.assertIn("set search_path=''", m.group(0), m.group(1))

    def test_server_creation_can_store_invite_only(self):
        self.assertIn('grant insert(invite_only) on public.communities to authenticated', self.sql)
        policy = self.sql.split('create policy communities_read', 1)[1].split(';', 1)[0]
        self.assertIn('not invite_only', policy)
        self.assertIn('created_by=(select auth.uid())', policy)
        self.assertIn('is_community_member(id)', policy)

    def test_private_invites_belong_to_the_creator(self):
        body = self.sql.split('function orbita_private.can_manage_community_invites', 1)[1].split('$$;', 1)[0]
        self.assertIn('c.created_by=auth.uid()', body)
        self.assertIn('not c.invite_only', body)
        self.assertIn("'create_invite'=any(r.permissions)", body)
        create = self.sql.split('function orbita_private.create_community_invite', 1)[1].split('$$;', 1)[0]
        self.assertIn('can_manage_community_invites(target)', create)
        self.assertIn("errcode='42501'", create)

    def test_invites_can_be_listed_and_revoked_without_exposing_token(self):
        listing = self.sql.split('function orbita_private.list_community_invites', 1)[1].split('$$;', 1)[0]
        self.assertIn("'id',i.id", listing)
        self.assertNotIn('token_hash', listing)
        self.assertIn('function public.revoke_community_invite', self.sql)
        self.assertIn('function public.list_community_invites', self.sql)

    def test_global_admin_enters_without_invite_and_reads_channels(self):
        entry = self.sql.split('function orbita_private.join_community_as_admin', 1)[1].split('$$;', 1)[0]
        self.assertIn("r.role in('creator','admin')", entry)
        self.assertIn('on conflict do nothing', entry)
        channel = self.sql.split('function orbita_private.channel_access_for', 1)[1].split('$$;', 1)[0]
        self.assertIn("r.role in('creator','admin')", channel)
        self.assertIn('co.created_by=member', channel)

    def test_kick_requires_hierarchy_and_writes_audit(self):
        kick = self.sql.split('function orbita_private.remove_community_member', 1)[1].split('$$;', 1)[0]
        self.assertIn('moderation_allowed(target,member)', kick)
        self.assertIn("'kick'", kick)
        self.assertIn('insert into public.audit_log', kick)
        self.assertIn('create policy community_members_leave', self.sql)
        self.assertIn('using(user_id=(select auth.uid()))', self.sql)

    def test_banned_users_cannot_rejoin(self):
        for name in ('join_public_community', 'join_community_invite'):
            body = self.sql.split('function orbita_private.' + name, 1)[1].split('$$;', 1)[0]
            self.assertIn('is_banned', body, name)
        invite = self.sql.split('function orbita_private.join_community_invite', 1)[1].split('$$;', 1)[0]
        self.assertIn('added>0', invite)

    def test_no_anon_execute(self):
        self.assertIn('revoke all on function public.join_community_as_admin(uuid) from public,anon', self.sql)
        self.assertIn('revoke all on function public.list_community_invites(uuid) from public,anon', self.sql)
        self.assertIn('revoke all on function public.revoke_community_invite(uuid,uuid) from public,anon', self.sql)
        self.assertIn('revoke all on function public.remove_community_member(uuid,uuid) from public,anon', self.sql)

    def test_sql_access_test_covers_owner_member_admin_and_ban(self):
        t = (ROOT / 'tests' / 'private_call_servers_access.sql').read_text(encoding='utf-8')
        for marker in ('FAIL member sees private server', 'FAIL member created invite', 'FAIL owner kick',
                       'FAIL kick audit', 'FAIL banned member rejoined', 'FAIL admin entry',
                       'FAIL admin created private invite', 'request.jwt.claims'):
            self.assertIn(marker, t)
        self.assertTrue(t.strip().endswith('rollback;'))

if __name__ == '__main__':
    unittest.main()
