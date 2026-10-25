import React from 'react'
import { CheckCircleFilled } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useLanguage } from '@/providers/LanguageProvider'

// Stylised product mock-up for the hero. All figures are illustrative sample data.
// To show a real screenshot instead, render an <img className="landing-preview-shot" /> in place of this component.

const kpis = [
    { label: 'Active SMEs', value: '48' },
    { label: 'Interventions', value: '126' },
    { label: 'On track', value: '87%' },
]

const bars = [42, 58, 50, 72, 66, 88]

const smes = [
    { name: 'Ubuntu Bakery', status: 'Diagnostic', progress: 30 },
    { name: 'Khanya Solar', status: 'In support', progress: 64 },
    { name: 'Siyakha Logistics', status: 'Graduating', progress: 92 },
]

const LandingProductPreview: React.FC = () => {
    const { t } = useLanguage()

    return (
        <div className="landing-preview" aria-hidden="true">
            <div className="landing-preview-window">
                <div className="landing-preview-chrome">
                    <span />
                    <span />
                    <span />
                    <strong>{t('Programme overview')}</strong>
                    <em>{t('Sample data')}</em>
                </div>

                <div className="landing-preview-body">
                    <div className="landing-preview-kpis">
                        {kpis.map(kpi => (
                            <div className="landing-preview-kpi" key={kpi.label}>
                                <small>{t(kpi.label)}</small>
                                <b>{kpi.value}</b>
                            </div>
                        ))}
                    </div>

                    <div className="landing-preview-chart">
                        <small>{t('Interventions completed')}</small>
                        <div className="landing-preview-bars">
                            {bars.map((height, index) => (
                                <motion.span
                                    key={index}
                                    style={{ height: `${height}%` }}
                                    initial={{ scaleY: 0 }}
                                    animate={{ scaleY: 1 }}
                                    transition={{ duration: 0.5, delay: 0.4 + index * 0.06, ease: 'easeOut' }}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="landing-preview-list">
                        {smes.map(sme => (
                            <div className="landing-preview-row" key={sme.name}>
                                <span className="landing-preview-avatar">{sme.name.charAt(0)}</span>
                                <div className="landing-preview-row-main">
                                    <div className="landing-preview-row-top">
                                        <strong>{sme.name}</strong>
                                        <span>{t(sme.status)}</span>
                                    </div>
                                    <div className="landing-preview-progress">
                                        <motion.i
                                            initial={{ width: 0 }}
                                            animate={{ width: `${sme.progress}%` }}
                                            transition={{ duration: 0.7, delay: 0.6, ease: 'easeOut' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <motion.div
                className="landing-preview-toast"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 1.1 }}
            >
                <CheckCircleFilled />
                <div>
                    <strong>{t('Diagnostic complete')}</strong>
                    <small>{t('Support plan ready for review')}</small>
                </div>
            </motion.div>
        </div>
    )
}

export default LandingProductPreview
