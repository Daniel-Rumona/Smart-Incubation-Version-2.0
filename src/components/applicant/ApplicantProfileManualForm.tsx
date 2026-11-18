import { useEffect, useMemo } from 'react'
import { Col, DatePicker, Form, Input, InputNumber, Row, Select } from 'antd'
import { ManOutlined, WomanOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import DirectorsEditor from '@/components/applicant/DirectorsEditor'
import type { ApplicantProfileFormValues } from '@/pages/applicant/ApplicantProfilePage'
import type { BusinessDirector } from '@/types/applicant'
import { reconcilePrimaryDirector, ownershipForDirectors } from '@/utils/primaryDirector'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const genderOptions = [
    { value: 'Male', get label() { return tr('Male') }, Icon: ManOutlined },
    { value: 'Female', get label() { return tr('Female') }, Icon: WomanOutlined },
]

function GenderChoiceGroup({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
    const { t } = useLanguage()
    return (
        <div className="applicant-profile-choice-grid" role="radiogroup" aria-label={t('Gender')}>
            {genderOptions.map(({ value: optionValue, label, Icon }) => (
                <button
                    key={optionValue}
                    type="button"
                    role="radio"
                    aria-checked={value === optionValue}
                    className={`applicant-profile-choice-card${value === optionValue ? ' is-selected' : ''}`}
                    onClick={() => onChange?.(optionValue)}
                >
                    <Icon />
                    <strong>{label}</strong>
                </button>
            ))}
        </div>
    )
}

const sectors = [
    'Agriculture',
    'Construction',
    'Education',
    'Finance',
    'Health',
    'Information Technology',
    'Manufacturing',
    'Retail',
    'Tourism and Hospitality',
    'Transport and Logistics',
    'Other',
]

const provinces = [
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'Northern Cape',
    'North West',
    'Western Cape',
]

const selectFilter = (input: string, option?: { label?: string; value?: string }) =>
    String(option?.label ?? option?.value ?? '').toLowerCase().includes(input.toLowerCase())

function isValidSouthAfricanID(value?: string) {
    if (!value) return true
    return /^\d{13}$/.test(value)
}

function isValidZARegistration(value?: string) {
    if (!value) return true
    return /^\d{4}\/\d{6}\/\d{2}$/.test(value) || /^[A-Za-z0-9\-/ ]{4,30}$/.test(value)
}

type ApplicantProfileManualFormProps = {
    activeStep: number
    email?: string
    /** The business profile lists directors in a section of their own, so it hides them from the business step. */
    showDirectors?: boolean
    primaryDirectorUid?: string
}

export default function ApplicantProfileManualForm({ activeStep, email, showDirectors = true, primaryDirectorUid = '' }: ApplicantProfileManualFormProps) {
    const { t } = useLanguage()
    const form = Form.useFormInstance<ApplicantProfileFormValues>()
    const registrationStatus = Form.useWatch('registrationStatus', form)
    const registrationFieldsDisabled = registrationStatus === 'not_registered'
    const directors = (Form.useWatch('directors', { form, preserve: true }) as BusinessDirector[] | undefined) || []
    const profileValues = Form.useWatch([], { form, preserve: true }) as ApplicantProfileFormValues | undefined
    // With directors captured, the three ownership percentages are their sum and can't be typed.

    const setDirectors = (next: BusinessDirector[]) => {
        const current = form.getFieldsValue(true) as ApplicantProfileFormValues
        const reconciled = reconcilePrimaryDirector(next, primaryDirectorUid, { ...current, email: email || current.email })
        form.setFieldsValue({ directors: reconciled, ...ownershipForDirectors(reconciled) })
    }

    const currentYear = useMemo(() => dayjs().year(), [])

    useEffect(() => {
        if (email) form.setFieldValue('email', email)
    }, [email, form])

    useEffect(() => {
        if (registrationStatus === 'not_registered') {
            form.setFieldsValue({
                registrationNumber: undefined,
                dateOfRegistration: undefined,
            })
        }
    }, [form, registrationStatus])

    if (activeStep === 0) {
        return (
            <section className="applicant-profile-step-panel">
                <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
                    <Col xs={24} md={8}>
                        <Form.Item name="participantName" label={t('Full name')} rules={[{ required: true }]}>
                            <Input placeholder={t('Applicant full name')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="email" label={t('Email')} rules={[{ required: true }, { type: 'email' }]}>
                            <Input inputMode="email" placeholder="name@example.com" disabled />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="gender" label={t('Gender')} rules={[{ required: true }]}>
                            <GenderChoiceGroup />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item
                            name="idNumber"
                            label={t('ID number')}
                            rules={[
                                { required: true, message: t('ID number is required') },
                                {
                                    validator: (_, value) =>
                                        isValidSouthAfricanID(value)
                                            ? Promise.resolve()
                                            : Promise.reject(new Error('Enter a valid 13 digit South African ID number')),
                                },
                            ]}
                            getValueFromEvent={(event) => event.target.value.replace(/\D/g, '').slice(0, 13)}
                        >
                            <Input inputMode="numeric" maxLength={13} placeholder={t('e.g. 9001015009087')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="maritalStatus" label={t('Marital status')}>
                            <Select
                                allowClear
                                placeholder={t('Select marital status')}
                                options={[
                                    { value: 'single', label: t('Single') },
                                    { value: 'married', label: t('Married') },
                                    { value: 'divorced', label: t('Divorced') },
                                    { value: 'widowed', label: t('Widowed') },
                                ]}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="educationLevel" label={t('Education level')}>
                            <Select
                                allowClear
                                placeholder={t('Select education level')}
                                options={[
                                    { value: 'primary', label: t('Primary') },
                                    { value: 'secondary', label: t('Secondary') },
                                    { value: 'certificate', label: t('Certificate') },
                                    { value: 'diploma', label: t('Diploma') },
                                    { value: 'degree', label: t('Degree') },
                                    { value: 'postgraduate', label: t('Postgraduate') },
                                    { value: 'other', label: t('Other') },
                                ]}
                            />
                        </Form.Item>
                    </Col>
                </Row>
            </section>
        )
    }

    if (activeStep === 1) {
        return (
            <section className="applicant-profile-step-panel">
                <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
                    <Col xs={24} md={8}>
                        <Form.Item name="phone" label={t('Phone number')} rules={[{ required: true }]}>
                            <Input inputMode="tel" placeholder={t('e.g. 082 123 4567')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="alternativePhone" label={t('Alternative phone')}>
                            <Input inputMode="tel" placeholder={t('Optional')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="employmentStatus" label={t('Employment status')}>
                            <Select
                                allowClear
                                placeholder={t('Select employment status')}
                                options={[
                                    { value: 'employed', label: t('Employed') },
                                    { value: 'self_employed', label: t('Self-employed') },
                                    { value: 'unemployed', label: t('Unemployed') },
                                    { value: 'student', label: t('Student') },
                                    { value: 'other', label: t('Other') },
                                ]}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="disabilityStatus" label={t('Disability status')}>
                            <Select
                                allowClear
                                placeholder={t('Select option')}
                                options={[
                                    { value: 'yes', label: t('Yes') },
                                    { value: 'no', label: t('No') },
                                ]}
                            />
                        </Form.Item>
                    </Col>
                </Row>
            </section>
        )
    }

    if (activeStep === 2) {
        return (
            <section className="applicant-profile-step-panel">
                <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
                    <Col xs={24} md={12}>
                        <Form.Item name="businessName" label={t('Business name')} rules={[{ required: true }]}>
                            <Input placeholder={t('Company or trading name')} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="sector" label={t('Sector')} rules={[{ required: true }]}>
                            <Select
                                showSearch
                                allowClear
                                placeholder={t('Select sector')}
                                filterOption={selectFilter}
                                options={sectors.map((sector) => ({ value: sector, label: sector }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24}>
                        <Form.Item
                            name="natureOfBusiness"
                            label={t('Nature of business')}
                            rules={[{ required: true, message: tr('Explain what the business offers') }]}
                        >
                            <Input.TextArea autoSize={{ minRows: 4 }} placeholder={t('Describe products, services, customers, and operations')} />
                        </Form.Item>
                    </Col>
                    {showDirectors && (
                        <Col xs={24}>
                            <span className="applicant-profile-section-label">{t('Directors and shareholders')}</span>
                            <DirectorsEditor directors={directors} onChange={setDirectors} self={profileValues} primaryDirectorUid={primaryDirectorUid} />
                        </Col>
                    )}
                    {/* Show manual ownership fields only when there is no calculated summary. */}
                    {!showDirectors && (
                        <>
                            <Col xs={24} md={8}>
                                <Form.Item name="youthOwnedPercent" label={t('Youth-owned %')} >
                                    <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                                <Form.Item name="femaleOwnedPercent" label={t('Female-owned %')} >
                                    <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                                <Form.Item name="blackOwnedPercent" label={t('Black-owned %')} >
                                    <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                        </>
                    )}
                </Row>
            </section>
        )
    }

    if (activeStep === 3) {
        return (
            <section className="applicant-profile-step-panel">
                <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
                    <Col xs={24} md={12}>
                        <Form.Item name="registrationStatus" label={t('Registration status')}>
                            <Select
                                allowClear
                                placeholder={t('Select status')}
                                options={[
                                    { value: 'registered', label: t('Registered') },
                                    { value: 'not_registered', label: t('Not registered') },
                                    { value: 'in_progress', label: t('In progress') },
                                ]}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item
                            name="registrationNumber"
                            label={t('Registration number')}
                            rules={[
                                { required: registrationStatus === 'registered', message: tr('Registration number is required when registered') },
                                {
                                    validator: (_, value) =>
                                        isValidZARegistration(value)
                                            ? Promise.resolve()
                                            : Promise.reject(new Error('Enter a valid registration number')),
                                },
                            ]}
                        >
                            <Input placeholder={t('e.g. 2024/123456/07')} disabled={registrationFieldsDisabled} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="dateOfRegistration" label={t('Date of registration')}>
                            <DatePicker
                                style={{ width: '100%' }}
                                disabled={registrationFieldsDisabled}
                                disabledDate={(date) => !!date && date.year() > currentYear}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="yearsOfTrading" label={t('Years of trading')} rules={[{ required: true }]}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="beeLevel" label={t('B-BBEE level')}>
                            <Select
                                allowClear
                                placeholder={t('Select level')}
                                options={['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8', 'Not sure'].map((value) => ({ value, label: value }))}
                            />
                        </Form.Item>
                    </Col>
                </Row>
            </section>
        )
    }

    return (
        <section className="applicant-profile-step-panel">
            <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
                <Col xs={24} md={8}>
                    <Form.Item name="province" label={t('Province')} rules={[{ required: true }]}>
                        <Select
                            showSearch
                            allowClear
                            placeholder={t('Select province')}
                            filterOption={selectFilter}
                            options={provinces.map((province) => ({ value: province, label: province }))}
                        />
                    </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                    <Form.Item name="city" label={t('City / town')} rules={[{ required: true }]}>
                        <Input placeholder={t('City or town')} />
                    </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                    <Form.Item name="postalCode" label={t('Postal code')}>
                        <Input inputMode="numeric" placeholder={t('Optional')} />
                    </Form.Item>
                </Col>
                <Col xs={24}>
                    <Form.Item name="businessAddress" label={t('Business address')} rules={[{ required: true }]}>
                        <Input.TextArea autoSize={{ minRows: 3 }} placeholder={t('Physical operating address')} />
                    </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                    <Form.Item name="hostCommunity" label={t('Host community')}>
                        <Input placeholder={t('Community, township, industrial area, or ward')} />
                    </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                    <Form.Item name="locationType" label={t('Location type')}>
                        <Select
                            allowClear
                            placeholder={t('Select location type')}
                            options={[
                                { value: 'urban', label: t('Urban') },
                                { value: 'peri_urban', label: t('Peri-urban') },
                                { value: 'rural', label: t('Rural') },
                                { value: 'industrial', label: t('Industrial') },
                                { value: 'home_based', label: t('Home-based') },
                            ]}
                        />
                    </Form.Item>
                </Col>
            </Row>
        </section>
    )
}
