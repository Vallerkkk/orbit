import pathlib, re, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
MIG = ROOT / 'supabase' / 'migrations' / '20261022223000_fix_message_insert_permissions.sql'

class MessagePermissionsMigration(unittest.TestCase):
    def setUp(self):
        self.sql = MIG.read_text(encoding='utf-8')

    def test_grants_insert_columns_used_by_client(self):
        self.assertRegex(self.sql, r'grant insert \(channel_id, author_id, content, attachment_id, reply_to')
        client = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        self.assertIn('author_id: record.user, content: record.content', client)

    def test_policy_functions_are_executable_and_guards_definer(self):
        for fn in ('can_read_channel(uuid)', 'can_community(uuid, text)', 'is_banned(uuid, uuid)'):
            self.assertIn('grant execute on function orbita_private.' + fn + ' to authenticated', self.sql)
        self.assertIn('alter function orbita_private.guard_message() security definer', self.sql)
        self.assertIn('create policy messages_insert on public.messages', self.sql)

    def test_is_idempotent(self):
        self.assertIn('drop policy if exists messages_insert', self.sql)
        self.assertNotRegex(self.sql, r'(?i)create table(?! if not exists)')

if __name__ == '__main__':
    unittest.main()
