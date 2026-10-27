import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { App, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Segmented, Select, Space, Tag, Typography } from 'antd'
import { CloseOutlined, DeleteOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ConnectionThread, PlanSummary, connectionStatusColor, connectionStatusText, formatMoney } from '@/components/marketplace/ConnectionThread'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { getConsultantProfile } from '@/services/consultantMarketplaceService'
import { declineConnectionRequest, lastMessage, listConnectionRequestsForConsultant, sendConnectionMessage, sendConnectionPlan, subscribeToConnectionRequestsForConsultant, waitsOnConsultant } from '@/services/connectionRequestService'
import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'
import type { ConnectionPlanItem, ConnectionRequest } from '@/types/connectionRequest'
import { ModalActions } from '@/components/shared/ModalActions'
import '@/styles/marketplace.css'

const { Text } = Typography

type PlanForm = {
    items: Array<{ title: string; sessions: number; deliveryMode?: 'online' | 'in_person' | 'hybrid'; dueDate: Dayjs; price: number }>
    message?: string
}

const OPEN = ['pending', 'contacted', 'proposed']


/**
 * A freelance consultant's marketplace requests. They answer first: reply in the thread, send a plan built from
 * their services (prices shown for agreement only), or decline. Accepting is the SME's move.
 */
export const ConsultantRequestsPage = () => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const location = useLocation()
    const [params] = useSearchParams()
    const [requests, setRequests] = useState<ConnectionRequest[]>([])
    const [profile, setProfile] = useState<ConsultantMarketplaceProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<'open' | 'closed'>('open')
    const [openId, setOpenId] = useState<string | null>(null)
    const [planOpen, setPlanOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form] = Form.useForm<PlanForm>()

    const load = useCallback(async () => {
        if (!user?.uid) return
        setLoading(true)
        try {
            const [rows, nextProfile] = await Promise.all([
                listConnectionRequestsForConsultant(user.uid),
                getConsultantProfile(user.uid, { name: user.displayName, email: user.email }).catch(() => null),
            ])
            setRequests(rows)
            setProfile(nextProfile)
        } catch {
            message.error(t('Your requests could not be loaded.'))
        } finally {
            setLoading(false)
        }
    }, [message, t, user?.displayName, user?.email, user?.uid])

    useEffect(() => { void load() }, [load])

    // A live listener means an SME reply appears in the open thread immediately.
    useEffect(() => {
        if (!user?.uid) return
        return subscribeToConnectionRequestsForConsultant(user.uid, setRequests)
    }, [user?.uid])

    // Opened from an email link (?request=) or the dashboard (state.focusRequestId).
    useEffect(() => {
        const focus = params.get('request') || (location.state as { focusRequestId?: string } | null)?.focusRequestId
        if (focus) setOpenId(focus)
    }, [location.state, params])

    const selected = requests.find((row) => row.id === openId) || null
    const shown = useMemo(() => requests
        .filter((row) => (view === 'open' ? OPEN.includes(row.status) : !OPEN.includes(row.status)))
        .sort((left, right) => Number(waitsOnConsultant(right)) - Number(waitsOnConsultant(left))), [requests, view])
    const waitingCount = requests.filter(waitsOnConsultant).length

    const run = async (action: () => Promise<unknown>, success?: string) => {
        setSaving(true)
        try {
            await action()
            if (success) message.success(success)
            await load()
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : t('That could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    // A first plan starts from the consultant's own services in the area the SME asked about.
    const openPlanBuilder = (request: ConnectionRequest) => {
        const start = request.preferredStartDate ? dayjs(request.preferredStartDate) : dayjs().add(7, 'day')
        const fromPlan = request.plan?.items.map((item) => ({ ...item, dueDate: dayjs(item.dueDate) }))
        const services = (profile?.services || []).filter((service) => !request.areaOfSupport || service.areaOfSupport === request.areaOfSupport)
        const fromServices = services.flatMap((service) => (service.interventionExamples.length ? service.interventionExamples : [service.areaOfSupport]).map((title) => ({
            title, sessions: 1, deliveryMode: service.deliveryMode, price: service.rate || 0,
        }))).slice(0, 4).map((item, index) => ({ ...item, dueDate: start.add(7 * (index + 1), 'day') }))
        // Asked through the SME's "Use this plan": one intervention per step they chose, priced from the consultant's rate.
        const firstService = profile?.services[0]
        const fromSteps = (request.planSteps || []).map((title, index) => ({
            title, sessions: 1, deliveryMode: firstService?.deliveryMode || 'online', price: firstService?.rate || 0, dueDate: start.add(7 * (index + 1), 'day'),
        }))
        form.setFieldsValue({
            items: fromPlan || (fromSteps.length ? fromSteps : fromServices.length ? fromServices : [{ title: request.areaOfSupport || '', sessions: 1, deliveryMode: 'online', price: 0, dueDate: start.add(7, 'day') }]),
            message: '',
        })
        setPlanOpen(true)
    }

    const sendPlan = async () => {
        if (!selected || !user) return
        const values = await form.validateFields()
        const items: ConnectionPlanItem[] = values.items.map((item) => ({
            title: item.title.trim(),
            areaOfSupport: selected.areaOfSupport,
            sessions: Number(item.sessions) || 1,
            deliveryMode: item.deliveryMode,
            dueDate: item.dueDate.format('YYYY-MM-DD'),
            price: Number(item.price) || 0,
        }))
        await run(() => sendConnectionPlan(selected, user, { items, currency: profile?.currency || selected.currency || 'ZAR', message: values.message }), t('Plan sent to {sme}.', undefined, { sme: selected.smeName }))
        setPlanOpen(false)
    }

    const confirmDecline = (request: ConnectionRequest) => {
        let reason = ''
        modal.confirm({
            title: t('Decline this request?'),
            content: <Input.TextArea rows={3} maxLength={500} placeholder={t('Let {sme} know why, so they can ask someone else.', undefined, { sme: request.smeName })} onChange={(event) => { reason = event.target.value }} />,
            okText: t('Decline'),
            okButtonProps: { danger: true },
            onOk: () => user && run(() => declineConnectionRequest(request, user, 'consultant', reason), t('Request declined.')),
        })
    }

    const items = Form.useWatch('items', form) || []
    const total = items.reduce((sum, item) => sum + (Number(item?.price) || 0), 0)
    const currency = profile?.currency || selected?.currency || 'ZAR'
    const facts = (request: ConnectionRequest) => [
        request.areaOfSupport,
        request.deliveryMode && request.deliveryMode !== 'no_preference' ? t(request.deliveryMode === 'in_person' ? 'In person' : request.deliveryMode === 'hybrid' ? 'Hybrid' : 'Online') : '',
        request.preferredStartDate && t('start {date}', undefined, { date: dayjs(request.preferredStartDate).format('D MMM') }),
        request.engagementDays && t('about {count} days', undefined, { count: request.engagementDays }),
        typeof request.budget === 'number' && t('budget {amount}', undefined, { amount: formatMoney(request.budget, request.currency) }),
    ].filter(Boolean).join(' · ')

    return (
        <DashboardPage className="consultant-page">
            <FilterBar
                compact
                primary={<Segmented value={view} onChange={(value) => setView(value as 'open' | 'closed')} options={[{ value: 'open', label: waitingCount ? t('Open ({count} need you)', undefined, { count: waitingCount }) : t('Open') }, { value: 'closed', label: t('Started or closed') }]} />}
                actions={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>{t('Refresh')}</Button>}
            />
            <Card loading={loading} className="dashboard-section-card">
                {shown.length ? (
                    <div className="marketplace-request-list">
                        {shown.map((request) => (
                            <div key={request.id} role="button" tabIndex={0} className={`marketplace-request-row${waitsOnConsultant(request) ? ' is-waiting' : ''}`} onClick={() => setOpenId(request.id)} onKeyDown={(event) => { if (event.key === 'Enter') setOpenId(request.id) }}>
                                <div className="marketplace-request-main">
                                    <Text strong>{request.smeName}</Text>
                                    <Text type="secondary">{facts(request)}</Text>
                                    {(lastMessage(request)?.text || request.note) && <Text type="secondary" className="marketplace-request-quote">“{lastMessage(request)?.text || request.note}”</Text>}
                                </div>
                                <Tag bordered={false} color={waitsOnConsultant(request) && request.status === 'contacted' ? 'gold' : connectionStatusColor[request.status]} className="marketplace-request-tag">
                                    {waitsOnConsultant(request) && request.status === 'contacted' ? t('Waiting for your reply') : t(connectionStatusText(request.status, 'consultant', request.declinedBy))}
                                </Tag>
                            </div>
                        ))}
                    </div>
                ) : <Empty description={view === 'open' ? t('No open requests. SMEs find you through your published marketplace profile.') : t('Nothing started or closed yet.')} />}
            </Card>

            <ResponsiveModal open={!!selected} onClose={() => setOpenId(null)} title={selected?.smeName} width={640} centered>
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Space wrap size={8}>
                            <Tag bordered={false} color={connectionStatusColor[selected.status]}>{t(connectionStatusText(selected.status, 'consultant', selected.declinedBy))}</Tag>
                            <Text type="secondary">{facts(selected)}</Text>
                        </Space>
                        {selected.plan && (
                            <div>
                                <Text className="marketplace-section-title">{selected.status === 'matched' ? t('Agreed plan') : t('Your plan')}</Text>
                                <PlanSummary plan={selected.plan} />
                            </div>
                        )}
                        <div>
                            <Text className="marketplace-section-title">{t('Conversation')}</Text>
                            <ConnectionThread
                                request={selected}
                                viewer="consultant"
                                onSend={OPEN.includes(selected.status) && user ? (text) => run(() => sendConnectionMessage(selected, user, 'consultant', text)) : undefined}
                                placeholder={t('Ask {sme} a question', undefined, { sme: selected.smeName })}
                            />
                        </div>
                        <div className="marketplace-actions">
                            {OPEN.includes(selected.status) && <Button type="primary" icon={<FileTextOutlined />} onClick={() => openPlanBuilder(selected)}>{selected.plan ? t('Revise the plan') : t('Propose a plan')}</Button>}
                            {OPEN.includes(selected.status) && <Button danger icon={<CloseOutlined />} loading={saving} onClick={() => confirmDecline(selected)}>{t('Decline')}</Button>}
                            {selected.status === 'matched' && <Button type="primary" onClick={() => navigate('/consultant/interventions', { state: { needsYouIds: selected.assignmentIds || [] } })}>{t('Open the interventions')}</Button>}
                        </div>
                    </Space>
                )}
            </ResponsiveModal>

            <ResponsiveModal
                open={planOpen}
                onClose={() => setPlanOpen(false)}
                title={selected ? t('Plan for {sme}', undefined, { sme: selected.smeName }) : ''}
                width={920}
                centered
                footer={<ModalActions><Button type="primary" loading={saving} onClick={() => void sendPlan()}>{t('Send plan to {sme}', undefined, { sme: selected?.smeName || t('the SME') })}</Button></ModalActions>}
            >
                <Form form={form} layout="vertical" className="marketplace-plan-builder" requiredMark={false}>
                    <div className="marketplace-builder-row marketplace-builder-head">
                        <span>{t('Intervention')}</span><span>{t('Sessions')}</span><span>{t('How')}</span><span>{t('Due')}</span><span>{t('Price ({currency})', undefined, { currency })}</span><span />
                    </div>
                    <Form.List name="items">
                        {(fields, { add, remove }) => (
                            <>
                                {fields.map((field) => (
                                    <div key={field.key} className="marketplace-builder-row">
                                        <Form.Item name={[field.name, 'title']} rules={[{ required: true, whitespace: true, message: t('Name the intervention.') }]}><Input placeholder={t('Costing and pricing review')} aria-label={t('Intervention')} /></Form.Item>
                                        <Form.Item name={[field.name, 'sessions']} rules={[{ required: true, message: t('How many?') }]}><InputNumber min={1} max={50} style={{ width: '100%' }} aria-label={t('Sessions')} /></Form.Item>
                                        <Form.Item name={[field.name, 'deliveryMode']}><Select aria-label={t('How')} options={[{ value: 'online', label: t('Online') }, { value: 'in_person', label: t('In person') }, { value: 'hybrid', label: t('Hybrid') }]} /></Form.Item>
                                        <Form.Item name={[field.name, 'dueDate']} rules={[{ required: true, message: t('Pick a date.') }]}><DatePicker style={{ width: '100%' }} format="D MMM YYYY" disabledDate={(day) => day.isBefore(dayjs(), 'day')} aria-label={t('Due')} /></Form.Item>
                                        <Form.Item name={[field.name, 'price']} rules={[{ required: true, message: t('Add a price.') }]}><InputNumber min={0} step={50} style={{ width: '100%' }} aria-label={t('Price')} /></Form.Item>
                                        <Button type="text" icon={<DeleteOutlined />} disabled={fields.length === 1} onClick={() => remove(field.name)} aria-label={t('Remove')} />
                                    </div>
                                ))}
                                <Button icon={<PlusOutlined />} onClick={() => add({ title: '', sessions: 1, deliveryMode: 'online', price: 0, dueDate: dayjs().add(14, 'day') })}>{t('Add an intervention')}</Button>
                            </>
                        )}
                    </Form.List>
                    <div className="marketplace-builder-total"><span>{t('Total')}</span><span>{formatMoney(total, currency)}</span></div>
                    <Form.Item name="message" label={t('Message to {sme}', undefined, { sme: selected?.smeName || t('the SME') })}>
                        <Input.TextArea rows={3} maxLength={1000} placeholder={t('Say how you’ll approach it, and anything they should prepare.')} />
                    </Form.Item>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>{t('Prices are for agreement only; payment is arranged directly with the SME. When they accept, these become interventions on your My interventions page.')}</Text>
                </Form>
            </ResponsiveModal>
        </DashboardPage>
    )
}

export default ConsultantRequestsPage
