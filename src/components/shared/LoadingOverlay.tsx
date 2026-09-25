
import { tr } from '@/providers/LanguageProvider'

export const LoadingOverlay = ({ tip = 'Loading...' }: { tip?: string }) => (
  <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
    <div className="loading-overlay-card">
      <svg className="loading-incubator" viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <linearGradient id="loading-dome-gradient" x1="25" y1="22" x2="136" y2="140" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
          <linearGradient id="loading-leaf-gradient" x1="58" y1="68" x2="107" y2="104" gradientUnits="userSpaceOnUse">
            <stop stopColor="#34d399" />
            <stop offset="1" stopColor="#16a34a" />
          </linearGradient>
        </defs>
        <circle className="loading-incubator-orbit" cx="80" cy="80" r="65" />
        <circle className="loading-incubator-orbit-dot" cx="80" cy="15" r="5" />
        <path className="loading-incubator-dome" d="M35 116V74a45 45 0 0 1 90 0v42" />
        <path className="loading-incubator-ground" d="M28 116h104" />
        <path className="loading-incubator-stem" d="M80 115V78" />
        <path className="loading-incubator-leaf loading-incubator-leaf-left" d="M79 96c-17 0-25-9-25-24 16 0 25 8 25 24Z" />
        <path className="loading-incubator-leaf loading-incubator-leaf-right" d="M81 85c1-16 10-24 27-24 0 16-10 24-27 24Z" />
        <circle className="loading-incubator-seed" cx="80" cy="116" r="8" />
        <path className="loading-incubator-shine" d="M51 70a31 31 0 0 1 12-22" />
      </svg>
      <div className="loading-overlay-copy">
        <strong>{tip}</strong>
        <span>{tr('Preparing your workspace')}</span>
      </div>
      <span className="loading-overlay-progress" aria-hidden="true"><i /></span>
    </div>
  </div>
)
