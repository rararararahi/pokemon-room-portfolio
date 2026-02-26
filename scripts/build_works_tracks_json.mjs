import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LINKS_PATH = path.resolve("public/data/spotify_track_links.txt");
const OUTPUT_PATH = path.resolve("public/data/works_tracks.json");
const SPOTIFY_TRACK_BASE_URL = "https://open.spotify.com/track";
const SPOTIFY_OEMBED_BASE_URL = "https://open.spotify.com/oembed?url=";
const REQUEST_DELAY_MS = 120;

function normalizeTrackLink(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || value.startsWith("#")) return null;

  const uriMatch = value.match(/^spotify:track:([A-Za-z0-9]+)$/i);
  if (uriMatch) {
    const trackId = uriMatch[1];
    return {
      id: trackId,
      spotifyUrl: `${SPOTIFY_TRACK_BASE_URL}/${trackId}`,
    };
  }

  const queryless = value.split("?")[0].split("#")[0];

  try {
    const parsed = new URL(queryless);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "open.spotify.com" && hostname !== "www.open.spotify.com") return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const trackIdx = segments.findIndex((segment) => segment.toLowerCase() === "track");
    const trackId = trackIdx >= 0 ? segments[trackIdx + 1] : "";
    if (!trackId || !/^[A-Za-z0-9]+$/.test(trackId)) return null;

    return {
      id: trackId,
      spotifyUrl: `${SPOTIFY_TRACK_BASE_URL}/${trackId}`,
    };
  } catch {
    return null;
  }
}

async function fetchOEmbed(spotifyUrl) {
  const endpoint = `${SPOTIFY_OEMBED_BASE_URL}${encodeURIComponent(spotifyUrl)}`;
  const response = await fetch(endpoint, {
    headers: {
      "user-agent": "rahi-studio-works-build/1.0",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function main() {
  const rawText = await fs.readFile(LINKS_PATH, "utf8");
  const links = rawText
    .split(/\r?\n/)
    .map(normalizeTrackLink)
    .filter(Boolean);

  if (!links.length) {
    throw new Error(`No valid Spotify track links found in ${LINKS_PATH}`);
  }

  const tracks = [];
  let resolved = 0;
  let failed = 0;

  for (const link of links) {
    let title = "";
    let artist = "";

    try {
      const meta = await fetchOEmbed(link.spotifyUrl);
      title = String(meta?.title || "").trim();
      artist = String(meta?.author_name || "").trim();
      resolved += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[works:build] oEmbed failed for ${link.id}: ${error?.message || error}`);
    }

    tracks.push({
      id: link.id,
      title,
      artist,
      spotifyUrl: link.spotifyUrl,
      coverLocal: `/works_covers/${encodeURIComponent(link.id)}.jpg`,
    });

    await delay(REQUEST_DELAY_MS);
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(tracks, null, 2)}\n`, "utf8");
  console.log(`[works:build] Wrote ${tracks.length} tracks to ${OUTPUT_PATH}`);
  console.log(`[works:build] resolved=${resolved} failed=${failed}`);
}

main().catch((error) => {
  console.error(`[works:build] ${error?.message || error}`);
  process.exit(1);
});
