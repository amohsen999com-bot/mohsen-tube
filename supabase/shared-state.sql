-- محسن تيوب: الحاجات المشتركة بين كل الزوار (أوض "اتفرجوا مع بعض" وتصويتات "مناسب لمين")
-- بتتحفظ هنا بدل ملف السيرفر، عشان الاستضافة المجانية بتمسح ملفاتها كل شوية.
--
-- الأمان: الجداول مقفولة تمامًا (RLS من غير أي policy)، والوصول بس من خلال الدوال اللي تحت.
-- كل دالة بتتحقق بنفسها: كود الأوضة وتوكنها، والإجابات المسموحة، وصوت واحد لكل زائر، وحد أقصى للأصوات.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Watch-together rooms ----------
create table if not exists public.rooms (
  code        text primary key check (code ~ '^[A-Z0-9]{8}$'),
  vid         text not null check (vid ~ '^[A-Za-z0-9_-]{6,16}$'),
  t           double precision not null default 0 check (t >= 0 and t <= 86400),
  playing     boolean not null default false,
  by_user     text not null check (by_user ~ '^[A-Za-z0-9_-]{1,20}$'),
  token_hash  text not null,
  updated_at  timestamptz not null default now()
);
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;

create or replace function public._room_json(r public.rooms) returns jsonb
language sql immutable as $$
  select jsonb_build_object('code', r.code, 'vid', r.vid, 't', r.t, 'playing', r.playing, 'by', r.by_user,
    'ts', extract(epoch from r.updated_at), 'now', extract(epoch from now()))
$$;

create or replace function public._room_member_token(p_code text, p_hash text) returns text
language sql immutable as $$
  select 'm.' || translate(encode(extensions.hmac('member:' || p_code, p_hash, 'sha256'), 'base64'), '+/=', '-_')
$$;

-- p_token_hash = sha256 hex of the creator's secret token (computed by our server; the token itself never reaches the DB)
create or replace function public.room_create(p_code text, p_token_hash text, p_vid text, p_t double precision, p_playing boolean, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  delete from public.rooms where updated_at < now() - interval '6 hours';
  if p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  insert into public.rooms (code, vid, t, playing, by_user, token_hash)
  values (p_code, p_vid, greatest(0, least(p_t, 86400)), p_playing, p_by, p_token_hash)
  on conflict (code) do nothing
  returning * into r;
  if r.code is null then return null; end if;
  return public._room_json(r);
end $$;

create or replace function public.room_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code = p_code and updated_at > now() - interval '6 hours';
  if r.code is null then return null; end if;
  return public._room_json(r);
end $$;

-- Joining with the code hands out a member token (an HMAC of the code, so it's never stored)
create or replace function public.room_join(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code = p_code and updated_at > now() - interval '6 hours';
  if r.code is null then return null; end if;
  return jsonb_build_object('room', public._room_json(r), 'token', public._room_member_token(r.code, r.token_hash));
end $$;

-- Only the creator token or a member token may change the room
create or replace function public.room_update(p_code text, p_token text, p_vid text, p_t double precision, p_playing boolean, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code = p_code and updated_at > now() - interval '6 hours';
  if r.code is null then return null; end if;
  if encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') <> r.token_hash
     and coalesce(p_token, '') <> public._room_member_token(r.code, r.token_hash) then
    return null;
  end if;
  update public.rooms set vid = p_vid, t = greatest(0, least(p_t, 86400)), playing = p_playing, by_user = p_by, updated_at = now()
  where code = r.code returning * into r;
  return public._room_json(r);
end $$;

-- ---------- Viewer labels ("الفيديو ده مناسب لمين؟" وأخواتها) ----------
create table if not exists public.labels (
  id          bigserial primary key,
  vid         text not null default '',
  ch          text not null default '',
  q           text not null check (q in ('aud', 'trait', 'edge', 'similar')),
  answers     jsonb not null,
  voter       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists labels_target_idx on public.labels (vid, ch, q);
create unique index if not exists labels_one_vote_idx on public.labels (vid, ch, q, voter) where voter <> '';
alter table public.labels enable row level security;
revoke all on public.labels from anon, authenticated;

create or replace function public.label_add(p_vid text, p_ch text, p_q text, p_answers jsonb, p_voter text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  allowed text[];
  clean jsonb;
  n int;
begin
  if p_q not in ('aud', 'trait', 'edge', 'similar') then return false; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 or jsonb_array_length(p_answers) > 3 then return false; end if;
  if length(p_vid) > 16 or length(p_ch) > 120 or length(p_voter) > 64 then return false; end if;
  allowed := case p_q
    when 'aud' then array['أي حد','المبتدئ في الموضوع','طالب العلم','الشباب','الآباء والأمهات','المتخصص','الأطفال','المتزوجين']
    when 'trait' then array['هادي','حماسي','مبسّط','عميق','عملي']
    when 'edge' then array['بيبسّط الصعب','أمثلة من الواقع','دليل وتأصيل','بيحرّك القلب','بيجاوب على أسئلة الناس','تطبيق خطوة بخطوة','مختصر ومركّز','شرح عميق']
    else null end;
  select coalesce(jsonb_agg(distinct a), '[]'::jsonb) into clean
  from jsonb_array_elements_text(p_answers) a
  where length(a) between 1 and 80 and (allowed is null or a = any(allowed));
  if jsonb_array_length(clean) = 0 then return false; end if;
  select count(*) into n from public.labels where vid = p_vid and ch = p_ch and q = p_q;
  if n >= 500 then return false; end if;
  insert into public.labels (vid, ch, q, answers, voter) values (p_vid, p_ch, p_q, clean, p_voter)
  on conflict do nothing;
  return found;
end $$;

-- Totals for the recommendation engine: one row per target + answer
create or replace function public.labels_totals()
returns table (vid text, ch text, q text, answer text, n bigint)
language sql stable security definer set search_path = public as $$
  select l.vid, l.ch, l.q, a.answer, count(*)
  from public.labels l, jsonb_array_elements_text(l.answers) as a(answer)
  group by 1, 2, 3, 4
$$;

revoke all on function public.room_create, public.room_get, public.room_join, public.room_update,
  public.label_add, public.labels_totals, public._room_json, public._room_member_token from public;
grant execute on function public.room_create, public.room_get, public.room_join, public.room_update,
  public.label_add, public.labels_totals to anon, authenticated;
