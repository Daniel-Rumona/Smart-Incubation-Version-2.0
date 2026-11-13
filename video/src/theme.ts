import { loadFont } from '@remotion/google-fonts/Inter'

// Matches the app's dark theme and its purple accent, so the footage and the graphics read as one product.
export const { fontFamily } = loadFont('normal', { weights: ['400', '600', '800'], subsets: ['latin'] })

export const COLORS = {
  bg: '#0b0b12',
  bgRaised: '#151622',
  border: 'rgba(255, 255, 255, 0.10)',
  text: '#f8fafc',
  muted: 'rgba(248, 250, 252, 0.66)',
  accent: '#8b5cf6',
  accentSoft: 'rgba(139, 92, 246, 0.22)',
  good: '#34d399',
  warn: '#fbbf24',
  info: '#60a5fa',
}

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
// Fades between scenes; they overlap the scenes either side, which the total duration accounts for.
export const TRANSITION_FRAMES = 15
// Silence before the narration starts and after it ends, in every scene.
export const LEAD_IN_FRAMES = 12
export const TAIL_FRAMES = 18
