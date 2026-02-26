import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const LINKS_PATH = "public/data/spotify_track_links.txt";
const OUT_DIR = "public/works_covers";

function readLines(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith("#"));
}

function getTrackId(url) {
  // Accept:
  // https://open.spotify.com/track/<id>?si=...
  // spotify:track:<id>
  if (url.startsWith("spotify:track:")) return url.split(":").pop();
  const m = url.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "rahi-studio-coverfetch/1.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse failed for ${url}: ${String(e)}`));
          }
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url, outPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "rahi-studio-coverfetch/1.0" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // follow redirect
          return resolve(downloadFile(res.headers.location, outPath));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download HTTP ${res.statusCode} for ${url}`));
        }
        const file = fs.createWriteStream(outPath);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  if (!fs.existsSync(LINKS_PATH)) {
    throw new Error(`Missing ${LINKS_PATH}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const links = readLines(LINKS_PATH);
  if (!links.length) {
    console.log("No links found.");
    return;
  }

  console.log(`Found ${links.length} links.`);
  let ok = 0;
  let fail = 0;

  for (const link of links) {
    const trackId = getTrackId(link);
    if (!trackId) {
      console.warn(`SKIP (no track id): ${link}`);
      fail++;
      continue;
    }

    const outFile = path.join(OUT_DIR, `${trackId}.jpg`);
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
      console.log(`OK (cached): ${trackId}`);
      ok++;
      continue;
    }

    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(link)}`;

    try {
      const meta = await fetchJson(oembedUrl);
      const thumb = meta?.thumbnail_url;

      if (!thumb) throw new Error(`No thumbnail_url in oEmbed for ${trackId}`);

      await downloadFile(thumb, outFile);
      console.log(`OK: ${trackId}`);
      ok++;
    } catch (e) {
      console.warn(`FAIL: ${trackId} -> ${String(e.message || e)}`);
      fail++;
    }
  }

  console.log(`\nDone. ok=${ok} fail=${fail}`);
  console.log(`Covers saved to: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
