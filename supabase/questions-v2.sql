-- محسن تيوب: الأسئلة الجديدة تحت الفيديو + رأي المشاهد في "مقترح لك" و"ترفيه".
-- شغّله مرة واحدة في Supabase SQL Editor (بعد shared-state.sql).

-- 1) سؤالين جداد تحت الفيديو: مستواه (level) وخرجت منه بإيه (gain)
alter table public.labels drop constraint if exists labels_q_check;
alter table public.labels add constraint labels_q_check check (q in ('aud', 'level', 'gain', 'trait', 'edge', 'similar'));

create or replace function public.label_add(p_vid text, p_ch text, p_q text, p_answers jsonb, p_voter text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  allowed text[];
  clean jsonb;
  n int;
begin
  if p_q not in ('aud', 'level', 'gain', 'trait', 'edge', 'similar') then return false; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 or jsonb_array_length(p_answers) > 3 then return false; end if;
  if length(p_vid) > 16 or length(p_ch) > 120 or length(p_voter) > 64 then return false; end if;
  allowed := case p_q
    when 'aud' then array['أي حد','المبتدئ في الموضوع','طالب العلم','الشباب','الآباء والأمهات','المتخصص','الأطفال','المتزوجين']
    when 'level' then array['سهل لأي حد','محتاج خلفية بسيطة','متقدم']
    when 'gain' then array['معلومة جديدة','تذكرة للقلب','مهارة هطبقها','فهم أعمق','ما استفدتش كتير']
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

-- 2) رأي المشاهد في الصفحة ("مبسوط؟ فيه عيب؟") + كلامه بحريته. بتقراه من Table Editor → feedback.
create table if not exists public.feedback (
  id          bigserial primary key,
  page        text not null check (page in ('home', 'fun')),
  picks       jsonb not null default '[]'::jsonb,
  body        text not null default '' check (length(body) <= 600),
  voter       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists feedback_at_idx on public.feedback (created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

create or replace function public.feedback_add(p_page text, p_picks jsonb, p_body text, p_voter text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_page not in ('home', 'fun') then return false; end if;
  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) > 8 then return false; end if;
  if length(coalesce(p_body, '')) > 600 or length(p_voter) > 64 then return false; end if;
  if jsonb_array_length(p_picks) = 0 and length(trim(coalesce(p_body, ''))) = 0 then return false; end if;
  -- at most 5 a day from the same visitor, and never more than 20000 rows
  select count(*) into n from public.feedback where voter = p_voter and created_at > now() - interval '1 day';
  if n >= 5 then return false; end if;
  delete from public.feedback where id in (select id from public.feedback order by created_at desc offset 20000);
  insert into public.feedback (page, picks, body, voter) values (p_page, p_picks, trim(coalesce(p_body, '')), p_voter);
  return true;
end $$;

revoke all on function public.label_add, public.feedback_add from public;
grant execute on function public.label_add, public.feedback_add to anon, authenticated;
