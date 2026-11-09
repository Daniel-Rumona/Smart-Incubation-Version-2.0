import { useEffect, useState } from 'react'
import { Select } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listTrainingFunders } from '@/services/clientRevenueService'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingFunder } from '@/types/clientRevenue'

/**
 * "Funded by": one of the company's funders (Funder report > Funders). Each funder's report shows only what is marked
 * as funded by it. Works as a form control (value / onChange).
 */
export const FunderSelect = ({ value, onChange, placeholder }: { value?: string | null, onChange?: (value: string | null) => void, placeholder?: string }) => {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [funders, setFunders] = useState<TrainingFunder[]>()

    useEffect(() => {
        if (!user) return
        let cancelled = false
        listTrainingFunders(user).then((rows) => { if (!cancelled) setFunders(rows) }, () => { if (!cancelled) setFunders([]) })
        return () => { cancelled = true }
    }, [user])

    return (
        <Select
            allowClear
            loading={!funders}
            value={value || undefined}
            onChange={(next?: string) => onChange?.(next || null)}
            placeholder={placeholder || t('Not funded')}
            notFoundContent={t('No funders yet. Add them on the Funder report page.')}
            options={(funders || []).map((funder) => ({ value: funder.id, label: funder.name }))}
        />
    )
}
