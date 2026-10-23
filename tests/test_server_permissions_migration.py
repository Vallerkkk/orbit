import pathlib, re, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
MIG = ROOT / 'supabase' / 'migrations' / '20261023190000_server_permissions_hardening.sql'

class ServerPermissionsMigration(unittest.TestCase):
    def setUp(self):
        self.sql = MIG.read_text(encoding='utf-8')

    def test_definer_functions_pin_search_path_and_check_uid(self):
        for m in re.finditer(r'create or replace function ([\w.]+)\(.*?\$\$(.*?)\$\$', self.sql, re.S):
            self.assertIn("set search_path=''", m.group(0), m.group(1))
        self.assertIn('auth.uid() is not null', self.sql)

    def test_community_update_is_owner_or_site_admin_only(self):
        self.assertIn('drop policy if exists communities_manage', self.sql)
        self.assertIn('using (orbita_private.can_edit_community(id)) with check (orbita_private.can_edit_community(id))', self.sql)
        body = self.sql.split('function orbita_private.can_edit_community', 1)[1].split('$$;', 1)[0]
        self.assertIn('c.created_by=auth.uid()', body)
        self.assertIn("s.role in('creator','admin')", body)
        self.assertNotIn('is_community_member', body)
        self.assertNotIn('community_member_roles', body)

    def test_roles_cannot_move_between_servers(self):
        self.assertIn('revoke update (id, community_id, created_at) on public.community_roles from authenticated', self.sql)
        self.assertIn('before update on public.community_roles', self.sql)

    def test_no_anon_execute(self):
        self.assertIn('revoke all on function orbita_private.can_edit_community(uuid) from public,anon', self.sql)

    def test_sql_access_test_covers_member_owner_admin(self):
        t = (ROOT / 'tests' / 'server_permissions_access.sql').read_text(encoding='utf-8')
        for marker in ('FAIL member updated community', 'FAIL mod updated community', 'FAIL owner update', 'FAIL site admin update', 'request.jwt.claims'):
            self.assertIn(marker, t)
        self.assertTrue(t.strip().endswith('rollback;'))

if __name__ == '__main__':
    unittest.main()
