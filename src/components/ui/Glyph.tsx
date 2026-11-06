/**
 * Small drawn icons for buttons. Text symbols like ▶ ⏸ ⬇ ✂ turn into colored emoji on many phones
 * (the orange ⏸ box), so buttons use these instead: they follow the text color and size everywhere.
 */
const PATHS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  expand: "M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM6 15v3h3v2H4v-5h2zm12 3v-3h2v5h-5v-2h3z",
  close: "M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z",
  download: "M11 4h2v9.2l3.3-3.3 1.4 1.4L12 17l-5.7-5.7 1.4-1.4 3.3 3.3zM5 19h14v2H5z",
  upload: "M11 20h2v-9.2l3.3 3.3 1.4-1.4L12 7l-5.7 5.7 1.4 1.4 3.3-3.3zM5 3h14v2H5z",
  scissors:
    "M9.6 8.1A3.5 3.5 0 1 0 8 9.9L10.1 12 8 14.1a3.5 3.5 0 1 0 1.6 1.8L12 13.4l7 7h3v-1L9.6 8.1zM6.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM15 9.6 22 2.6V2h-3l-5.6 5.6z",
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = "1.1em" }: { name: GlyphName; size?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ fill: "currentColor", verticalAlign: "-0.18em", flex: "none" }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
