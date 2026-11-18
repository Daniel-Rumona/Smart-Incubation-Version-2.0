# Smart Incubation videos

Two narrated videos, made with [Remotion](https://www.remotion.dev) from the same recordings of the app:

- **Pitch** (about 5 minutes): for prospective clients and funders. Problem, solution, the key features in one
  beat each (the app always shown whole, never cropped), how reminders reach people in the app, by email and on
  WhatsApp, and the outcome. Script: `src/pitch/script.ts`.
- **Showcase** (about 9 minutes): a walkthrough of every workspace by role, for people who want to see how the
  work is done. Script: `src/script.ts`.

| File | What it holds |
| --- | --- |
| `src/pitch/script.ts` | The pitch: each scene's narration, and which seconds of which recordings it shows |
| `src/script.ts` | The walkthrough: each scene's narration, subtitles, and which recording it plays |
| `generate-voiceover.ts` | Turns the narration into `public/voiceover/<scene>.mp3` (ElevenLabs); `--pitch` for `public/voiceover/pitch/` |
| `record.mjs` | Films each screen of the app into `public/recordings/<shot>.mp4` |
| `assets/` | The demo files the recorder uploads (a Word quiz and an attendance sheet) |

## Making it (PowerShell)

```powershell
cd video
npm i

# 1. Voice. Needs ELEVENLABS_API_KEY in video/.env (never committed).
#    Only regenerate scenes whose wording changed: the free plan has about 10,000 characters a month.
node generate-voiceover.ts <scene id> ...
node generate-voiceover.ts --pitch <scene id> ...

# 2. Footage. Films the local demo data only, so no real client appears. In the repo root:
$env:SEED_FOR_VIDEO = '1'; npm run local
#    then, in video/ (reseed with `node scripts/seed-emulators.mjs --reset` first if you record twice):
node record.mjs                 # every shot, about 15 minutes
node record.mjs marking admin   # or just some

# 3. Preview and render
npm run dev
npx remotion render Pitch out/pitch.mp4
npx remotion render Showcase out/walkthrough.mp4
```

The pitch cuts its clips from the same recordings (plus three shots of its own: `bell`, `funder-impact` and
`funder-portfolio`). To show a different moment, change a clip's `from` and `to` (seconds) in `src/pitch/script.ts`.
If the voice says a word wrongly, spell it as it should sound in `narration` and put the proper spelling in
`subtitles`; to check, run the clip through ElevenLabs speech-to-text and read what it hears.

Each shot is timed to its narration, so record after generating the voice. The recordings, the
rendered video and `.env` are git-ignored.

Changing a screen in the app can break a shot. The recorder logs `click skipped` and carries on, so
check its output, then fix the label in `record.mjs`.

The voice is "Alice", one of ElevenLabs' built-in voices. Commercial use of ElevenLabs audio needs a
paid plan.
