// Generates one narration MP3 per scene with ElevenLabs: public/voiceover/<scene id>.mp3 for the walkthrough, and
// public/voiceover/pitch/<scene id>.mp3 for the pitch (--pitch).
// Reads ELEVENLABS_API_KEY (and optional VOICE_ID / MODEL_ID) from video/.env.
// Run: node generate-voiceover.ts            (skips scenes whose MP3 already exists)
//      node generate-voiceover.ts --force    (regenerates all of them)
//      node generate-voiceover.ts intro kpis (regenerates just those scenes)
//      node generate-voiceover.ts --pitch    (the same, for the pitch's scenes)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PITCH } from './src/pitch/script.ts'
import { SCENES } from './src/script.ts'

const env = Object.fromEntries(
  readFileSync(new URL('./.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^\s*[A-Z_]+\s*=/.test(line))
    .map((line) => {
      const [key, ...rest] = line.split('=')
      return [key.trim(), rest.join('=').trim()]
    }),
)

const apiKey = env.ELEVENLABS_API_KEY
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is missing from video/.env')
// "Alice" (clear, educational, British): one of ElevenLabs' built-in voices, which every plan can use through the
// API (library voices such as "Rachel" need a paid plan). Multilingual v2 rather than the app's Turbo model:
// narration is generated once, so quality matters more than latency here.
const voiceId = env.ELEVENLABS_VOICE_ID || 'Xb7hH8MSUJpSbSDYk0k2'
const modelId = env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'

const args = process.argv.slice(2)
const force = args.includes('--force')
const pitch = args.includes('--pitch')
const only = args.filter((arg) => !arg.startsWith('--'))

const outDir = new URL(pitch ? './public/voiceover/pitch/' : './public/voiceover/', import.meta.url)
mkdirSync(outDir, { recursive: true })
// The walkthrough is read at a calm pace (0.9); the pitch a touch quicker and livelier.
const pace = pitch ? { speed: 0.95, style: 0.3 } : { speed: 0.9, style: 0.2 }

for (const scene of pitch ? PITCH : SCENES) {
  const file = new URL(`${scene.id}.mp3`, outDir)
  const wanted = only.length ? only.includes(scene.id) : force || !existsSync(file)
  // A pitch chapter card is silent.
  if (!wanted || !scene.narration) continue

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: scene.narration,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, ...pace },
    }),
  })
  if (!response.ok) throw new Error(`ElevenLabs ${response.status} for ${scene.id}: ${(await response.text()).slice(0, 300)}`)

  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  console.log(`saved ${pitch ? 'voiceover/pitch' : 'voiceover'}/${scene.id}.mp3`)
}
