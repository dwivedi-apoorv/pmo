// Builds teams-app/pmo-teams-app.zip from your .env (TEAMS_BOT_ID, APP_URL). Upload that zip in the Teams admin centre.
// Run: node scripts/build-teams-app.mjs
import fs from "node:fs";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const env = { ...Object.fromEntries(fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]) : []), ...process.env };
const botId = env.TEAMS_BOT_ID, appUrl = (env.APP_URL || "").replace(/\/$/, "");
if (!botId || !appUrl) { console.error("Set TEAMS_BOT_ID and APP_URL in .env first."); process.exit(1); }

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
// Simple square PNG: filled background; `ring` draws an outline-style icon (white lines, transparent) instead.
function png(size, fg, bg) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4, m = size * 0.2, inBox = x > m && x < size - m && y > m && y < size - m;
      const edge = inBox && (x < m + size * 0.08 || x > size - m - size * 0.08 || y < m + size * 0.08 || y > size - m - size * 0.08);
      const c = bg ? (inBox ? fg : bg) : edge ? fg : [0, 0, 0, 0];
      raw.set(c.length === 4 ? c : [...c, 255], o);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const dir = "teams-app/build";
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const manifest = fs.readFileSync("teams-app/manifest.template.json", "utf8").replaceAll("{{BOT_ID}}", botId).replaceAll("{{APP_URL}}", appUrl);
JSON.parse(manifest);
fs.writeFileSync(`${dir}/manifest.json`, manifest);
fs.writeFileSync(`${dir}/color.png`, png(192, [255, 255, 255], [31, 58, 95]));
fs.writeFileSync(`${dir}/outline.png`, png(32, [255, 255, 255], null));
const zip = "teams-app/pmo-teams-app.zip";
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-j", "-q", `../pmo-teams-app.zip`, "manifest.json", "color.png", "outline.png"], { cwd: dir });
console.log("Created", zip);
