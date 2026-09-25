import { App, Avatar, Button, Card, Checkbox, Col, Form, Input, InputNumber, Row, Segmented, Select, Switch, Tag, TimePicker, Typography, Upload } from 'antd'
import { AimOutlined, BankOutlined, CalendarOutlined, CameraOutlined, ClockCircleOutlined, DeleteOutlined, EnvironmentOutlined, FacebookOutlined, GlobalOutlined, IdcardOutlined, LinkedinOutlined, LinkOutlined, MailOutlined, PhoneOutlined, PlusOutlined, SafetyCertificateOutlined, SaveOutlined, SolutionOutlined, UserOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { hasConsultantMarketplaceProfile } from '@/services/companiesService'
import { provincesForCountry } from '@/config/sadc'
import { createEmptyConsultantProfile, getConsultantProfile, saveConsultantProfile, uploadConsultantProfileImage } from '@/services/consultantMarketplaceService'
import type { ConsultantMarketplaceProfile, ConsultantServiceOffer } from '@/types/consultantMarketplace'
import '@/styles/consultant.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const SUPPORTED_COUNTRIES = [
    { value: 'South Africa', currencies: ['ZAR'], Icon: EnvironmentOutlined, get detail() { return tr('South African Rand') } },
    { value: 'Zimbabwe', currencies: ['ZWL', 'ZAR', 'USD'], Icon: GlobalOutlined, get detail() { return tr('Zimbabwean Dollar') } },
] as const
const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SPECIAL_AVAILABILITY_OPTIONS = [
    { value: 'available', get label() { return tr('Available') } },
    { value: 'on_request', get label() { return tr('On request') } },
    { value: 'unavailable', get label() { return tr('Unavailable') } },
] as const

const diallingCodeForCountry = (country: string) => country === 'South Africa' ? '+27' : country === 'Zimbabwe' ? '+263' : ''
const localPhoneNumber = (phone: string) => phone.replace(/^\+(?:27|263)/, '').replace(/\D/g, '').replace(/^0/, '')
const formatLocalPhoneNumber = (phone: string) => {
    const local = localPhoneNumber(phone).slice(0, 9)
    return [local.slice(0, 2), local.slice(2, 5), local.slice(5, 9)].filter(Boolean).join(' ')
}
const expectedPhoneLengthForCountry = (country: string) => diallingCodeForCountry(country) ? 9 : 0
const withDiallingCode = (phone: string, country: string) => {
    const local = localPhoneNumber(phone)
    const diallingCode = diallingCodeForCountry(country)
    return local && diallingCode ? `${diallingCode}${local}` : local
}
const timeToMinutes = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number)
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0
}
const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

function ConsultantMarketplaceProfileForm() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { message } = App.useApp()
    const [profile, setProfile] = useState<ConsultantMarketplaceProfile>()
    const [saving, setSaving] = useState(false)
    const [activeSection, setActiveSection] = useState('Professional')
    const [newServiceId, setNewServiceId] = useState<string>()
    const [activeAvailabilityDay, setActiveAvailabilityDay] = useState(1)
    const newService = (): ConsultantServiceOffer => ({ id: crypto.randomUUID(), areaOfSupport: '', interventionExamples: [], deliveryMode: 'online', rate: 0, rateUnit: 'day' })

    useEffect(() => {
        if (!user) return
        void getConsultantProfile(user.uid, { name: user.displayName, email: user.email })
            .then(setProfile)
            .catch(() => setProfile(createEmptyConsultantProfile(user.uid, user.displayName, user.email)))
    }, [user])

    useEffect(() => {
        if (!newServiceId) return
        const frame = window.requestAnimationFrame(() => {
            document.getElementById(`consultant-service-${newServiceId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setNewServiceId(undefined)
        })
        return () => window.cancelAnimationFrame(frame)
    }, [newServiceId, profile?.services.length])

    const update = (change: Partial<ConsultantMarketplaceProfile>) => setProfile((current) => current ? { ...current, ...change } : current)
    const updateService = (id: string, change: Partial<ConsultantServiceOffer>) => update({ services: profile?.services.map((item) => item.id === id ? { ...item, ...change } : item) || [] })
    const changeSection = (value: string | number) => {
        const section = String(value)
        setActiveSection(section)
    }
    const addService = () => {
        if (!profile) return
        const service = newService()
        update({ services: [...profile.services, service] })
        setNewServiceId(service.id)
    }
    const addAvailabilitySlot = () => {
        const daySlots = (profile?.availability || []).filter((slot) => slot.dayOfWeek === activeAvailabilityDay).sort((left, right) => timeToMinutes(left.startTime) - timeToMinutes(right.startTime))
        const lastSlot = daySlots.at(-1)
        const firstSlot = daySlots[0]
        const nextRange = lastSlot && timeToMinutes(lastSlot.endTime) <= 22 * 60 + 30
            ? { startTime: lastSlot.endTime, endTime: minutesToTime(timeToMinutes(lastSlot.endTime) + 60) }
            : firstSlot && timeToMinutes(firstSlot.startTime) >= 60
                ? { startTime: minutesToTime(timeToMinutes(firstSlot.startTime) - 60), endTime: firstSlot.startTime }
                : !lastSlot ? { startTime: '09:00', endTime: '17:00' } : undefined
        if (!nextRange) {
            message.warning(`There is no free time left on ${WEEK_DAYS[activeAvailabilityDay]} for another availability window.`)
            return
        }
        update({ availability: [...(profile?.availability || []), { id: crypto.randomUUID(), dayOfWeek: activeAvailabilityDay, ...nextRange }].sort((left, right) => left.dayOfWeek - right.dayOfWeek || timeToMinutes(left.startTime) - timeToMinutes(right.startTime)) })
    }
    const updateAvailabilitySlot = (id: string, change: Partial<{ startTime: string, endTime: string }>) => {
        if (!profile) return
        const current = profile.availability.find((slot) => slot.id === id)
        if (!current) return
        const next = { ...current, ...change }
        const start = timeToMinutes(next.startTime)
        const end = timeToMinutes(next.endTime)
        const overlaps = profile.availability.some((slot) => slot.id !== id && slot.dayOfWeek === next.dayOfWeek && start < timeToMinutes(slot.endTime) && end > timeToMinutes(slot.startTime))
        if (start >= end) {
            message.warning(t('An availability window must end after it starts.'))
            return
        }
        if (overlaps) {
            message.warning(t('That time overlaps another availability window for this day.'))
            return
        }
        update({ availability: profile.availability.map((slot) => slot.id === id ? next : slot).sort((left, right) => left.dayOfWeek - right.dayOfWeek || timeToMinutes(left.startTime) - timeToMinutes(right.startTime)) })
    }
    const setWeekendAvailability = (weekendAvailability: ConsultantMarketplaceProfile['weekendAvailability']) => {
        if (weekendAvailability === 'unavailable') {
            if (activeAvailabilityDay === 0 || activeAvailabilityDay === 6) setActiveAvailabilityDay(1)
            update({ weekendAvailability, availability: (profile?.availability || []).filter((slot) => slot.dayOfWeek !== 0 && slot.dayOfWeek !== 6) })
            return
        }
        update({ weekendAvailability })
    }

    const save = async () => {
        if (!profile) return
        if (!profile.country || !expectedPhoneLength) {
            message.error(t('Select South Africa or Zimbabwe before adding a primary phone number.'))
            return
        }
        if (!localPhoneNumber(profile.phone)) {
            message.error(t('Primary phone is required.'))
            return
        }
        if (!primaryPhoneIsValid) {
            message.error(`Primary phone must contain ${expectedPhoneLength} digits after ${diallingCode}.`)
            return
        }
        if (!alternativePhoneIsValid) {
            message.error(`Alternative phone must contain ${expectedPhoneLength} digits after ${diallingCode}.`)
            return
        }
        try {
            setSaving(true)
            await saveConsultantProfile(profile)
            message.success(t('Your consultant profile was saved.'))
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Your profile could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const uploadImage = async (file: File) => {
        if (!profile) return
        try {
            const profileImageUrl = await uploadConsultantProfileImage(profile.uid, file)
            setProfile({ ...profile, profileImageUrl })
            await saveConsultantProfile({ ...profile, profileImageUrl })
            message.success(t('Profile image updated.'))
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Profile image could not be uploaded.'))
        }
    }

    if (!profile) return <LoadingOverlay tip={t('Loading consultant profile')} />

    const diallingCode = diallingCodeForCountry(profile.country)
    const expectedPhoneLength = expectedPhoneLengthForCountry(profile.country)
    const primaryPhoneIsValid = localPhoneNumber(profile.phone).length === expectedPhoneLength && expectedPhoneLength > 0
    const alternativePhoneIsValid = !profile.alternativePhone || localPhoneNumber(profile.alternativePhone).length === expectedPhoneLength

    return (
        <DashboardPage className="consultant-page">
            <div className="consultant-profile-layout">
                <Card className="consultant-profile-identity-card">
                    <div className="consultant-profile-hero">
                        <div className="consultant-profile-photo">
                            <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => { void uploadImage(file as File); return false }}>
                                <div className="consultant-profile-photo-target" role="button" tabIndex={0} aria-label={t('Change profile photo')}>
                                    <Avatar size={180} src={profile.profileImageUrl || undefined} icon={!profile.profileImageUrl && <UserOutlined />} />
                                    <span className="consultant-profile-photo-edit"><CameraOutlined /></span>
                                </div>
                            </Upload>
                        </div>
                        <div className="consultant-profile-identity">
                            <Typography.Title level={3} style={{ margin: 0 }}>{profile.name}</Typography.Title>
                            {profile.verificationStatus === 'verified' && <Tag color="blue" icon={<SafetyCertificateOutlined />}>{t('Verified consultant')}</Tag>}
                            {profile.status === 'published' && <Tag color="green">{t('Published')}</Tag>}
                            <Typography.Paragraph type="secondary" className="consultant-profile-headline">{profile.headline || t('Add a professional headline to introduce your expertise.')}</Typography.Paragraph>
                        </div>
                    </div>
                    <div className="consultant-profile-facts" aria-label={t('Consultant profile summary')}>
                        <div className="consultant-profile-fact consultant-profile-fact-green"><MailOutlined /><span><small>{t('Email')}</small><strong>{user?.email || t('Not added')}</strong></span></div>
                        <div className="consultant-profile-fact consultant-profile-fact-amber"><PhoneOutlined /><span><small>{t('Phone')}</small><strong>{profile.phone || t('Not added')}</strong></span></div>
                        <div className="consultant-profile-fact consultant-profile-fact-teal"><SolutionOutlined /><span><small>{t('Expertise')}</small><strong>{profile.specialties.length ? `${profile.specialties.length} area${profile.specialties.length === 1 ? '' : 's'}` : t('Not added')}</strong></span></div>
                        <div className="consultant-profile-fact consultant-profile-fact-rose"><EnvironmentOutlined /><span><small>{t('Based in')}</small><strong>{[profile.province, profile.country].filter(Boolean).join(', ') || t('Not added')}</strong></span></div>
                    </div>
                    <div className="consultant-profile-acceptance">
                        <Switch checked={profile.acceptingClients} onChange={(acceptingClients) => update({ acceptingClients })} />
                        <span>{profile.acceptingClients ? t('Accepting new SME requests') : t('Not accepting new requests')}</span>
                        <Tag color={profile.status === 'published' ? 'green' : 'gold'}>{profile.status === 'published' ? t('Published') : t('Draft')}</Tag>
                    </div>
                </Card>
                <Card className="dashboard-section-card consultant-profile-editor-card">
                    <Form layout="vertical" requiredMark={false} className={`consultant-profile-form consultant-profile-form-${activeSection.toLowerCase()}`}>
                        <div className="consultant-profile-editor-top"><Segmented block value={activeSection} onChange={changeSection} options={[{ label: <span><SolutionOutlined /> {t('Professional')}</span>, value: 'Professional' }, { label: <span><EnvironmentOutlined /> {t('Location')}</span>, value: 'Location' }, { label: <span><IdcardOutlined /> {t('Contact')}</span>, value: 'Contact' }, { label: <span><EnvironmentOutlined /> {t('Availability')}</span>, value: 'Availability' }]} /></div>
                        {activeSection === 'Professional' && <div className="consultant-inline-services"><div className="consultant-inline-services-head"><div><Typography.Title level={4}>{t('Services & rates')}</Typography.Title><Typography.Paragraph type="secondary">{t('Add services using the expertise areas above.')}</Typography.Paragraph></div><Button icon={<PlusOutlined />} disabled={!profile.specialties.length} onClick={addService}>{t('Add service')}</Button></div>{profile.services.map((service) => <Card key={service.id} id={`consultant-service-${service.id}`} size="small" className="consultant-inline-service-card"><div className="consultant-inline-service-head"><Typography.Text strong>{service.areaOfSupport || t('New service')}</Typography.Text><Button danger type="text" icon={<DeleteOutlined />} onClick={() => update({ services: profile.services.filter((item) => item.id !== service.id) })} /></div><Row gutter={[10, 8]}><Col xs={24} md={10}><Select style={{ width: '100%' }} placeholder={t('Area of support')} value={service.areaOfSupport || undefined} options={profile.specialties.map((value) => ({ value, label: value }))} onChange={(value) => updateService(service.id, { areaOfSupport: value })} /></Col><Col xs={24} md={14}><Select mode="tags" style={{ width: '100%' }} placeholder={t('Specific interventions')} value={service.interventionExamples} onChange={(value) => updateService(service.id, { interventionExamples: value })} /></Col><Col xs={24} md={8}><Select style={{ width: '100%' }} value={service.deliveryMode} options={[{ value: 'online', label: t('Online') }, { value: 'in_person', label: t('In person') }, { value: 'hybrid', label: t('Hybrid') }]} onChange={(value) => updateService(service.id, { deliveryMode: value })} /></Col><Col xs={24} md={8}><InputNumber min={0} value={service.rate} style={{ width: '100%' }} addonAfter={profile.currency || 'rate'} onChange={(value) => updateService(service.id, { rate: Number(value) || 0 })} /></Col><Col xs={24} md={8}><Select style={{ width: '100%' }} value={service.rateUnit} options={[{ value: 'day', label: t('Per day') }]} onChange={(value) => updateService(service.id, { rateUnit: value })} /></Col></Row></Card>)}</div>}
                        {activeSection === 'Availability' && <div className="consultant-availability-editor">
                            <div className="consultant-special-availability">
                                <div className="consultant-special-availability-row"><div><strong>{t('Weekend availability')}</strong><small>{t('Set your usual Saturday and Sunday availability before adding any weekend time windows.')}</small></div><div className="consultant-special-options" role="radiogroup" aria-label={t('Weekend availability')}>{SPECIAL_AVAILABILITY_OPTIONS.map(({ value, label }) => <button type="button" key={value} role="radio" aria-checked={profile.weekendAvailability === value} className={profile.weekendAvailability === value ? 'is-selected' : ''} onClick={() => setWeekendAvailability(value)}>{label}</button>)}</div></div>
                            </div>
                            <div className="consultant-weekday-grid" role="tablist" aria-label={t('Select a weekday')}>
                                {WEEK_DAYS.map((day, dayOfWeek) => {
                                    const slotCount = profile.availability.filter((slot) => slot.dayOfWeek === dayOfWeek).length
                                    const isUnavailableWeekend = (dayOfWeek === 0 || dayOfWeek === 6) && profile.weekendAvailability === 'unavailable'
                                    return <button type="button" key={day} role="tab" disabled={isUnavailableWeekend} aria-selected={activeAvailabilityDay === dayOfWeek} className={`consultant-weekday-card${activeAvailabilityDay === dayOfWeek ? ' is-selected' : ''}${isUnavailableWeekend ? ' is-disabled' : ''}`} onClick={() => setActiveAvailabilityDay(dayOfWeek)}><CalendarOutlined /><strong>{day.slice(0, 3)}</strong><small>{isUnavailableWeekend ? t('Unavailable') : slotCount ? `${slotCount} time ${slotCount === 1 ? 'window' : 'windows'}` : t('Not set')}</small></button>
                                })}
                            </div>
                            <div className="consultant-day-schedule">
                                <div className="consultant-inline-services-head"><div><Typography.Title level={5}>{WEEK_DAYS[activeAvailabilityDay]}</Typography.Title><Typography.Paragraph type="secondary">{t('Add more than one range when you have a break during the day.')}</Typography.Paragraph></div><Button icon={<PlusOutlined />} onClick={addAvailabilitySlot} disabled={(activeAvailabilityDay === 0 || activeAvailabilityDay === 6) && profile.weekendAvailability === 'unavailable'}>{t('Add time')}</Button></div>
                                {profile.availability.filter((slot) => slot.dayOfWeek === activeAvailabilityDay).length === 0 && <div className="consultant-availability-empty"><ClockCircleOutlined /> {t('No times added for')} {WEEK_DAYS[activeAvailabilityDay]} {t('yet.')}</div>}
                                {profile.availability.filter((slot) => slot.dayOfWeek === activeAvailabilityDay).sort((left, right) => timeToMinutes(left.startTime) - timeToMinutes(right.startTime)).map((slot) => <div className="consultant-availability-row" key={slot.id}><ClockCircleOutlined /><TimePicker.RangePicker aria-label={t('Availability time range')} value={[dayjs(slot.startTime, 'HH:mm'), dayjs(slot.endTime, 'HH:mm')]} format="HH:mm" minuteStep={15} allowClear={false} onChange={(range) => { if (range?.[0] && range?.[1]) updateAvailabilitySlot(slot.id, { startTime: range[0].format('HH:mm'), endTime: range[1].format('HH:mm') }) }} /><Button danger type="text" aria-label={t('Remove time')} icon={<DeleteOutlined />} onClick={() => update({ availability: profile.availability.filter((item) => item.id !== slot.id) })} /></div>)}
                            </div>
                            <div className="consultant-special-availability">
                                <div className="consultant-special-availability-row"><div><strong>{t('Public holiday availability')}</strong><small>{t('Let SMEs know whether they can request holiday support.')}</small></div><div className="consultant-special-options" role="radiogroup" aria-label={t('Public holiday availability')}>{SPECIAL_AVAILABILITY_OPTIONS.map(({ value, label }) => <button type="button" key={value} role="radio" aria-checked={profile.holidayAvailability === value} className={profile.holidayAvailability === value ? 'is-selected' : ''} onClick={() => update({ holidayAvailability: value })}>{label}</button>)}</div></div>
                            </div>
                        </div>}
                        <Row className="consultant-profile-fields" id="consultant-section-professional" gutter={[16, 8]}>
                            <Col className="consultant-field-professional" xs={24} md={12}>
                                <Form.Item label={t('Professional headline')}>
                                    <Input value={profile.headline} maxLength={100} placeholder={t('e.g. SME finance and growth strategy specialist')} onChange={(event) => update({ headline: event.target.value })} />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-professional" xs={24} md={12}>
                                <Form.Item label={t('Years of experience')}>
                                    <InputNumber min={0} max={60} value={profile.experienceYears} style={{ width: '100%' }} onChange={(value) => update({ experienceYears: Number(value) || 0 })} />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-professional" xs={24}>
                                <Form.Item label={t('About your work')}>
                                    <Input.TextArea rows={5} maxLength={800} showCount value={profile.bio} placeholder={t('Summarise the outcomes you help SMEs achieve.')} onChange={(event) => update({ bio: event.target.value })} />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-professional" xs={24}>
                                <Form.Item label={t('Areas of expertise')}>
                                    <Select mode="tags" value={profile.specialties} tokenSeparators={[',']} placeholder={t('Finance, marketing, operations...')} onChange={(value) => update({ specialties: value })} />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-location" id="consultant-section-location" xs={24}>
                                <Form.Item label={t('Where are you based?')} required>
                                    <div className="consultant-location-choice-grid" role="radiogroup" aria-label={t('Country')}>
                                        {SUPPORTED_COUNTRIES.map(({ value, currencies, Icon }) =>
                                            <button key={value} type="button" role="radio" aria-checked={profile.country === value} className={`consultant-profile-choice-card${profile.country === value ? ' is-selected' : ''}`} onClick={() => update({ country: value, province: '', currency: currencies[0], phone: withDiallingCode(profile.phone, value), alternativePhone: withDiallingCode(profile.alternativePhone, value) })}>
                                                <Icon />
                                                <span>
                                                    <strong>{value}</strong>
                                                </span>
                                            </button>)}
                                    </div>
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-location" xs={24} md={12}>
                                <Form.Item label={t('Province / region')} required>
                                    <Select value={profile.province || undefined} placeholder={t('Select a province or region')} disabled={!profile.country} options={provincesForCountry(profile.country).map((value) => ({ value, label: value }))} onChange={(province) => update({ province })} />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-location" xs={24} md={12}>
                                <Form.Item label={t('Physical address')} required>
                                    <Input value={profile.physicalAddress || profile.operatingLocation} placeholder={t('Street, suburb, town/city')} onChange={(event) => update({ physicalAddress: event.target.value, operatingLocation: event.target.value })} />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-location" xs={24} md={12}>
                                <Form.Item label={t('In-person radius')}>
                                    <div className="consultant-radius-choice-grid" role="radiogroup" aria-label={t('In-person radius')}>
                                        {[10, 25, 50, 100, 250].map((radius) => <button key={radius} type="button" role="radio" aria-checked={profile.serviceRadiusKm === radius} className={`consultant-profile-choice-card${profile.serviceRadiusKm === radius ? ' is-selected' : ''}`} onClick={() => update({ serviceRadiusKm: radius })}><AimOutlined /><span><strong>{radius === 250 ? t('250+ km') : `${radius} km`}</strong><small>{radius <= 25 ? t('Nearby') : radius <= 100 ? t('Regional') : t('Wide reach')}</small></span></button>)}
                                    </div>
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-location" xs={24} md={12}>
                                <Form.Item label={t('Daily-rate currency')} required>
                                    <div className="consultant-location-choice-grid consultant-currency-choice-grid" role="radiogroup"
                                        aria-label={t('Daily-rate currency')}>
                                        {SUPPORTED_COUNTRIES.filter(({ value }) =>
                                            value === profile.country).flatMap(({ currencies }) =>
                                                currencies.map((currency) =>
                                                    <button
                                                        key={currency}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={profile.currency === currency}
                                                        className={`consultant-profile-choice-card${profile.currency === currency ? ' is-selected' : ''}`}
                                                        onClick={() => update({ currency })}>
                                                        <BankOutlined />
                                                        <span>
                                                            <strong>{currency}</strong>
                                                        </span>
                                                    </button>))}
                                        {!SUPPORTED_COUNTRIES.some(({ value }) => value === profile.country) && <div className="consultant-profile-choice-empty">{t('Choose a country to set your currency.')}</div>}
                                    </div>
                                </Form.Item>
                            </Col>
                        </Row>
                        <Row id="consultant-section-contact" className="consultant-contact-fields" gutter={[16, 8]}>
                            <Col xs={24}>
                                <div className="consultant-contact-email-card"><MailOutlined /><div><small>{t('System login email')}</small><strong>{profile.email || user?.email || t('Not added')}</strong></div><Tag color="blue">{t('Account')}</Tag></div>
                            </Col>
                                <Col xs={24}>
                                    <Form.Item label={t('Additional email')}>
                                        <Input prefix={<MailOutlined />} type="email" value={profile.alternativeEmail} placeholder={t('Optional work or personal email')} onChange={(event) => update({ alternativeEmail: event.target.value })} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item label={t('Primary phone')} required validateStatus={profile.phone && !primaryPhoneIsValid ? 'error' : undefined} help={profile.phone && !primaryPhoneIsValid ? `Enter ${expectedPhoneLength || 9} digits after ${diallingCode || 'the country code'}.` : undefined}>
                                        <div className="consultant-phone-input-row"><Input addonBefore={diallingCode || '—'} disabled={!diallingCode} maxLength={11} value={formatLocalPhoneNumber(profile.phone)} placeholder="78 571 9132" onChange={(event) => update({ phone: withDiallingCode(event.target.value, profile.country) })} /><Checkbox checked={profile.phoneIsWhatsApp} disabled={!profile.phone.trim()} onChange={(event) => update({ phoneIsWhatsApp: event.target.checked })}>{t('WhatsApp')}</Checkbox></div>
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item label={t('Alternative phone')} validateStatus={profile.alternativePhone && !alternativePhoneIsValid ? 'error' : undefined} help={profile.alternativePhone && !alternativePhoneIsValid ? `Enter ${expectedPhoneLength || 9} digits after ${diallingCode || 'the country code'}.` : undefined}>
                                        <div className="consultant-phone-input-row"><Input addonBefore={diallingCode || '—'} disabled={!diallingCode} maxLength={11} value={formatLocalPhoneNumber(profile.alternativePhone)} placeholder="78 571 9132" onChange={(event) => update({ alternativePhone: withDiallingCode(event.target.value, profile.country) })} /><Checkbox checked={profile.alternativePhoneIsWhatsApp} disabled={!profile.alternativePhone.trim()} onChange={(event) => update({ alternativePhoneIsWhatsApp: event.target.checked })}>{t('WhatsApp')}</Checkbox></div>
                                    </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                                <Form.Item label={t('Website')}>
                                    <Input prefix={<LinkOutlined />} value={profile.website} placeholder="https://yourwebsite.com" onChange={(event) => update({ website: event.target.value })} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                                <Form.Item label={t('LinkedIn')}>
                                    <Input prefix={<LinkedinOutlined />} value={profile.linkedinUrl} placeholder="linkedin.com/in/your-profile" onChange={(event) => update({ linkedinUrl: event.target.value })} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                                <Form.Item label={t('Facebook')}>
                                    <Input prefix={<FacebookOutlined />} value={profile.facebookUrl} placeholder="facebook.com/your-page" onChange={(event) => update({ facebookUrl: event.target.value })} />
                                </Form.Item>
                            </Col>
                        </Row>
                        <Button className="consultant-profile-save" type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>{t('Save profile')}</Button>
                    </Form>
                </Card>
            </div>
        </DashboardPage>
    )
}

export default function ConsultantProfilePage() {
    const { user } = useFullIdentity()
    if (user && !hasConsultantMarketplaceProfile(user)) return <Navigate to="/profile" replace />
    return <ConsultantMarketplaceProfileForm />
}
