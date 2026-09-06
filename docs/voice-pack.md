# Connectus voice pack

The standard board uses **Sarah**, an American English ElevenLabs voice, with one consistent configuration. All 83 starter tiles are covered by 76 recordings; tiles with identical phrases share a file. The pack contains about 51 seconds of speech and is under 700 KB.

## Selection and generation

Three candidate samples were generated from the same tile phrases: Sarah (warm and reassuring), River (relaxed and neutral), and Bella (bright and professional). Sarah was chosen to match the requested warm, clear, calm direction, using a measured pace and restrained expression. The comparison phrase was: “Hello. I need help. Water, please. I am happy. I am scared. I need a break. I love you. All done.”

- Voice ID: `EXAVITQu4vr4xnSDxMaL`
- Model: `eleven_multilingual_v2`
- Speed: `0.9`; stability: `0.65`; similarity: `0.75`; style: `0`; speaker boost enabled.
- Three samples: 291 input characters. Tile generation: 582 input characters including sentence punctuation.
- Metadata and phrase-to-file mapping: `src/lib/voice-pack.json`.
- Recordings: `public/audio/tiles/`; selected sample: `public/audio/connectus-sarah-preview.mp3`.

Files are decoded, edge silence is trimmed without removing internal pauses, and loudness is normalized. Automated checks cover file decoding, phrase coverage, actual browser media completion, sequential playback, and offline playback. This does not replace caregiver listening on the intended device or assessment of pronunciation and suitability for an individual communicator.

## Playback

Tile taps use the exact phrase recording. Speak uses a full-phrase match when available; otherwise it plays the selected tile recordings in sequence using the same voice. Word-by-word sentences naturally have boundaries between recordings. A new tap or Clear cancels the previous playback.

New custom phrases are not automatically sent to ElevenLabs. A phrase without a recording uses browser speech, as does a recording that cannot play. The caregiver's fallback voice setting affects only those cases. No provider key is needed to run the app, and normal use consumes no ElevenLabs credits.

## Regeneration

```sh
# Dry run, no API calls:
node scripts/generate-voice-pack.mjs

# Explicit generation, using ELEVENLABS_API_KEY from the secure environment:
node scripts/generate-voice-pack.mjs --generate
```

FFmpeg and ffprobe must be installed for regeneration. Existing files are reused; the generator stops on a provider error and does not automatically retry uncertain billable requests. The default source is the starter vocabulary. To include a local board's current phrases, set `CONNECTUS_BOARD_URL=http://127.0.0.1:3000/api/board` explicitly. A 2,000-character guard prevents accidental large runs.

Audio was generated on the user's existing paid ElevenLabs plan. Original ARASAAC artwork remains subject to its separate non-commercial/share-alike license. Comparison files and provider metadata in `data/voice-research/` are ignored by Git.
