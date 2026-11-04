import pathlib, re, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
MIG = ROOT / 'supabase' / 'migrations' / '20261104120000_community_tools.sql'

class CommunityToolsMigration(unittest.TestCase):
    def setUp(self):
        self.sql = MIG.read_text(encoding='utf-8')

    def test_definer_functions_pin_search_path(self):
        for m in re.finditer(r'create (?:or replace )?function ([\w.]+)\(.*?\$\$(.*?)\$\$', self.sql, re.S):
            self.assertIn("set search_path=''", m.group(0), m.group(1))

    def test_categories_are_per_community_and_ordered(self):
        body = self.sql.split('create table if not exists public.channel_categories', 1)[1].split(');', 1)[0]
        self.assertIn('community_id uuid not null references public.communities(id) on delete cascade', body)
        self.assertIn('position integer not null default 0', body)
        self.assertIn('create index if not exists channel_categories_order', self.sql)
        self.assertIn("grant insert(category_id,slowmode_seconds),update(category_id,slowmode_seconds,position) on public.channels", self.sql)
        scope = self.sql.split('function orbita_private.check_channel_category', 1)[1].split('$$;', 1)[0]
        self.assertIn('c.community_id=new.community_id', scope)

    def test_categories_require_manage_channels(self):
        for policy in ('channel_categories_insert', 'channel_categories_update', 'channel_categories_delete'):
            block = self.sql.split('create policy ' + policy, 1)[1].split(';', 1)[0]
            self.assertIn("orbita_private.can_community(community_id,'manage_channels')", block, policy)
        read = self.sql.split('create policy channel_categories_read', 1)[1].split(';', 1)[0]
        self.assertIn('orbita_private.is_community_member(community_id)', read)

    def test_events_are_visible_to_members_and_managed_by_channel_admins(self):
        read = self.sql.split('create policy community_events_read', 1)[1].split(';', 1)[0]
        self.assertIn('orbita_private.is_community_member(community_id)', read)
        insert = self.sql.split('create policy community_events_insert', 1)[1].split(';', 1)[0]
        self.assertIn('created_by=(select auth.uid())', insert)
        self.assertIn("orbita_private.can_community(community_id,'manage_channels')", insert)
        table = self.sql.split('create table if not exists public.community_events', 1)[1].split(');', 1)[0]
        self.assertIn('starts_at timestamptz not null', table)
        self.assertIn('ends_at is null or ends_at>starts_at', table)

    def test_rsvps_belong_to_the_signed_in_member(self):
        for policy in ('community_event_rsvps_insert', 'community_event_rsvps_update', 'community_event_rsvps_delete'):
            block = self.sql.split('create policy ' + policy, 1)[1].split(';', 1)[0]
            self.assertIn('user_id=(select auth.uid())', block, policy)
        table = self.sql.split('create table if not exists public.community_event_rsvps', 1)[1].split(');', 1)[0]
        self.assertIn("status in('going','interested')", table)

    def test_slowmode_and_automod_are_enforced_on_insert(self):
        trigger = self.sql.split('function orbita_private.enforce_message_rules', 1)[1].split('$$;', 1)[0]
        self.assertIn('new.webhook_id is not null', trigger)
        self.assertIn('can_community(channel.community_id', trigger)
        self.assertIn('make_interval(secs=>channel.slowmode_seconds)', trigger)
        self.assertIn('automod_links', trigger)
        self.assertIn('automod_caps', trigger)
        self.assertIn('automod_spam', trigger)
        self.assertIn('before insert on public.messages', self.sql)
        self.assertIn('between 0 and 21600', self.sql)
        self.assertIn('grant update(automod_links,automod_caps,automod_spam) on public.communities', self.sql)

    def test_sql_access_test_covers_categories_events_and_automod(self):
        t = (ROOT / 'tests' / 'community_tools_access.sql').read_text(encoding='utf-8')
        for marker in ('FAIL member created category', 'FAIL member sees category', 'FAIL member created event',
                       'FAIL member edited event', 'FAIL member rsvp', 'FAIL event not visible',
                       'FAIL slowmode', 'FAIL automod link', 'FAIL moderator bypass'):
            self.assertIn(marker, t)
        self.assertTrue(t.strip().endswith('rollback;'))

if __name__ == '__main__':
    unittest.main()
