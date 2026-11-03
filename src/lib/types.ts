export interface VideoItem {
  id: string;
  /** Title */
  t: string;
  /** Channel name */
  c: string;
  /** Duration in seconds */
  d: number;
  /** Topic name (e.g. تفسير, برمجة, ذكاء اصطناعي) */
  tp: string;
  /** Group name (e.g. علماء, أنا السلفي, كورسات, اصنعها بنفسك, رياضة, بودكاست, القرآن الكريم) */
  g: string;
  /** Relative channel rank 0..1 */
  r: number;
  /** Benefit score 0..1 */
  s?: number;
  /** Thumbnail attractiveness score 0..1 */
  q?: number;
  /** Newness in channel 0..1 */
  o?: number;
  /** Difficulty level 1..5 */
  lv?: number;
  /** HD flag (1 or 0) */
  hd?: number;
  /** Publish date YYYYMMDD */
  dt?: number;
  /** Publish year */
  y?: number;
  /** Series index if part of a series */
  pl?: number;
}

export interface ChannelInfo {
  name: string;
  id: string;
  group: string;
  field?: string;
  priority?: boolean;
  videoCount?: number;
}

export interface SeriesItem {
  id: number;
  /** Series title */
  t: string;
  /** Ordered array of video IDs */
  v: string[];
  channel?: string;
}

export interface CommentItem {
  /** Author handle/name */
  a: string;
  /** Comment text */
  t: string;
}

export interface ChapterItem {
  /** Start time in seconds */
  t: number;
  /** Chapter title */
  title: string;
}

export interface TranscriptLine {
  /** Start time in seconds */
  t: number;
  /** Line text */
  x: string;
}

export interface VideoDetailResponse {
  video: VideoItem;
  channel: ChannelInfo | null;
  series: {
    id: number;
    title: string;
    videos: VideoItem[];
    nextVideo: VideoItem | null;
  } | null;
  related: VideoItem[];
  comments: CommentItem[];
  description: string;
  chapters: ChapterItem[];
  transcript: {
    lang: string | null;
    auto: boolean;
    lines: TranscriptLine[];
  } | null;
}

export interface RoomState {
  code: string;
  vid: string;
  t: number;
  playing: boolean;
  by: string;
  ts: number;
  now: number;
}

export interface LabelsAggregate {
  v: Record<string, Record<string, Record<string, number>>>;
  c: Record<string, Record<string, Record<string, number>>>;
}
