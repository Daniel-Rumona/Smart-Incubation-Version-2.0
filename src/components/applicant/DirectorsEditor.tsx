import { useState } from 'react'
import { Alert, Button, Col, Form, Input, InputNumber, Popconfirm, Row, Select, Tag, Typography } from 'antd'
import { DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import type { BusinessDirector, DirectorRole } from '@/types/applicant'
import { ageFromSaIdNumber, genderFromSaIdNumber, totalShare, YOUTH_MAX_AGE } from '@/utils/businessDirectors'
import { findPrimaryDirectorIndex, ownershipForDirectors } from '@/utils/primaryDirector'
import { tr, useLanguage } from '@/providers/LanguageProvider'
import { ModalActions } from '@/components/shared/ModalActions'
import '@/styles/applicant/directors-editor.css'

const { Text } = Typography

const RACE_OPTIONS: { value: BusinessDirector['race'], label: string }[] = [
    { value: 'African', get label() { return tr('Black African') } },
    { value: 'Coloured', get label() { return tr('Coloured') } },
    { value: 'Indian', get label() { return tr('Indian or Asian') } },
    { value: 'White', get label() { return tr('White') } },
    { value: 'Other', get label() { return tr('Other') } },
]

const ROLE_OPTIONS: { value: DirectorRole, label: string }[] = [
    { value: 'both', get label() { return tr('Director and shareholder') } },
    { value: 'director', get label() { return tr('Director only') } },
    { value: 'shareholder', get label() { return tr('Shareholder only') } },
]

const DISABILITY_OPTIONS = [
    { value: 'yes', get label() { return tr('Yes') } },
    { value: 'no', get label() { return tr('No') } },
]

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `director-${Date.now()}`)

type DirectorsEditorProps = {
    directors: BusinessDirector[]
    onChange: (directors: BusinessDirector[]) => boolean | void | Promise<boolean | void>
    self?: { participantName?: string; fullName?: string; email?: string; phone?: string; idNumber?: string; gender?: string; disabilityStatus?: string }
    primaryDirectorUid: string
    saving?: boolean
}

/** The registrant is always a director. Share ownership is a separate choice. */
export default function DirectorsEditor({ directors, onChange, self, primaryDirectorUid, saving = false }: DirectorsEditorProps) {
    const { t } = useLanguage()
    const [form] = Form.useForm<BusinessDirector>()
    const [editing, setEditing] = useState<string | null>(null)
    const [showMore, setShowMore] = useState(false)
    const idNumber = Form.useWatch('idNumber', form) as string | undefined
    const role = Form.useWatch('role', form) as DirectorRole | undefined
    const ownership = ownershipForDirectors(directors)
    const selfIndex = findPrimaryDirectorIndex(directors, primaryDirectorUid, {
        ...self,
        email: self?.email,
        participantName: self?.participantName,
    })
    const primary = selfIndex >= 0 ? directors[selfIndex] : undefined
    const others = directors.filter((_, index) => index !== selfIndex)
    const selfOwns = primary?.role === 'both' || Number(primary?.sharePercent || 0) > 0
    const shareholderTotal = totalShare(directors.filter((d) => d.role !== 'director'))
    const hasShareholders = directors.some((d) => d.role !== 'director')
    const editingSelf = Boolean(primary && editing === primary.id)

    const open = (director?: BusinessDirector) => {
        form.resetFields()
        form.setFieldsValue({ role: 'both', sharePercent: 0, ...director })
        setShowMore(Boolean(director?.disabilityStatus))
        setEditing(director?.id || 'new')
    }

    const updatePrimary = (owns: boolean) => {
        if (!primary) return
        const next: BusinessDirector = {
            ...primary,
            role: owns ? 'both' : 'director',
            sharePercent: owns ? Number(primary.sharePercent || 0) : 0,
        }
        void onChange(directors.map((director) => director.id === primary.id ? next : director))
    }

    const updateShare = (value: number | null) => {
        if (!primary) return
        void onChange(directors.map((d) => d.id === primary.id ? { ...d, role: 'both', sharePercent: value ?? 0 } : d))
    }

    const save = async () => {
        let values: BusinessDirector
        try { values = await form.validateFields() } catch { return }
        const previous = directors.find((row) => row.id === editing)
        const isPrimary = previous && previous.id === primary?.id
        const nextDirector: BusinessDirector = {
            ...previous,
            ...values,
            ...(isPrimary ? {
                fullName: primary.fullName, idNumber: primary.idNumber,
                phone: primary.phone, email: primary.email,
                role: primary.role, sharePercent: primary.sharePercent,
            } : {}),
            id: editing === 'new' ? newId() : (editing as string),
            gender: genderFromSaIdNumber(isPrimary ? primary.idNumber : values.idNumber) || previous?.gender || values.gender,
        }
        const next = editing === 'new'
            ? [...directors, nextDirector]
            : directors.map((d) => d.id === editing ? nextDirector : d)
        if ((await onChange(next)) !== false) setEditing(null)
    }

    const remove = (id: string) => void onChange(directors.filter((d) => d.id !== id))

    const summary = (director: BusinessDirector) => {
        const age = ageFromSaIdNumber(director.idNumber)
        return [
            RACE_OPTIONS.find((option) => option.value === director.race)?.label,
            age !== null ? t('{age} years', undefined, { age }) : null,
            director.role === 'director' ? t('Director only') : director.role === 'shareholder' ? t('Shareholder only') : t('Director and shareholder'),
            director.role !== 'director' ? t('{share}% owner', undefined, { share: Number(director.sharePercent) || 0 }) : null,
        ].filter(Boolean).join(' · ')
    }

    const idFacts = (() => {
        if (!/^\d{13}$/.test(String(idNumber || ''))) return null
        const age = ageFromSaIdNumber(idNumber)
        const gender = genderFromSaIdNumber(idNumber)
        return [gender ? t(gender) : null, age !== null ? t('{age} years', undefined, { age }) : null].filter(Boolean).join(' · ')
    })()

    return (
        <div className="directors-editor">
            {primary && (
                <div className="directors-primary" style={{ padding: 14, border: '1px solid var(--ant-color-border-secondary)', borderRadius: 14, marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="directors-avatar" aria-hidden="true">{initials(primary.fullName)}</span>
                        <div style={{ flex: 1, minWidth: 160 }}>
                            <Text strong>{primary.fullName || t('Your details')}</Text>
                            <div><Text type="secondary">{t('Primary director')}</Text></div>
                        </div>
                        <Tag>{t('You')}</Tag>
                        <Button size="small" onClick={() => open(primary)}>{t('Edit ownership details')}</Button>
                    </div>
                    <Text type="secondary" style={{ display: 'block', margin: '10px 0' }}>{t('Your name and contact details come from Personal and Contact.')}</Text>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <Text strong>{t('Do you own shares in the business?')}</Text>
                        <Select style={{ width: 120 }} aria-label={t('Do you own shares in the business?')}
                            value={selfOwns ? 'yes' : 'no'}
                            options={[{ value: 'yes', label: t('Yes') }, { value: 'no', label: t('No') }]}
                            onChange={(value) => updatePrimary(value === 'yes')} />
                    </div>
                    {selfOwns && (
                        <div style={{ marginTop: 12, maxWidth: 260 }}>
                            <Text>{t('Your ownership share (%)')}</Text>
                            <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} value={Number(primary.sharePercent || 0)} onChange={updateShare} />
                        </div>
                    )}
                </div>
            )}
            {others.length > 0 && (
                <ul className="directors-list">
                    {others.map((director) => (
                        <li key={director.id} className="directors-row">
                            <span className="directors-avatar" aria-hidden="true">{initials(director.fullName)}</span>
                            <div className="directors-row-main">
                                <Text strong>{director.fullName}</Text>
                                <Text type="secondary" className="directors-row-meta">{summary(director)}</Text>
                            </div>
                            <div className="directors-row-actions">
                                <Button type="text" shape="circle" icon={<EditOutlined />} onClick={() => open(director)} aria-label={t('Edit {name}', undefined, { name: director.fullName })} />
                                <Popconfirm title={t('Remove {name}?', undefined, { name: director.fullName })} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => remove(director.id)}>
                                    <Button type="text" shape="circle" danger icon={<DeleteOutlined />} aria-label={t('Remove {name}', undefined, { name: director.fullName })} />
                                </Popconfirm>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <Button icon={<PlusOutlined />} onClick={() => open()} className="directors-add">{t('Add another director or shareholder')}</Button>

            {hasShareholders && (
                <div className="directors-ownership">
                    <Text type="secondary" className="directors-ownership-label">{t('Ownership, calculated from shareholders')}</Text>
                    <div className="directors-ownership-grid">
                        <div><Text strong>{ownership.blackOwnedPercent}%</Text><Text type="secondary">{t('Black-owned')}</Text></div>
                        <div><Text strong>{ownership.femaleOwnedPercent}%</Text><Text type="secondary">{t('Female-owned')}</Text></div>
                        <div><Text strong>{ownership.youthOwnedPercent}%</Text><Text type="secondary">{t('Youth-owned ({age} and under)', undefined, { age: YOUTH_MAX_AGE })}</Text></div>
                    </div>
                    {Math.abs(shareholderTotal - 100) > 0.001 && (
                        <Alert type="warning" showIcon message={t('Shares add up to {total}%. They should add up to 100%.', undefined, { total: shareholderTotal })} />
                    )}
                </div>
            )}

            <ResponsiveModal open={editing !== null} onClose={() => setEditing(null)}
                title={editingSelf ? t('Your director details') : editing === 'new' ? t('Add director or shareholder') : t('Edit director or shareholder')}
                width={560}
                footer={<ModalActions><Button type="primary" loading={saving} onClick={() => void save()}>{t('Save')}</Button></ModalActions>}>
                <Form form={form} layout="vertical" requiredMark>
                    {editingSelf && <Text type="secondary">{t('Edit your identity and contact details in Personal or Contact. Only ownership and additional details are editable here.')}</Text>}
                    <Row gutter={12} style={{ marginTop: 12 }}>
                        <Col xs={24} md={12}>
                            <Form.Item name="fullName" label={t('Full name')} rules={[{ required: true, whitespace: true }]}>
                                <Input disabled={editingSelf} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="idNumber" label={t('ID number')}
                                extra={idFacts || t('Age and gender are read from the ID number.')}
                                rules={[{ required: !editingSelf }, { pattern: /^\d{13}$/, message: t('Enter the 13-digit South African ID number.') }]}>
                                <Input disabled={editingSelf} inputMode="numeric" maxLength={13} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="race" label={t('Race')} rules={[{ required: true }]}>
                                <Select options={RACE_OPTIONS} placeholder={t('Select option')} />
                            </Form.Item>
                        </Col>
                        {!editingSelf && (
                            <Col xs={24} md={12}>
                                <Form.Item name="role" label={t('Role')} rules={[{ required: true }]}>
                                    <Select options={ROLE_OPTIONS} />
                                </Form.Item>
                            </Col>
                        )}
                        {!editingSelf && role !== 'director' && (
                            <Col xs={24} md={12}>
                                <Form.Item name="sharePercent" label={t('Ownership share %')} rules={[{ required: true }]}>
                                    <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                        )}
                        <Col xs={24} md={12}>
                            <Form.Item name="phone" label={t('Phone number')} rules={[{ required: !editingSelf, whitespace: true }]}>
                                <Input disabled={editingSelf} inputMode="tel" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="email" label={t('Email')} rules={[{ required: !editingSelf }, { type: 'email', message: t('Enter a valid email address') }]}>
                                <Input disabled={editingSelf} inputMode="email" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Button type="link" size="small" className="directors-more-toggle"
                        onClick={() => setShowMore((value) => !value)}
                        icon={showMore ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
                        {t('Disability details (optional)')}
                    </Button>
                    {showMore && <Row gutter={12} className="directors-more">
                        <Col xs={24} md={12}>
                            <Form.Item name="disabilityStatus" label={t('Disability status')}>
                                <Select allowClear options={DISABILITY_OPTIONS} placeholder={t('Select option')} />
                            </Form.Item>
                        </Col>
                    </Row>}
                </Form>
            </ResponsiveModal>
        </div>
    )
}
