import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Explicit, resumable generation. No ElevenLabs calls are made by the running app.
const voiceId = "EXAVITQu4vr4xnSDxMaL";
const modelId = "eleven_multilingual_v2";
const settings = {
  stability: 0.65,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
  speed: 0.9,
};
const normalize = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
const board = process.env.CONNECTUS_BOARD_URL
  ? await (await fetch(process.env.CONNECTUS_BOARD_URL)).json()
  : JSON.parse(readFileSync("src/lib/seed.json", "utf8"));
const phrases = [
  ...new Map(
    board.tiles.map((tile) => [normalize(tile.text), tile.text.trim()]),
  ).values(),
];
const voiceText = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
const characters = phrases.reduce(
  (total, text) => total + voiceText(text).length,
  0,
);
console.log(
  JSON.stringify({
    voice: "Sarah",
    tiles: board.tiles.length,
    recordings: phrases.length,
    characters,
    mode: process.argv.includes("--generate") ? "generate" : "dry-run",
  }),
);
if (!process.argv.includes("--generate")) process.exit(0);
if (!process.env.ELEVENLABS_API_KEY)
  throw new Error(
    "Set ELEVENLABS_API_KEY in your secure environment before generating.",
  );
if (characters > 2000)
  throw new Error(
    "This pack exceeds the 2,000-character generation safeguard. Review its scope first.",
  );
mkdirSync("public/audio/tiles", { recursive: true });
mkdirSync("data/voice-research/raw", { recursive: true });
const manifest = {
  voiceName: "Sarah",
  voiceId,
  modelId,
  voiceSettings: settings,
  generatedAt: new Date().toISOString(),
  provider: "ElevenLabs",
  clips: {},
};
let generated = 0;
for (const text of phrases) {
  const key = normalize(text);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({ text: voiceText(text), voiceId, modelId, settings }),
    )
    .digest("hex")
    .slice(0, 16);
  const file = `${hash}.mp3`;
  const rawPath = `data/voice-research/raw/${file}`;
  const outputPath = `public/audio/tiles/${file}`;
  if (!existsSync(rawPath) && !existsSync(outputPath)) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: voiceText(text),
          model_id: modelId,
          language_code: "en",
          voice_settings: settings,
        }),
      },
    );
    if (!response.ok) {
      // Stop rather than retrying uncertain billable requests or switching to a different voice.
      const error = await response.json();
      throw new Error(
        `Generation stopped (${response.status}): ${JSON.stringify(error.detail)}`,
      );
    }
    if (!response.headers.get("content-type")?.startsWith("audio/"))
      throw new Error("The provider did not return audio.");
    writeFileSync(rawPath, Buffer.from(await response.arrayBuffer()));
    generated += voiceText(text).length;
  }
  if (!existsSync(outputPath)) {
    // Trim only the edges (reverse for the tail), retaining internal phrase pauses.
    const trim =
      "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB:start_silence=0.06";
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      rawPath,
      "-af",
      `${trim},areverse,${trim},areverse,loudnorm=I=-18:TP=-1.5:LRA=7`,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "3",
      "-map_metadata",
      "-1",
      outputPath,
    ]);
  }
  const duration = Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputPath,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
  if (!Number.isFinite(duration) || duration < 0.15 || duration > 12)
    throw new Error(
      `Review unexpected recording length: ${text} (${duration}s)`,
    );
  manifest.clips[key] = { text, src: `/audio/tiles/${file}`, duration };
  console.log(
    `${Object.keys(manifest.clips).length}/${phrases.length} ${text} (${duration.toFixed(2)}s)`,
  );
}
writeFileSync(
  "src/lib/voice-pack.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    complete: true,
    recordings: phrases.length,
    generatedCharactersThisRun: generated,
  }),
);
