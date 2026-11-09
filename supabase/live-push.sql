-- محسن تيوب: إشعارات يوتيوب الفورية بالفيديوهات الجديدة (WebSub / PubSubHubbub).
-- يوتيوب بيبعت لـ /api/websub أول ما قناة من قنوات الموقع تنزّل فيديو، والسيرفر بيسجّل هنا رقم الفيديو وقناته.
--
-- الأمان: الجدول مقفول (RLS من غير policy)، والوصول بس من خلال الدالتين اللي تحت.
-- اللي هنا مجرد "تنبيه": السيرفر بيتأكد من كل فيديو بنفسه من يوتيوب (القناة من قنوات الموقع، المدة، العنوان)
-- قبل ما يعرضه، فلو حد سجّل حاجة مزيفة هنا مش هتظهر. وفيه حد أقصى للصفوف عشان محدش يملاه.

create table if not exists public.pushed_videos (
  id     text primary key check (id ~ '^[A-Za-z0-9_-]{11}$'),
  ch     text not null check (ch ~ '^UC[A-Za-z0-9_-]{22}$'),
  at     timestamptz not null default now()
);
create index if not exists pushed_videos_at_idx on public.pushed_videos (at desc);
alter table public.pushed_videos enable row level security;
revoke all on public.pushed_videos from anon, authenticated;

create or replace function public.push_add(p_id text, p_ch text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_id !~ '^[A-Za-z0-9_-]{11}$' or p_ch !~ '^UC[A-Za-z0-9_-]{22}$' then return false; end if;
  delete from public.pushed_videos where at < now() - interval '3 days';
  insert into public.pushed_videos (id, ch) values (p_id, p_ch) on conflict (id) do nothing;
  -- never more than 3000 rows
  delete from public.pushed_videos where id in (
    select id from public.pushed_videos order by at desc offset 3000);
  return true;
end $$;

create or replace function public.push_recent() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ch', ch, 'at', extract(epoch from at)) order by at desc), '[]'::jsonb)
  from (select id, ch, at from public.pushed_videos where at > now() - interval '3 days' order by at desc limit 400) x
$$;

revoke all on function public.push_add, public.push_recent from public;
grant execute on function public.push_add, public.push_recent to anon, authenticated;
