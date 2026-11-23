import { useEffect, useState } from 'react'
import { Button, Modal, Radio, Space, Typography } from 'antd'
import { UserAddOutlined } from '@ant-design/icons'
import type { ProspectModule } from '@/config/prospects'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { listProspectOwners, listProspects } from '@/services/prospectsService'
import { listProgramsForCompany } from '@/services/workspaceProgramsService'
import type { Prospect } from '@/types/prospects'
import type { TrainingClass, TrainingLearner } from '@/types/training'
import type { ParsedProspect } from '@/utils/prospectImport'
import { ImportProspectsModal } from './ImportProspectsModal'

/**
 * "Add to prospects" on a training class: each learner's company (or the learner, when no company is given) becomes
 * a lead with the class as its source. Only within the same company: the leads stay with whoever ran the class.
 * A company that also runs incubation programmes chooses which side the leads are for.
 */
export function AddLearnersToProspects({ trainingClass, learners }: { trainingClass: TrainingClass, learners: TrainingLearner[] }) {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [open, setOpen] = useState(false)
    const [hasProgrammes, setHasProgrammes] = useState(false)
    const [module, setModule] = useState<ProspectModule | null>(null)
    const [existing, setExisting] = useState<Prospect[]>()
    const [owners, setOwners] = useState<Array<{ uid: string, name: string }>>([])

    useEffect(() => {
        if (!open || !user?.companyCode) return
        let cancelled = false
        void listProgramsForCompany(String(user.companyCode)).catch(() => []).then((programs) => {
            if (cancelled) return
            setHasProgrammes(programs.length > 0)
            if (!programs.length) setModule('training')
        })
        return () => { cancelled = true }
    }, [open, user?.companyCode])

    useEffect(() => {
        if (!module || !user) return
        let cancelled = false
        void Promise.all([listProspects(user, module).catch(() => []), listProspectOwners(user).catch(() => [])]).then(([rows, people]) => {
            if (!cancelled) { setExisting(rows); setOwners(people) }
        })
        return () => { cancelled = true }
    }, [module, user])

    const close = () => { setOpen(false); setModule(null); setExisting(undefined) }

    const companies = new Map<string, ParsedProspect>()
    const people: ParsedProspect[] = []
    for (const learner of learners) {
        const organisation = (learner.organisation || '').trim()
        if (organisation) {
            const key = organisation.toLowerCase()
            if (!companies.has(key)) companies.set(key, { kind: 'business', businessName: organisation, contactName: learner.name, phone: learner.phone || '', email: learner.email || '' })
        } else {
            people.push({ kind: 'person', contactName: learner.name, phone: learner.phone || '', email: learner.email || '' })
        }
    }
    const rows: ParsedProspect[] = [...companies.values(), ...people]

    return (
        <>
            <Button icon={<UserAddOutlined />} disabled={!learners.length} onClick={() => setOpen(true)}>{t('Add to prospects')}</Button>
            {open && !module && hasProgrammes && (
                <Modal open title={t('Add to prospects')} okText={t('Continue')} onCancel={close} footer={null}>
                    <Space orientation="vertical">
                        <Typography.Text>{t('Who might these learners and their companies become?')}</Typography.Text>
                        <Radio.Group onChange={(event) => setModule(event.target.value)} options={[
                            { value: 'incubation', label: t('Businesses for our programmes') },
                            { value: 'training', label: t('Clients for more training') },
                        ]} />
                    </Space>
                </Modal>
            )}
            {open && module && existing && (
                <ImportProspectsModal
                    module={module}
                    existing={existing}
                    owners={owners}
                    initial={{ rows, source: 'training_class', sourceDetail: `${trainingClass.courseTitle}, ${trainingClass.startDate}` }}
                    onClose={close}
                    onImported={close}
                />
            )}
        </>
    )
}
