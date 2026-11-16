# Smart Incubation walkthrough video

A narrated walkthrough of the platform, about 9 minutes, made with [Remotion](https://www.remotion.dev).
It covers the incubation workspace (operations, consultant, SME, director, funder), the training
workspace (trainer, learner, client company), the ESG reporting add-on, and the platform admin.

| File | What it holds |
| --- | --- |
| `src/script.ts` | Every scene: its narration, subtitles, and which recording it plays |
| `generate-voiceover.ts` | Turns the narration into `public/voiceover/<scene>.mp3` (ElevenLabs) |
| `record.mjs` | Films each screen of the app into `public/recordings/<shot>.mp4` |
| `assets/` | The demo files the recorder uploads (a Word quiz and an attendance sheet) |

## Making it (PowerShell)

```powershell
cd video
npm i

# 1. Voice. Needs ELEVENLABS_API_KEY in video/.env (never committed).
#    Only regenerate scenes whose wording changed: the free plan has about 10,000 characters a month.
node generate-voiceover.ts <scene id> ...

# 2. Footage. Films the local demo data only, so no real client appears. In the repo root:
$env:SEED_FOR_VIDEO = '1'; npm run local
#    then, in video/ (reseed with `node scripts/seed-emulators.mjs --reset` first if you record twice):
node record.mjs                 # every shot, about 15 minutes
node record.mjs marking admin   # or just some

# 3. Preview and render
npm run dev
npx remotion render Showcase out/walkthrough.mp4
```

Each shot is timed to its narration, so record after generating the voice. The recordings, the
rendered video and `.env` are git-ignored.

Changing a screen in the app can break a shot. The recorder logs `click skipped` and carries on, so
check its output, then fix the label in `record.mjs`.

The voice is "Alice", one of ElevenLabs' built-in voices. Commercial use of ElevenLabs audio needs a
paid plan.
