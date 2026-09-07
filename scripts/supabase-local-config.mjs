import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
const config = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
if (new URL(config.API_URL).hostname !== "127.0.0.1")
  throw new Error("This helper is only for local Supabase.");
mkdirSync("data", { recursive: true });
const files = {
  "data/supabase-status.json": JSON.stringify(config),
  ".env.supabase.local": `NEXT_PUBLIC_SUPABASE_URL=${config.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${config.PUBLISHABLE_KEY || config.ANON_KEY}\nCONNECTUS_SITE_URL=http://127.0.0.1:3300\n`,
};
for (const [file, content] of Object.entries(files)) {
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}
console.log(
  "Local configuration prepared. Credentials remain in ignored local files.",
);
