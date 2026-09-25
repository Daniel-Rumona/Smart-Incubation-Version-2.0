import { useEffect, useMemo, useState } from 'react'
import { Button, Modal, Progress, Tag, Typography } from 'antd'
import { CaretRightOutlined, PauseOutlined, ReloadOutlined } from '@ant-design/icons'
import '@/styles/plan-projection.css'
import { useLanguage } from '@/providers/LanguageProvider'

type ProjectionItem = { interventionId?: string, id?: string, title: string, areaOfSupport?: string, status?: string, progress?: number }

const STEP_MS = 1900

const statusTone = (status?: string) => status === 'Completed' ? 'green' : status === 'In progress' ? 'blue' : 'orange'

export const PlanProjectionPreview = ({ interventions }: { interventions: ProjectionItem[] }) => {
    const { t } = useLanguage()
    const [open, setOpen] = useState(false)
    const [index, setIndex] = useState(0)
    const [playing, setPlaying] = useState(true)

    const projectedFinish = useMemo(() => {
        const date = new Date()
        date.setDate(date.getDate() + Math.max(1, interventions.length) * 28)
        return date
    }, [interventions.length])

    // One intervention holds the frame at a time; the next fades in as the previous fades out.
    useEffect(() => {
        if (!open || !playing || interventions.length < 2) return
        const timer = window.setTimeout(() => {
            setIndex((current) => {
                if (current + 1 >= interventions.length) {
                    setPlaying(false)
                    return current
                }
                return current + 1
            })
        }, STEP_MS)
        return () => window.clearTimeout(timer)
    }, [open, playing, index, interventions.length])

    const start = () => {
        setIndex(0)
        setPlaying(true)
        setOpen(true)
    }

    const current = interventions[index]
    const reachedEnd = index >= interventions.length - 1 && !playing
    const journeyPercent = interventions.length ? Math.round(((index + 1) / interventions.length) * 100) : 0

    return <>
        <Button size="small" icon={<CaretRightOutlined />} disabled={!interventions.length} onClick={start}>{t('Preview journey')}</Button>

        <Modal
            open={open}
            onCancel={() => setOpen(false)}
            footer={null}
            width={460}
            title={t('Projected journey')}
            className="plan-projection-modal"
        >
            <p className="plan-projection-summary">
                {interventions.length} {t('intervention')}{interventions.length === 1 ? '' : 's'} {t('· projected finish')} {projectedFinish.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
            </p>

            {current && (
                /* Keying on the index restarts the fade, so each stage arrives on its own. */
                <div className="plan-projection-stage" key={index}>
                    <span className="plan-projection-step">{index + 1}</span>

                    <strong className="plan-projection-title">{current.title}</strong>

                    <span className="plan-projection-area">{current.areaOfSupport || t('General support')}</span>

                    <Tag color={statusTone(current.status)} className="plan-projection-tag">
                        {current.status || t('Awaiting action')}
                    </Tag>

                    <Progress percent={current.progress || 0} size="small" className="plan-projection-item-progress" />
                </div>
            )}

            <div className="plan-projection-track" role="tablist" aria-label={t('Journey stages')}>
                {interventions.map((item, dotIndex) => (
                    <button
                        type="button"
                        key={item.id || item.interventionId || item.title}
                        className={`plan-projection-dot${dotIndex === index ? ' is-active' : ''}${dotIndex < index ? ' is-passed' : ''}`}
                        aria-label={`Stage ${dotIndex + 1}: ${item.title}`}
                        aria-selected={dotIndex === index}
                        role="tab"
                        onClick={() => { setPlaying(false); setIndex(dotIndex) }}
                    />
                ))}
            </div>

            <div className="plan-projection-controls">
                <Typography.Text type="secondary">{t('Stage')} {index + 1} {t('of')} {interventions.length} · {journeyPercent}%</Typography.Text>

                <Button
                    type="text"
                    size="small"
                    icon={reachedEnd ? <ReloadOutlined /> : playing ? <PauseOutlined /> : <CaretRightOutlined />}
                    onClick={() => {
                        if (reachedEnd) { setIndex(0); setPlaying(true); return }
                        setPlaying((value) => !value)
                    }}
                >
                    {reachedEnd ? t('Replay') : playing ? t('Pause') : t('Play')}
                </Button>
            </div>

            <p className="plan-projection-note">
                {t('An estimate: roughly four weeks per intervention, adjusting as real dates and progress are captured.')}
            </p>
        </Modal>
    </>
}
