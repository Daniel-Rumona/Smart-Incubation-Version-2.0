import { useState } from 'react'
import { Alert, Button, Col, Empty, Form, Input, InputNumber, Popconfirm, Row, Select, Tag, Typography } from 'antd'
import { DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import type { BusinessDirector, DirectorRole } from '@/types/applicant'
import { ageFromSaIdNumber, genderFromSaIdNumber, ownershipFromDirectors, totalShare, YOUTH_MAX_AGE } from '@/utils/businessDirectors'
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
    { value: 'prefer_not_to_say', get label() { return tr('Prefer not to say') } },
]

const OPTIONAL_FIELDS: (keyof BusinessDirector)[] = ['role', 'phone', 'email', 'disabilityStatus']

/** The editor's own marker for the SME's not-yet-saved row. */
const SELF_ID = 'self'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `director-${Date.now()}`)

const sameName = (left?: string, right?: string) => Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase())

type DirectorsEditorProps = {
    directors: BusinessDirector[]
    /** Receives the whole new list; resolve false to keep the editor open (for example when saving failed). */
    onChange: (directors: BusinessDirector[]) => boolean | void | Promise<boolean | void>
    /**
     * The SME's own details from their profile. They are a director by default: until they are in
     * the list, they show as the first row, already filled in apart from race and share.
     */
    self?: Partial<BusinessDirector>
    saving?: boolean
}

/**
 * Directors and shareholders: a list with add, edit and remove, plus the Black-, female- and
 * youth-owned percentages worked out from their shares.
 */
export default function DirectorsEditor({ directors, onChange, self, saving = false }: DirectorsEditorProps) {
    const { t } = useLanguage()
    const [form] = Form.useForm<BusinessDirector>()
    // `null` closed, `new` adding, `self` completing the SME's own row, otherwise the id being edited.
    const [editing, setEditing] = useState<string | null>(null)
    const [showMore, setShowMore] = useState(false)
    const idNumber = Form.useWatch('idNumber', form) as string | undefined

    const ownership = ownershipFromDirectors(directors)
    const total = totalShare(directors)

    const isSelf = (director: Partial<BusinessDirector>) => Boolean(self) && (
        (self?.idNumber && director.idNumber === self.idNumber) || (!self?.idNumber && sameName(director.fullName, self?.fullName))
    )
    const selfListed = directors.some(isSelf)
    const selfPending = Boolean(self?.fullName) && !selfListed

    const open = (director?: Partial<BusinessDirector>, key?: string) => {
        form.resetFields()
        form.setFieldsValue({ role: 'both', ...director } as BusinessDirector)
        setShowMore(OPTIONAL_FIELDS.some((field) => field !== 'role' && director?.[field]))
        setEditing(key || director?.id || 'new')
    }

    // A sole director owns the whole business, so their share starts at 100%.
    const openSelf = () => open({ ...self, sharePercent: directors.length ? undefined : 100 }, SELF_ID)

    const save = async () => {
        const values = await form.validateFields()
        // Gender is read from the ID number rather than asked for again.
        const previous = directors.find((existing) => existing.id === editing)
        const director = { ...values, gender: genderFromSaIdNumber(values.idNumber) || previous?.gender } as BusinessDirector
        const adding = editing === 'new' || editing === SELF_ID
        const id = adding ? newId() : (editing as string)
        const next = adding
            ? (editing === SELF_ID ? [{ ...director, id }, ...directors] : [...directors, { ...director, id }])
            : directors.map((existing) => (existing.id === id ? { ...director, id } : existing))
        if ((await onChange(next)) !== false) setEditing(null)
    }

    const remove = (id: string) => void onChange(directors.filter((director) => director.id !== id))

    const summary = (director: BusinessDirector) => {
        const age = ageFromSaIdNumber(director.idNumber)
        return [
            director.gender ? t(director.gender) : null,
            RACE_OPTIONS.find((option) => option.value === director.race)?.label,
            age !== null ? t('{age} years', undefined, { age }) : null,
            t('{share}% owner', undefined, { share: Number(director.sharePercent) || 0 }),
            director.role && director.role !== 'both' ? ROLE_OPTIONS.find((option) => option.value === director.role)?.label : null,
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
            {directors.length || selfPending ? (
                <ul className="directors-list">
                    {selfPending && (
                        <li className="directors-row is-pending">
                            <span className="directors-avatar" aria-hidden="true">{initials(self?.fullName || '')}</span>
                            <div className="directors-row-main">
                                <span className="directors-row-title">
                                    <Text strong>{self?.fullName}</Text>
                                    <Tag>{t('You')}</Tag>
                                </span>
                                <Text type="secondary" className="directors-row-meta">{t('Add your race and share to finish your director details.')}</Text>
                            </div>
                            <div className="directors-row-actions">
                                <Button size="small" type="primary" onClick={openSelf}>{t('Complete')}</Button>
                            </div>
                        </li>
                    )}
                    {directors.map((director) => (
                        <li key={director.id} className="directors-row">
                            <span className="directors-avatar" aria-hidden="true">{initials(director.fullName)}</span>
                            <div className="directors-row-main">
                                <span className="directors-row-title">
                                    <Text strong>{director.fullName}</Text>
                                    {isSelf(director) && <Tag>{t('You')}</Tag>}
                                </span>
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
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Add everyone who owns or runs the business.')} />
            )}

            <Button icon={<PlusOutlined />} onClick={() => open()} className="directors-add">
                {selfPending || directors.length ? t('Add another director') : t('Add director')}
            </Button>

            {directors.length > 0 && (
                <div className="directors-ownership">
                    <Text type="secondary" className="directors-ownership-label">{t('Ownership, worked out from your directors')}</Text>
                    <div className="directors-ownership-grid">
                        <div><Text strong>{ownership.blackOwnedPercent}%</Text><Text type="secondary">{t('Black-owned')}</Text></div>
                        <div><Text strong>{ownership.femaleOwnedPercent}%</Text><Text type="secondary">{t('Female-owned')}</Text></div>
                        <div><Text strong>{ownership.youthOwnedPercent}%</Text><Text type="secondary">{t('Youth-owned ({age} and under)', undefined, { age: YOUTH_MAX_AGE })}</Text></div>
                    </div>
                    {total !== 100 && (
                        <Alert
                            type="warning"
                            showIcon
                            message={t('Shares add up to {total}%. They should add up to 100%.', undefined, { total })}
                        />
                    )}
                </div>
            )}

            <ResponsiveModal
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={editing === SELF_ID ? t('Your director details') : editing === 'new' ? t('Add director') : t('Edit director')}
                width={560}
                footer={<ModalActions>
                    <Button type="primary" loading={saving} onClick={() => void save()}>{t('Save director')}</Button>
                </ModalActions>}
            >
                <Form form={form} layout="vertical" requiredMark>
                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <Form.Item name="fullName" label={t('Full name')} rules={[{ required: true, whitespace: true }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name="idNumber"
                                label={t('ID number')}
                                extra={idFacts || t('Age and gender are read from the ID number.')}
                                rules={[
                                    { required: true },
                                    { pattern: /^\d{13}$/, message: t('Enter the 13-digit South African ID number.') },
                                ]}
                            >
                                <Input inputMode="numeric" maxLength={13} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="race" label={t('Race')} rules={[{ required: true }]}>
                                <Select options={RACE_OPTIONS} placeholder={t('Select option')} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="sharePercent" label={t('Ownership share %')} rules={[{ required: true }]}>
                                <InputNumber min={0} max={100} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Button type="link" size="small" className="directors-more-toggle" onClick={() => setShowMore((value) => !value)} icon={showMore ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
                        {t('More details (optional)')}
                    </Button>

                    {/* Kept mounted while hidden so values already entered are not lost. */}
                    <Row gutter={12} hidden={!showMore} className="directors-more">
                        <Col xs={24} md={12}>
                            <Form.Item name="role" label={t('Role')}>
                                <Select options={ROLE_OPTIONS} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="disabilityStatus" label={t('Disability status')}>
                                <Select allowClear options={DISABILITY_OPTIONS} placeholder={t('Select option')} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="phone" label={t('Phone')}>
                                <Input inputMode="tel" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="email" label={t('Email')} rules={[{ type: 'email', message: t('Enter a valid email address') }]}>
                                <Input inputMode="email" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </ResponsiveModal>
        </div>
    )
}
