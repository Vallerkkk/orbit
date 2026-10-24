import pathlib, re, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
CALLS = (ROOT/'supabase/migrations/20261024010000_dm_call_ringing.sql').read_text(encoding='utf-8')
UNREAD = (ROOT/'supabase/migrations/20261024020000_dm_unread.sql').read_text(encoding='utf-8')

class DmCallMigration(unittest.TestCase):
    def test_definer_functions_pin_search_path(self):
        for sql in (CALLS, UNREAD):
            for m in re.finditer(r'create or replace function ([\w.]+)\(.*?\$\$', sql, re.S):
                self.assertIn("set search_path=''", m.group(0), m.group(1))
                self.assertIn('security definer', m.group(0))

    def test_status_only_changes_through_transition(self):
        self.assertIn('revoke update on public.call_events from authenticated', CALLS)
        self.assertIn('grant insert(conversation_id,caller_id,kind) on public.call_events', CALLS)
        body = CALLS.split('function public.call_event_transition', 1)[1]
        self.assertIn('me in(c.user_a,c.user_b)', body)
        self.assertIn("if me<>callee then raise exception 'Só quem recebe", body)
        self.assertIn("if me<>ev.caller_id then raise exception 'Só quem ligou", body)
        self.assertIn('orbita_private.can_call_conversation', body)

    def test_unread_respects_membership_and_mutes(self):
        self.assertIn('auth.uid() in(c.user_a,c.user_b)', UNREAD)
        self.assertIn('public.social_mutes', UNREAD)
        self.assertNotIn('grant insert', UNREAD.split('conversation_reads_own')[0].split('revoke all on public.conversation_reads')[1])
        self.assertIn('revoke all on function public.mark_conversation_read(uuid),public.dm_unread_counts() from public,anon', UNREAD)

    def test_access_sql_covers_outsiders(self):
        for name in ('dm_calls_access.sql', 'dm_unread_access.sql'):
            sql = (ROOT/'tests'/name).read_text(encoding='utf-8')
            self.assertTrue(sql.startswith('begin;') and sql.rstrip().endswith('rollback;'))
            self.assertIn('outsider', sql)

    def test_installation_sql_is_current(self):
        sql = (ROOT/'supabase.sql').read_text(encoding='utf-8')
        self.assertIn('call_event_transition', sql)
        self.assertIn('dm_unread_counts', sql)

    def test_private_call_floating_button_removed(self):
        html = (ROOT/'static/index.html').read_text(encoding='utf-8')
        self.assertNotIn('private-call', html)
        self.assertNotIn('Ligar em particular', html)
        self.assertIn('id="dm-voice-call"', html)
        self.assertIn('id="dm-video-call"', html)
        self.assertNotIn('.private-call{', (ROOT/'static/style.css').read_text(encoding='utf-8'))

if __name__ == '__main__':
    unittest.main()
