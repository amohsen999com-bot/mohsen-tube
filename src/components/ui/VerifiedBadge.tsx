/**
 * علامة التوثيق (✓) جنب اسم القناة — بألوان محسن تيوب: ختم ذهبي وعلامة صح نبيتي.
 * القنوات الموثّقة متحددة في VERIFIED_CHANNELS (بالاسم زي ما هو في الموقع).
 */
export const VERIFIED_CHANNELS = new Set<string>(["Ibrahem Anwar"]);

export function isVerified(channel: string | undefined | null): boolean {
  return !!channel && VERIFIED_CHANNELS.has(channel);
}

export function VerifiedBadge({ size = "1em" }: { size?: string }) {
  return (
    <svg className="vbadge" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="قناة موثّقة">
      <title>قناة موثّقة</title>
      <path
        fill="var(--gold)"
        d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82L8.6 22.5l3.4-1.47 3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12z"
      />
      <path fill="var(--wine)" d="M10.09 16.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z" />
    </svg>
  );
}
