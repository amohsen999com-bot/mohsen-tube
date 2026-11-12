import type { MetadataRoute } from "next";

import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE + "/", lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: SITE + "/fun", lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: SITE + "/privacy", lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: SITE + "/terms", lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
