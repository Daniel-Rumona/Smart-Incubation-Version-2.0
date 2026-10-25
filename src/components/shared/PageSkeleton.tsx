import { Skeleton } from 'antd'
import { tr } from '@/providers/LanguageProvider'
import '@/styles/page-loading.css'

type PageSkeletonProps = {
    /** 'dashboard': metric cards over a panel. 'table': filter bar over a list. 'detail': a header over a form. */
    variant?: 'dashboard' | 'table' | 'detail'
    /** Read out to screen readers (and shown small) so the wait is explained, e.g. "Loading documents". */
    label?: string
}

/**
 * First-load placeholder for a page, shaped like the page it stands in for. Replaces the full-screen
 * LoadingOverlay, which is now only used while the app itself starts. The real page fades in over it
 * via the .app-content rule in page-loading.css.
 */
export const PageSkeleton = ({ variant = 'dashboard', label }: PageSkeletonProps) => (
    <div className={`page-skeleton is-${variant}`} role="status" aria-live="polite" aria-busy="true">
        <span className="page-skeleton-label">{label || tr('Loading')}</span>

        {variant === 'dashboard' && (
            <div className="page-skeleton-metrics">
                {Array.from({ length: 4 }, (_, index) => (
                    <div className="page-skeleton-card" key={index}>
                        <Skeleton.Avatar active shape="square" size={36} />
                        <Skeleton active title={{ width: '50%' }} paragraph={{ rows: 1, width: '35%' }} />
                    </div>
                ))}
            </div>
        )}

        {variant === 'table' && (
            <div className="page-skeleton-bar">
                <Skeleton.Input active size="default" style={{ width: 200 }} />
                <Skeleton.Button active style={{ width: 120 }} />
            </div>
        )}

        <div className="page-skeleton-panel">
            <Skeleton active title={{ width: variant === 'detail' ? '40%' : '25%' }} paragraph={false} />
            {variant === 'detail'
                ? <Skeleton active title={false} paragraph={{ rows: 6, width: ['90%', '70%', '85%', '60%', '75%', '40%'] }} />
                : Array.from({ length: 6 }, (_, index) => (
                    <div className="page-skeleton-row" key={index}>
                        <Skeleton.Input active size="small" block />
                    </div>
                ))}
        </div>
    </div>
)

/**
 * Non-blocking progress line for a page that is refreshing or saving while it stays usable.
 * Use this instead of an overlay when the page content is already on screen.
 */
export const PageLoadingBar = ({ active, label }: { active: boolean, label?: string }) => (
    active ? (
        <div className="page-loading-bar" role="status" aria-live="polite">
            <span className="page-skeleton-label">{label || tr('Loading')}</span>
            <i />
        </div>
    ) : null
)
