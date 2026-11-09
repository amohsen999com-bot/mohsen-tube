/**
 * "سؤال سريع" تحت الفيديو: بنك أسئلة متنوع، وكل سؤال له شغلانة واضحة في الخوارزميات.
 *
 * أسئلة عن المحتوى (بتتحفظ للكل، وبتفيد أي زائر حتى الجديد):
 *   aud   الفيديو ده يفيد مين أكتر؟      → الفيديو يوصل للناس اللي محتاجاه، و"أي حد" = بداية آمنة للزائر الجديد
 *   level مستوى الفيديو ده إيه؟          → سهل/متوسط/متقدم من الناس بدل التخمين من العنوان
 *   gain  خرجت من الفيديو ده بإيه؟       → نوع الفايدة (معلومة/تذكرة/مهارة/فهم)، و"ما استفدتش" بتنزّله للكل
 *   trait أسلوب القناة دي عامل إزاي؟     → (لكل قناة مرة) هادي/حماسي/مبسّط/عميق/عملي
 *   edge  أكتر حاجة بتميّز القناة دي؟     → (لكل قناة مرة) أمثلة من الواقع، دليل وتأصيل، ...
 * أسئلة عنك إنت (بتتحفظ على جهازك بس، ومش بتتبعت لحد):
 *   more    عايز فيديوهات زي دي أكتر؟     → أوضح إشارة لذوقك: بتشد أو بتبعد النوع ده
 *   persona إنت أقرب لأنهي واحد؟         → (مرة واحدة) بيربطك بإجابات الناس عن "يفيد مين"
 *
 * مين يتسأل إمتى: سؤال واحد بس لكل فيديو، ومش نفس السؤال مرتين ورا بعض. الأولوية للسؤال اللي
 * إجابته ناقصة فعلًا (فيديو لسه محدش قال يفيد مين، قناة لسه أسلوبها مش معروف)، وكل كام فيديو سؤال عنك.
 */
import type { LabelsAggregate, VideoItem } from "../types.ts";
import { readLocal, writeLocal } from "./store.ts";

export type QuestionKey = "aud" | "level" | "gain" | "trait" | "edge" | "more" | "persona";

export interface Question {
  key: QuestionKey;
  /** where the answer goes: the server for everyone (video/channel), or this device only (me) */
  scope: "video" | "channel" | "me";
  text: string;
  options: string[];
  thanks: string;
}

export const QUESTIONS: Record<QuestionKey, Question> = {
  aud: {
    key: "aud",
    scope: "video",
    text: "الفيديو ده يفيد مين أكتر؟",
    options: ["أي حد", "المبتدئ في الموضوع", "الشباب", "الآباء والأمهات", "طالب العلم", "المتخصص"],
    thanks: "إجابتك هتساعد الفيديو ده يوصل للي محتاجه.",
  },
  level: {
    key: "level",
    scope: "video",
    text: "مستوى الفيديو ده إيه؟",
    options: ["سهل لأي حد", "محتاج خلفية بسيطة", "متقدم"],
    thanks: "كده هيوصل للي مستواه مناسب له.",
  },
  gain: {
    key: "gain",
    scope: "video",
    text: "خرجت من الفيديو ده بإيه؟",
    options: ["معلومة جديدة", "تذكرة للقلب", "مهارة هطبقها", "فهم أعمق", "ما استفدتش كتير"],
    thanks: "إجابتك بتخلّي الأنفع يطلع قدّام الناس.",
  },
  trait: {
    key: "trait",
    scope: "channel",
    text: "أسلوب القناة دي عامل إزاي؟",
    options: ["هادي", "حماسي", "مبسّط", "عميق", "عملي"],
    thanks: "كده هنعرف نرشّحها للي يحب الأسلوب ده.",
  },
  edge: {
    key: "edge",
    scope: "channel",
    text: "أكتر حاجة بتميّز القناة دي؟",
    options: ["بيبسّط الصعب", "أمثلة من الواقع", "دليل وتأصيل", "بيحرّك القلب", "تطبيق خطوة بخطوة", "مختصر ومركّز"],
    thanks: "كده هنعرف نرشّحها للي محتاج ده.",
  },
  more: {
    key: "more",
    scope: "me",
    text: "عايز فيديوهات زي دي أكتر؟",
    options: ["أيوه كتير", "أحيانًا", "لأ، كفاية كده"],
    thanks: "تمام، ترشيحاتك هتتظبط على كده.",
  },
  persona: {
    key: "persona",
    scope: "me",
    text: "إنت أقرب لأنهي واحد؟",
    options: ["لسه ببدأ أتعلم", "شاب بيبني نفسه", "أب أو أم", "طالب علم", "متخصص في مجالي"],
    thanks: "تمام، هنرشّحلك اللي يناسبك أكتر. (محفوظة على جهازك بس)",
  },
};

/** persona answer → the "يفيد مين" answer it matches, so the crowd's labels reach the right people */
export const PERSONA_TO_AUD: Record<string, string> = {
  "لسه ببدأ أتعلم": "المبتدئ في الموضوع",
  "شاب بيبني نفسه": "الشباب",
  "أب أو أم": "الآباء والأمهات",
  "طالب علم": "طالب العلم",
  "متخصص في مجالي": "المتخصص",
};

const ENOUGH = 3; // votes after which a question about the same video/channel stops being asked first

type AskState = { asked: Record<string, string>; ch: Record<string, string[]>; last: string; n: number };
const STATE_KEY = "nt_ask";
const state = (): AskState => ({ asked: {}, ch: {}, last: "", n: 0, ...readLocal<Partial<AskState>>(STATE_KEY, {}) });

const votes = (m?: Record<string, number>) => Object.values(m || {}).reduce((a, b) => a + b, 0);

/** The one question worth asking under this video (or null: already answered here). */
export function pickQuestion(v: VideoItem, labels: LabelsAggregate, historyCount: number): Question | null {
  const s = state();
  if (s.asked[v.id]) return null;
  const vl = labels.v[v.id] || {};
  const cl = labels.c[v.c] || {};
  const chAsked = new Set(s.ch[v.c] || []);
  const persona = readLocal<string>("nt_persona", "");
  const ok = (k: QuestionKey) => k !== s.last;

  // About you, once you've watched a bit: who you are (once), then every 4th question your taste
  if (!persona && historyCount >= 3 && ok("persona")) return QUESTIONS.persona;
  if (s.n % 4 === 3 && ok("more")) return QUESTIONS.more;

  // What's missing most about this video / channel
  const needs: QuestionKey[] = [];
  if (votes(vl.aud) < ENOUGH) needs.push("aud");
  if (!chAsked.has("trait") && votes(cl.trait) < ENOUGH) needs.push("trait");
  if (votes(vl.level) < ENOUGH) needs.push("level");
  if (!chAsked.has("edge") && votes(cl.edge) < ENOUGH) needs.push("edge");
  const first = needs.find(ok);
  if (first) return QUESTIONS[first];

  // Everything known already: rotate, so it never feels like the same question
  const rotation: QuestionKey[] = ["gain", "aud", "more", "level"];
  const seed = [...v.id].reduce((a, c) => a + c.charCodeAt(0), s.n);
  for (let i = 0; i < rotation.length; i++) {
    const k = rotation[(seed + i) % rotation.length];
    if (ok(k)) return QUESTIONS[k];
  }
  return QUESTIONS.gain;
}

/** Remember the answer locally (so we don't ask again here, and vary the next one). */
export function rememberAnswer(v: VideoItem, q: Question, answer: string): void {
  const s = state();
  s.asked[v.id] = q.key;
  // keep the list small
  const ids = Object.keys(s.asked);
  if (ids.length > 400) for (const id of ids.slice(0, ids.length - 400)) delete s.asked[id];
  if (q.scope === "channel") s.ch[v.c] = [...new Set([...(s.ch[v.c] || []), q.key])];
  s.last = q.key;
  s.n += 1;
  writeLocal(STATE_KEY, s);
  if (q.key === "persona") writeLocal("nt_persona", answer);
}
