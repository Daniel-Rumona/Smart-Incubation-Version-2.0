import { App, Avatar, Button, Card, Checkbox, Col, Form, Input, InputNumber, Progress, Row, Segmented, Select, Switch, Tag, TimePicker, Typography, Upload } from 'antd'
import { BankOutlined, CalendarOutlined, CameraOutlined, CheckCircleFilled, ClockCircleOutlined, CopyOutlined, DeleteOutlined, EnvironmentOutlined, EyeOutlined, FacebookOutlined, GlobalOutlined, IdcardOutlined, LinkedinOutlined, LinkOutlined, MailOutlined, PlusOutlined, SafetyCertificateOutlined, SaveOutlined, SolutionOutlined, UserOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { ConsultantMarketplaceCard } from '@/components/consultant/ConsultantMarketplaceCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { hasConsultantMarketplaceProfile } from '@/services/companiesService'
import { provincesForCountry } from '@/config/sadc'
import { createEmptyConsultantProfile, getConsultantProfile, saveConsultantProfile, uploadConsultantProfileImage } from '@/services/consultantMarketplaceService'
import type { ConsultantMarketplaceProfile, ConsultantServiceOffer } from '@/types/consultantMarketplace'
import { consultantProfileChecks, diallingCodeForCountry, expectedPhoneLengthForCountry, localPhoneNumber, type ConsultantProfileCheckKey } from './consultantProfileChecks'
import '@/styles/consultant.css'
import { providersForCountry } from '@/config/phoneProviders'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const SUPPORTED_COUNTRIES = [
    { value: 'South Africa', currencies: ['ZAR'], Icon: EnvironmentOutlined, get detail() { return tr('South African Rand') } },
    { value: 'Zimbabwe', currencies: ['ZWL', 'ZAR', 'USD'], Icon: GlobalOutlined, get detail() { return tr('Zimbabwean Dollar') } },
] as const
const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// The week overview reads Monday first, the way people plan a working week.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAYS = [1, 2, 3, 4, 5]
const SPECIAL_AVAILABILITY_OPTIONS = [
    { value: 'available', get label() { return tr('Available') } },
    { value: 'on_request', get label() { return tr('On request') } },
    { value: 'unavailable', get label() { return tr('Unavailable') } },
] as const

type Section = 'Professional' | 'Location' | 'Contact' | 'Availability'
// Fields the save checks, each tied to the tab it lives on so a failed save can open that tab.
type FieldKey = 'country' | 'phone' | 'phoneProvider' | 'alternativePhone' | 'alternativePhoneProvider'
const FIELD_SECTION: Record<FieldKey, Section> = { country: 'Location', phone: 'Contact', phoneProvider: 'Contact', alternativePhone: 'Contact', alternativePhoneProvider: 'Contact' }

const formatLocalPhoneNumber = (phone: string) => {
    const local = localPhoneNumber(phone).slice(0, 9)
    return [local.slice(0, 2), local.slice(2, 5), local.slice(5, 9)].filter(Boolean).join(' ')
}
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
const sameProfile = (left?: ConsultantMarketplaceProfile, right?: ConsultantMarketplaceProfile) => JSON.stringify(left) === JSON.stringify(right)

function ConsultantMarketplaceProfileForm() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { message, modal } = App.useApp()
    const [profile, setProfile] = useState<ConsultantMarketplaceProfile>()
    // The profile as last saved, so the page can tell when there are unsaved changes.
    const [saved, setSaved] = useState<ConsultantMarketplaceProfile>()
    const [saving, setSaving] = useState(false)
    const [activeSection, setActiveSection] = useState<Section>('Professional')
    const [newServiceId, setNewServiceId] = useState<string>()
    const [activeAvailabilityDay, setActiveAvailabilityDay] = useState(1)
    const [showErrors, setShowErrors] = useState(false)
    const [focusField, setFocusField] = useState<string>()
    const [previewOpen, setPreviewOpen] = useState(false)
    const newService = (): ConsultantServiceOffer => ({ id: crypto.randomUUID(), areaOfSupport: '', interventionExamples: [], deliveryMode: 'online', rate: 0, rateUnit: 'day' })

    useEffect(() => {
        if (!user) return
        const load = (next: ConsultantMarketplaceProfile) => { setProfile(next); setSaved(next) }
        void getConsultantProfile(user.uid, { name: user.displayName, email: user.email })
            .then(load)
            .catch(() => load(createEmptyConsultantProfile(user.uid, user.displayName, user.email)))
    }, [user])

    useEffect(() => {
        if (!newServiceId) return
        const frame = window.requestAnimationFrame(() => {
            document.getElementById(`consultant-service-${newServiceId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setNewServiceId(undefined)
        })
        return () => window.cancelAnimationFrame(frame)
    }, [newServiceId, profile?.services.length])

    // After switching tab for a missing field, bring the field into view once it's rendered.
    useEffect(() => {
        if (!focusField) return
        const frame = window.requestAnimationFrame(() => {
            const target = document.getElementById(focusField)
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            target?.querySelector<HTMLElement>('input, button, textarea, .ant-select-selector')?.focus()
            setFocusField(undefined)
        })
        return () => window.cancelAnimationFrame(frame)
    }, [focusField, activeSection])

    const dirty = !!profile && !!saved && !sameProfile(profile, saved)

    // Leaving the page (reload, close, typed URL) with unsaved edits asks first.
    useEffect(() => {
        if (!dirty) return
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    const update = (change: Partial<ConsultantMarketplaceProfile>) => setProfile((current) => current ? { ...current, ...change } : current)
    const updateService = (id: string, change: Partial<ConsultantServiceOffer>) => update({ services: profile?.services.map((item) => item.id === id ? { ...item, ...change } : item) || [] })
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
            message.warning(t('There is no free time left on {day} for another availability window.', undefined, { day: t(WEEK_DAYS[activeAvailabilityDay]) }))
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

    // Most consultants keep the same hours Monday to Friday; copy one day's windows to the rest.
    const copyToWeekdays = () => {
        if (!profile) return
        const source = profile.availability.filter((slot) => slot.dayOfWeek === activeAvailabilityDay)
        const apply = () => update({
            availability: [
                ...profile.availability.filter((slot) => !WEEKDAYS.includes(slot.dayOfWeek) || slot.dayOfWeek === activeAvailabilityDay),
                ...WEEKDAYS.filter((day) => day !== activeAvailabilityDay).flatMap((day) => source.map((slot) => ({ ...slot, id: crypto.randomUUID(), dayOfWeek: day }))),
            ].sort((left, right) => left.dayOfWeek - right.dayOfWeek || timeToMinutes(left.startTime) - timeToMinutes(right.startTime)),
        })
        const overwritten = WEEKDAYS.some((day) => day !== activeAvailabilityDay && profile.availability.some((slot) => slot.dayOfWeek === day))
        if (!overwritten) return apply()
        modal.confirm({
            title: t('Copy {day} to every weekday?', undefined, { day: t(WEEK_DAYS[activeAvailabilityDay]) }),
            content: t('The times already set on the other weekdays will be replaced.'),
            okText: t('Copy'),
            onOk: apply,
        })
    }

    if (!profile) return <PageSkeleton variant="detail" label={t('Loading consultant profile')} />

    const diallingCode = diallingCodeForCountry(profile.country)
    const expectedPhoneLength = expectedPhoneLengthForCountry(profile.country)
    const primaryPhoneIsValid = localPhoneNumber(profile.phone).length === expectedPhoneLength && expectedPhoneLength > 0
    const alternativePhoneIsValid = !profile.alternativePhone || localPhoneNumber(profile.alternativePhone).length === expectedPhoneLength
    const phoneHint = t('Enter {count} digits after {code}.', undefined, { count: expectedPhoneLength || 9, code: diallingCode || t('the country code') })

    // Problems that block a save, shown under their field (not as a toast) once a save has been tried.
    const issues: Partial<Record<FieldKey, string>> = {}
    if (!profile.country || !expectedPhoneLength) issues.country = t('Choose South Africa or Zimbabwe.')
    if (!localPhoneNumber(profile.phone)) issues.phone = t('Primary phone is required.')
    else if (!primaryPhoneIsValid) issues.phone = phoneHint
    if (!alternativePhoneIsValid) issues.alternativePhone = phoneHint
    if (profile.phone.trim() && !profile.phoneProvider) issues.phoneProvider = t('Select the service provider for this number.')
    if (profile.alternativePhone.trim() && !profile.alternativePhoneProvider) issues.alternativePhoneProvider = t('Select the service provider for this number.')
    const issueKeys = Object.keys(issues) as FieldKey[]
    const fieldError = (key: FieldKey) => (showErrors || (key !== 'phone' && key !== 'country')) && issues[key] ? issues[key] : undefined

    // What a complete, publishable profile needs. Each item opens the tab where it's filled in.
    // The rules live in consultantProfileChecks (shared with the dashboard); this adds where each one is filled in.
    const checkPlace: Record<ConsultantProfileCheckKey, { label: string, section: Section, field: string }> = {
        headline: { label: t('Headline and bio'), section: 'Professional', field: 'consultant-field-headline' },
        expertise: { label: t('Areas of expertise'), section: 'Professional', field: 'consultant-field-expertise' },
        service: { label: t('Service and daily rate'), section: 'Professional', field: 'consultant-services-rates' },
        location: { label: t('Location and rate currency'), section: 'Location', field: 'consultant-field-country' },
        phone: { label: t('Primary phone'), section: 'Contact', field: 'consultant-field-phone' },
        availability: { label: t('Weekly availability'), section: 'Availability', field: 'consultant-week' },
        photo: { label: t('Profile photo'), section: 'Professional', field: 'consultant-photo' },
    }
    const checklist = consultantProfileChecks(profile).map((check) => ({ ...check, ...checkPlace[check.key] }))
    const doneCount = checklist.filter((item) => item.done).length
    const readyToPublish = checklist.every((item) => item.done || !item.required) && !issueKeys.length
    const sectionsNeedingWork = new Set(checklist.filter((item) => !item.done && item.required).map((item) => item.section))
    if (showErrors) issueKeys.forEach((key) => sectionsNeedingWork.add(FIELD_SECTION[key]))

    const goTo = (section: Section, field: string) => {
        setActiveSection(section)
        setFocusField(field)
    }

    const persist = async (next: ConsultantMarketplaceProfile, done: string) => {
        if (issueKeys.length) {
            // Open the tab with the first problem and point at it, instead of a toast about a field you can't see.
            setShowErrors(true)
            const first = issueKeys[0]
            goTo(FIELD_SECTION[first], `consultant-field-${first === 'phoneProvider' ? 'phone' : first === 'alternativePhoneProvider' ? 'alternative-phone' : first === 'alternativePhone' ? 'alternative-phone' : first}`)
            return
        }
        try {
            setSaving(true)
            await saveConsultantProfile(next)
            setProfile(next)
            setSaved(next)
            setShowErrors(false)
            message.success(done)
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Your profile could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const save = () => persist(profile, t('Your consultant profile was saved.'))
    const publish = () => persist({ ...profile, status: 'published' }, t('Your profile is published. SMEs can now find you in the marketplace.'))
    const unpublish = () => persist({ ...profile, status: 'draft' }, t('Your profile is hidden from the marketplace.'))

    // A new photo saves straight away, on top of the last saved profile, so it never saves half-finished edits with it.
    const uploadImage = async (file: File) => {
        if (!saved) return
        try {
            const profileImageUrl = await uploadConsultantProfileImage(profile.uid, file)
            await saveConsultantProfile({ ...saved, profileImageUrl })
            setSaved({ ...saved, profileImageUrl })
            update({ profileImageUrl })
            message.success(t('Profile image updated.'))
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Profile image could not be uploaded.'))
        }
    }

    // Week overview: every day on one shared time scale, widened if any window falls outside 06:00–20:00.
    const scaleStart = Math.min(6 * 60, ...profile.availability.map((slot) => timeToMinutes(slot.startTime)))
    const scaleEnd = Math.max(20 * 60, ...profile.availability.map((slot) => timeToMinutes(slot.endTime)))
    const toPercent = (minutes: number) => ((minutes - scaleStart) / (scaleEnd - scaleStart)) * 100
    const weekendOff = profile.weekendAvailability === 'unavailable'
    const daySlots = profile.availability.filter((slot) => slot.dayOfWeek === activeAvailabilityDay).sort((left, right) => timeToMinutes(left.startTime) - timeToMinutes(right.startTime))
    const currencies = SUPPORTED_COUNTRIES.find(({ value }) => value === profile.country)?.currencies || []

    const tabLabel = (section: Section, icon: React.ReactNode, label: string) => (
        <span className="consultant-profile-tab">
            {icon} {label}
            {sectionsNeedingWork.has(section) && <span className="consultant-profile-tab-dot" aria-label={t('Something here still needs adding')} />}
        </span>
    )

    return (
        <DashboardPage className="consultant-page">
            <div className="consultant-profile-layout">
                <Card className="consultant-profile-identity-card">
                    <div className="consultant-profile-hero">
                        <div className="consultant-profile-photo" id="consultant-photo">
                            <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => { void uploadImage(file as File); return false }}>
                                <div className="consultant-profile-photo-target" role="button" tabIndex={0} aria-label={t('Change profile photo')}>
                                    <Avatar size={120} src={profile.profileImageUrl || undefined} icon={!profile.profileImageUrl && <UserOutlined />} />
                                    <span className="consultant-profile-photo-edit"><CameraOutlined /></span>
                                </div>
                            </Upload>
                        </div>
                        <div className="consultant-profile-identity">
                            <Typography.Title level={4} style={{ margin: 0 }}>{profile.name}</Typography.Title>
                            <Typography.Paragraph type="secondary" className="consultant-profile-headline">{profile.headline || t('Add a professional headline to introduce your expertise.')}</Typography.Paragraph>
                            <div className="consultant-profile-badges">
                                {profile.verificationStatus === 'verified' && <Tag color="blue" icon={<SafetyCertificateOutlined />}>{t('Verified consultant')}</Tag>}
                                <Tag color={saved?.status === 'published' ? 'green' : 'gold'}>{saved?.status === 'published' ? t('Published') : t('Draft')}</Tag>
                            </div>
                        </div>
                    </div>

                    <div className="consultant-profile-acceptance">
                        <span>{t('Accepting new requests')}</span>
                        <Switch checked={profile.acceptingClients} onChange={(acceptingClients) => update({ acceptingClients })} aria-label={t('Accepting new requests')} />
                    </div>

                    <div className="consultant-profile-checklist" aria-label={t('Profile checklist')}>
                        <div className="consultant-profile-checklist-head">
                            <strong>{t('Profile {done} of {total} done', undefined, { done: doneCount, total: checklist.length })}</strong>
                        </div>
                        <Progress percent={Math.round((doneCount / checklist.length) * 100)} showInfo={false} size="small" strokeColor="#15803D" />
                        <ul>
                            {checklist.map((item) => (
                                <li key={item.key} className={item.done ? 'is-done' : item.required ? 'is-missing' : 'is-optional'}>
                                    {item.done ? <CheckCircleFilled /> : <span className="consultant-profile-checklist-ring" />}
                                    <span>{item.label}{!item.done && !item.required && <small> · {t('optional')}</small>}</span>
                                    {!item.done && <button type="button" onClick={() => goTo(item.section, item.field)}>{t('Add')}</button>}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="consultant-profile-actions">
                        <Button block icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>{t('Preview as SME')}</Button>
                        {saved?.status === 'published'
                            ? <Button block loading={saving} onClick={() => void unpublish()}>{t('Unpublish profile')}</Button>
                            : <Button block type="primary" loading={saving} disabled={!readyToPublish} title={readyToPublish ? undefined : t('Finish the checklist to publish.')} onClick={() => void publish()}>{t('Publish profile')}</Button>}
                    </div>
                </Card>

                <Card className="dashboard-section-card consultant-profile-editor-card">
                    <Form layout="vertical" className={`consultant-profile-form consultant-profile-form-${activeSection.toLowerCase()}`}>
                        <div className="consultant-profile-editor-top">
                            <Segmented<Section>
                                block
                                value={activeSection}
                                onChange={setActiveSection}
                                options={[
                                    { label: tabLabel('Professional', <SolutionOutlined />, t('Professional')), value: 'Professional' },
                                    { label: tabLabel('Location', <EnvironmentOutlined />, t('Location')), value: 'Location' },
                                    { label: tabLabel('Contact', <IdcardOutlined />, t('Contact')), value: 'Contact' },
                                    { label: tabLabel('Availability', <CalendarOutlined />, t('Availability')), value: 'Availability' },
                                ]}
                            />
                        </div>

                        {activeSection === 'Professional' && (
                            <div className="consultant-inline-services" id="consultant-services-rates">
                                <div className="consultant-inline-services-head">
                                    <div><Typography.Title level={4}>{t('Services & rates')}</Typography.Title><Typography.Paragraph type="secondary">{t('Add services using the expertise areas above.')}</Typography.Paragraph></div>
                                    <Button icon={<PlusOutlined />} disabled={!profile.specialties.length} onClick={addService}>{t('Add service')}</Button>
                                </div>
                                {profile.services.map((service) => (
                                    <Card key={service.id} id={`consultant-service-${service.id}`} size="small" className="consultant-inline-service-card">
                                        <div className="consultant-inline-service-head">
                                            <Typography.Text strong>{service.areaOfSupport || t('New service')}</Typography.Text>
                                            <Button danger type="text" icon={<DeleteOutlined />} aria-label={t('Remove service')} onClick={() => update({ services: profile.services.filter((item) => item.id !== service.id) })} />
                                        </div>
                                        <Row gutter={[10, 8]}>
                                            <Col xs={24} md={10}><Select style={{ width: '100%' }} placeholder={t('Area of support')} value={service.areaOfSupport || undefined} options={profile.specialties.map((value) => ({ value, label: value }))} onChange={(value) => updateService(service.id, { areaOfSupport: value })} /></Col>
                                            <Col xs={24} md={14}><Select mode="tags" style={{ width: '100%' }} placeholder={t('Specific interventions')} value={service.interventionExamples} onChange={(value) => updateService(service.id, { interventionExamples: value })} /></Col>
                                            <Col xs={24} md={12}>
                                                <Segmented<ConsultantServiceOffer['deliveryMode']> block value={service.deliveryMode} onChange={(value) => updateService(service.id, { deliveryMode: value })} options={[{ value: 'online', label: t('Online') }, { value: 'in_person', label: t('In person') }, { value: 'hybrid', label: t('Hybrid') }]} />
                                            </Col>
                                            <Col xs={24} md={12}>
                                                {/* Daily rate is the only unit, so it's stated rather than offered as a one-option choice. */}
                                                <InputNumber min={0} value={service.rate} style={{ width: '100%' }} addonBefore={profile.currency || t('Rate')} addonAfter={t('per day')} onChange={(value) => updateService(service.id, { rate: Number(value) || 0 })} />
                                            </Col>
                                        </Row>
                                    </Card>
                                ))}
                            </div>
                        )}

                        {activeSection === 'Availability' && (
                            <div className="consultant-availability-editor">
                                <div className="consultant-week" id="consultant-week" role="tablist" aria-label={t('Your week')}>
                                    <div className="consultant-week-head">
                                        <strong>{t('Your week')}</strong>
                                        <Typography.Text type="secondary">{minutesToTime(scaleStart)} – {minutesToTime(scaleEnd)}</Typography.Text>
                                    </div>
                                    {WEEK_ORDER.map((dayOfWeek) => {
                                        const off = (dayOfWeek === 0 || dayOfWeek === 6) && weekendOff
                                        const windows = profile.availability.filter((slot) => slot.dayOfWeek === dayOfWeek)
                                        return (
                                            <button
                                                type="button"
                                                role="tab"
                                                key={dayOfWeek}
                                                disabled={off}
                                                aria-selected={activeAvailabilityDay === dayOfWeek}
                                                aria-label={`${t(WEEK_DAYS[dayOfWeek])}: ${off ? t('Unavailable') : windows.length ? windows.map((slot) => `${slot.startTime}–${slot.endTime}`).join(', ') : t('Not set')}`}
                                                className={`consultant-week-day${activeAvailabilityDay === dayOfWeek ? ' is-selected' : ''}${off ? ' is-off' : ''}`}
                                                onClick={() => setActiveAvailabilityDay(dayOfWeek)}
                                            >
                                                {/* Short names are their own keys: slicing a translated day name gives odd results. */}
                                                <span className="consultant-week-name">{t(WEEK_DAYS[dayOfWeek].slice(0, 3))}</span>
                                                <span className="consultant-week-track">
                                                    {windows.map((slot) => <span key={slot.id} className="consultant-week-window" style={{ left: `${toPercent(timeToMinutes(slot.startTime))}%`, width: `${toPercent(timeToMinutes(slot.endTime)) - toPercent(timeToMinutes(slot.startTime))}%` }} />)}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>

                                <div className="consultant-day-schedule">
                                    <div className="consultant-inline-services-head">
                                        <div><Typography.Title level={5}>{t(WEEK_DAYS[activeAvailabilityDay])}</Typography.Title><Typography.Paragraph type="secondary">{t('Add more than one range when you have a break during the day.')}</Typography.Paragraph></div>
                                        <div className="consultant-day-actions">
                                            {WEEKDAYS.includes(activeAvailabilityDay) && daySlots.length > 0 && <Button icon={<CopyOutlined />} onClick={copyToWeekdays}>{t('Copy to weekdays')}</Button>}
                                            <Button icon={<PlusOutlined />} onClick={addAvailabilitySlot}>{t('Add time')}</Button>
                                        </div>
                                    </div>
                                    {daySlots.length === 0 && <div className="consultant-availability-empty"><ClockCircleOutlined /> {t('No times added for {day} yet.', undefined, { day: t(WEEK_DAYS[activeAvailabilityDay]) })}</div>}
                                    {daySlots.map((slot) => <div className="consultant-availability-row" key={slot.id}><ClockCircleOutlined /><TimePicker.RangePicker aria-label={t('Availability time range')} value={[dayjs(slot.startTime, 'HH:mm'), dayjs(slot.endTime, 'HH:mm')]} format="HH:mm" minuteStep={15} allowClear={false} onChange={(range) => { if (range?.[0] && range?.[1]) updateAvailabilitySlot(slot.id, { startTime: range[0].format('HH:mm'), endTime: range[1].format('HH:mm') }) }} /><Button danger type="text" aria-label={t('Remove time')} icon={<DeleteOutlined />} onClick={() => update({ availability: profile.availability.filter((item) => item.id !== slot.id) })} /></div>)}
                                </div>

                                <div className="consultant-special-availability">
                                    <div className="consultant-special-availability-row">
                                        <div><strong>{t('Weekends')}</strong><small>{t('Your usual Saturday and Sunday availability.')}</small></div>
                                        <Segmented value={profile.weekendAvailability} onChange={(value) => setWeekendAvailability(value as ConsultantMarketplaceProfile['weekendAvailability'])} options={SPECIAL_AVAILABILITY_OPTIONS.map(({ value, label }) => ({ value, label }))} />
                                    </div>
                                    <div className="consultant-special-availability-row">
                                        <div><strong>{t('Public holidays')}</strong><small>{t('Whether SMEs can request holiday support.')}</small></div>
                                        <Segmented value={profile.holidayAvailability} onChange={(value) => update({ holidayAvailability: value as ConsultantMarketplaceProfile['holidayAvailability'] })} options={SPECIAL_AVAILABILITY_OPTIONS.map(({ value, label }) => ({ value, label }))} />
                                    </div>
                                </div>
                            </div>
                        )}

                        <Row className="consultant-profile-fields" id="consultant-section-professional" gutter={[16, 8]}>
                            <Col className="consultant-field-professional" xs={24} md={12} id="consultant-field-headline">
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
                            <Col className="consultant-field-professional" xs={24} id="consultant-field-expertise">
                                <Form.Item label={t('Areas of expertise')}>
                                    <Select mode="tags" value={profile.specialties} tokenSeparators={[',']} placeholder={t('Finance, marketing, operations...')} onChange={(value) => update({ specialties: value })} />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-location" id="consultant-field-country" xs={24}>
                                <Form.Item label={t('Where are you based?')} required validateStatus={showErrors && issues.country ? 'error' : undefined} help={showErrors ? issues.country : undefined}>
                                    <div className="consultant-location-choice-grid" role="radiogroup" aria-label={t('Country')}>
                                        {SUPPORTED_COUNTRIES.map(({ value, currencies: options, Icon }) =>
                                            <button key={value} type="button" role="radio" aria-checked={profile.country === value} className={`consultant-profile-choice-card${profile.country === value ? ' is-selected' : ''}`} onClick={() => update({ country: value, province: '', currency: options[0], phone: withDiallingCode(profile.phone, value), alternativePhone: withDiallingCode(profile.alternativePhone, value) })}>
                                                <Icon />
                                                <span><strong>{value}</strong></span>
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
                                    <Segmented
                                        block
                                        value={profile.serviceRadiusKm}
                                        onChange={(serviceRadiusKm) => update({ serviceRadiusKm: Number(serviceRadiusKm) })}
                                        options={[10, 25, 50, 100, 250].map((radius) => ({ value: radius, label: radius === 250 ? t('250+ km') : `${radius} km` }))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col className="consultant-field-location" xs={24} md={12}>
                                <Form.Item label={t('Daily-rate currency')} required>
                                    {currencies.length > 1
                                        ? <Segmented block value={profile.currency} onChange={(currency) => update({ currency: String(currency) })} options={currencies.map((currency) => ({ value: currency, label: currency }))} />
                                        // With one currency there's nothing to choose, so it's stated.
                                        : currencies.length === 1
                                            ? <div className="consultant-profile-fixed-value"><BankOutlined /> {currencies[0]}</div>
                                            : <div className="consultant-profile-choice-empty">{t('Choose a country to set your currency.')}</div>}
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
                            <Col xs={24} md={12} id="consultant-field-phone">
                                <Form.Item label={t('Primary phone')} required validateStatus={fieldError('phone') ? 'error' : undefined} help={fieldError('phone')}>
                                    <div className="consultant-phone-input-row"><Input addonBefore={diallingCode || '—'} disabled={!diallingCode} maxLength={11} value={formatLocalPhoneNumber(profile.phone)} placeholder="78 571 9132" onChange={(event) => update({ phone: withDiallingCode(event.target.value, profile.country) })} /><Checkbox checked={profile.phoneIsWhatsApp} disabled={!profile.phone.trim()} onChange={(event) => update({ phoneIsWhatsApp: event.target.checked })}>{t('WhatsApp')}</Checkbox></div>
                                </Form.Item>
                                <Form.Item validateStatus={fieldError('phoneProvider') ? 'error' : undefined} help={fieldError('phoneProvider')} className="consultant-phone-provider">
                                    <Select allowClear showSearch={false} value={profile.phoneProvider || undefined} disabled={!profile.phone.trim()} placeholder={t('Service provider')} style={{ minWidth: 150 }} options={providersForCountry(profile.country).map((value) => ({ value, label: value }))} onChange={(value) => update({ phoneProvider: value || '' })} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={12} id="consultant-field-alternative-phone">
                                <Form.Item label={t('Alternative phone')} validateStatus={fieldError('alternativePhone') ? 'error' : undefined} help={fieldError('alternativePhone')}>
                                    <div className="consultant-phone-input-row"><Input addonBefore={diallingCode || '—'} disabled={!diallingCode} maxLength={11} value={formatLocalPhoneNumber(profile.alternativePhone)} placeholder="78 571 9132" onChange={(event) => update({ alternativePhone: withDiallingCode(event.target.value, profile.country) })} /><Checkbox checked={profile.alternativePhoneIsWhatsApp} disabled={!profile.alternativePhone.trim()} onChange={(event) => update({ alternativePhoneIsWhatsApp: event.target.checked })}>{t('WhatsApp')}</Checkbox></div>
                                </Form.Item>
                                <Form.Item validateStatus={fieldError('alternativePhoneProvider') ? 'error' : undefined} help={fieldError('alternativePhoneProvider')} className="consultant-phone-provider">
                                    <Select allowClear showSearch={false} value={profile.alternativePhoneProvider || undefined} disabled={!profile.alternativePhone.trim()} placeholder={t('Service provider')} style={{ minWidth: 150 }} options={providersForCountry(profile.country).map((value) => ({ value, label: value }))} onChange={(value) => update({ alternativePhoneProvider: value || '' })} />
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

                        <div className="consultant-profile-save">
                            {dirty && <span className="consultant-profile-unsaved">{t('Unsaved changes')}</span>}
                            <Button block type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty && !showErrors} onClick={() => void save()}>{t('Save profile')}</Button>
                        </div>
                    </Form>
                </Card>
            </div>

            <ResponsiveModal open={previewOpen} onClose={() => setPreviewOpen(false)} title={t('How SMEs see your profile')} width={520} centered className="consultant-profile-preview-modal">
                <Typography.Paragraph type="secondary">
                    {saved?.status === 'published'
                        ? t('This is your card in the consultant marketplace, including any changes you haven’t saved yet.')
                        : t('Once published, this is how your card appears in the consultant marketplace.')}
                </Typography.Paragraph>
                <ConsultantMarketplaceCard profile={profile} action={<Button type="primary" block disabled>{t('Choose this consultant')}</Button>} />
            </ResponsiveModal>
        </DashboardPage>
    )
}

export default function ConsultantProfilePage() {
    const { user } = useFullIdentity()
    if (user && !hasConsultantMarketplaceProfile(user)) return <Navigate to="/profile" replace />
    return <ConsultantMarketplaceProfileForm />
}
