import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Avatar, Button, Empty, Flex, Form, Input, Popconfirm, Select, Space, Tag, Tooltip, Typography } from 'antd'
import { DisconnectOutlined, MailOutlined, PlusOutlined, RedoOutlined, SendOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import FundingAmountEditor from '@/components/funders/FundingAmountEditor'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  FUNDER_ORG_TYPE_LABELS, FUNDER_ORG_TYPES, changeFunderInviteEmail, funderOrgErrorMessage, inviteFunderOrganisation, removeFunderLink,
  requestFunderLink, resendFunderInvite, searchFunderOrganisations, subscribeProgrammeFunderLinks,
  type FunderLink, type FunderOrgMatch, type FunderOrgType,
} from '@/services/funderOrganisationsService'
import '@/styles/funder-organisations.css'

dayjs.extend(relativeTime)

type Programme = { id: string; name: string; companyCode: string }
type InviteValues = { name: string; type: FunderOrgType; contactName: string; email: string }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || '?'

/** Waits for typing to pause before searching, so each keystroke isn't a function call. */
const useDebounced = <T,>(value: T, delay = 350) => {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return settled
}

/**
 * A programme's funders, for its director or project admins: who is linked, who hasn't answered yet, and adding one,
 * either an organisation already on the platform (a link request it accepts) or a new one (an invite a system admin
 * confirms). A link only goes live once the funder accepts.
 */
export default function ProgrammeFundersModal({ open, programme, onClose }: { open: boolean; programme: Programme | null; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      width={560}
      title={<Space orientation="vertical" size={0}>
        <span>{t('Funders of this programme')}</span>
        {programme && <Typography.Text type="secondary" className="funder-modal-subtitle">{programme.name}</Typography.Text>}
      </Space>}
      footer={<Button block onClick={onClose}>{t('Done')}</Button>}
    >
      {/* Mounted fresh for each programme, so nothing from the last one carries over. */}
      {open && programme && <ProgrammeFunders key={programme.id} programme={programme} />}
    </ResponsiveModal>
  )
}

/** Searches as the text settles: results for the latest text only, none below the minimum length. */
const useFunderSearch = (value: string, minLength: number) => {
  const settled = useDebounced(value.trim())
  const [result, setResult] = useState<{ text: string; matches: FunderOrgMatch[] }>({ text: '', matches: [] })
  useEffect(() => {
    if (settled.length < minLength) return
    let current = true
    searchFunderOrganisations(settled)
      .then((matches) => { if (current) setResult({ text: settled, matches }) })
      .catch(() => { if (current) setResult({ text: settled, matches: [] }) })
    return () => { current = false }
  }, [minLength, settled])
  const ready = settled.length >= minLength
  return {
    settled,
    matches: ready && result.text === settled ? result.matches : [],
    searching: ready && result.text !== settled,
  }
}

function ProgrammeFunders({ programme }: { programme: Programme }) {
  const { t } = useLanguage()
  const { message, modal } = App.useApp()
  const [links, setLinks] = useState<FunderLink[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string>()

  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string>()
  const { settled: debouncedSearch, matches: options, searching } = useFunderSearch(search, 2)

  const [inviting, setInviting] = useState(false)
  const [form] = Form.useForm<InviteValues>()
  const inviteName = Form.useWatch('name', form) as string | undefined
  // A new funder whose name looks like one already on the platform: offer that one instead.
  const { matches: lookalikeMatches } = useFunderSearch(inviting ? inviteName || '' : '', 3)
  const lookalikes = lookalikeMatches.slice(0, 3)

  useEffect(() => subscribeProgrammeFunderLinks(programme.companyCode, programme.id, (rows) => {
    setLinks(rows.sort((left, right) => left.funderOrgName.localeCompare(right.funderOrgName)))
    setLoadError(false)
    setLoading(false)
  }, () => { setLoadError(true); setLoading(false) }), [programme.companyCode, programme.id])

  const linkedOrgIds = useMemo(() => new Set(links.filter((link) => link.status === 'active' || link.status === 'pending').map((link) => link.funderOrgId)), [links])

  const run = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await work()
      message.success(done)
      return true
    } catch (error) {
      message.error(funderOrgErrorMessage(error, t('That didn\'t work. Try again.'), t('That email address already has an account. Use another address.')))
      return false
    } finally {
      setBusy(undefined)
    }
  }

  const askFunder = async (orgId: string) => {
    const asked = await run(`request-${orgId}`, () => requestFunderLink(programme.id, orgId), t('Link request sent. The funder sees it once they sign in.'))
    if (asked) { setChosen(undefined); setSearch('') }
    return asked
  }

  const closeInvite = () => { setInviting(false); form.resetFields() }

  const sendInvite = async () => {
    const values = await form.validateFields()
    const sent = await run('invite', () => inviteFunderOrganisation({ ...values, programId: programme.id }), t('Invite sent. A system admin confirms the new funder before it can accept.'))
    if (sent) closeInvite()
  }

  const changeEmail = (link: FunderLink) => {
    let email = link.funderOrgContactEmail || ''
    modal.confirm({
      title: t('Change the invited email address?'),
      content: <Space orientation="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t('The invite goes to the new address, and the old link stops working.')}</Typography.Text>
        <Input type="email" defaultValue={email} placeholder="name@funder.org" onChange={(event) => { email = event.target.value }} />
      </Space>,
      okText: t('Send to this address'),
      onOk: () => run(`email-${link.id}`, () => changeFunderInviteEmail(link.funderOrgId, email), t('Invite sent to the new address.')).then((ok) => { if (!ok) throw new Error('not_changed') }),
    })
  }

  const statusOf = (link: FunderLink) => {
    if (link.status === 'active') {
      return { tag: <Tag color="green">{t('Active')}</Tag>, detail: link.respondedAt ? t('Accepted by the funder on {date}', undefined, { date: dayjs(link.respondedAt).format('D MMM YYYY') }) : t('Accepted by the funder') }
    }
    if (link.status === 'pending' && link.funderOrgStatus === 'invited') {
      return {
        tag: <Tag color="gold">{t('Invited')}</Tag>,
        detail: t('Invited {email} {when}. Waiting for a system admin to confirm the organisation and the funder to accept.', undefined, {
          email: link.funderOrgContactEmail || t('the contact'), when: link.requestedAt ? dayjs(link.requestedAt).fromNow() : '',
        }),
      }
    }
    if (link.status === 'pending') return { tag: <Tag color="gold">{t('Pending')}</Tag>, detail: t('Waiting for the funder to accept') }
    if (link.status === 'declined') return { tag: <Tag color="red">{t('Declined')}</Tag>, detail: t('The funder said this isn\'t their project') }
    return { tag: <Tag>{t('Expired')}</Tag>, detail: t('The funder didn\'t answer within 30 days') }
  }

  const renderLink = (link: FunderLink) => {
    const { tag, detail } = statusOf(link)
    const invited = link.status === 'pending' && link.funderOrgStatus === 'invited'
    return (
      <div key={link.id} className="funder-link-row">
        <Avatar className={link.status === 'active' ? 'funder-link-avatar is-active' : 'funder-link-avatar'}>{initials(link.funderOrgName)}</Avatar>
        <div className="funder-link-body">
          <Flex align="center" gap={8} wrap>
            <Typography.Text strong>{link.funderOrgName}</Typography.Text>
            {tag}
          </Flex>
          <Typography.Text type="secondary" className="funder-link-detail">{detail}</Typography.Text>
          {(link.status === 'active' || link.status === 'pending') && <FundingAmountEditor link={link} />}
          {invited && (
            <Space size={4} wrap className="funder-link-actions">
              <Button size="small" icon={<RedoOutlined />} loading={busy === `resend-${link.id}`} onClick={() => void run(`resend-${link.id}`, () => resendFunderInvite(link.funderOrgId), t('Invite sent again.'))}>{t('Resend invite')}</Button>
              <Button size="small" icon={<MailOutlined />} onClick={() => changeEmail(link)}>{t('Change email')}</Button>
            </Space>
          )}
          {(link.status === 'declined' || link.status === 'expired') && (
            <Space size={4} wrap className="funder-link-actions">
              <Button size="small" icon={<SendOutlined />} loading={busy === `request-${link.funderOrgId}`} onClick={() => void askFunder(link.funderOrgId)}>{t('Ask again')}</Button>
            </Space>
          )}
        </div>
        {(link.status === 'active' || link.status === 'pending') && (
          <Popconfirm
            title={link.status === 'active' ? t('Remove this funder?') : t('Cancel this request?')}
            description={link.status === 'active' ? t('They stop seeing this programme\'s results.') : t('The funder won\'t be able to accept it.')}
            okText={link.status === 'active' ? t('Remove') : t('Cancel request')}
            cancelText={t('Keep')}
            okButtonProps={{ danger: true }}
            onConfirm={() => void run(`remove-${link.id}`, () => removeFunderLink(link.id), link.status === 'active' ? t('Funder removed.') : t('Request cancelled.'))}
          >
            <Tooltip title={link.status === 'active' ? t('Remove funder') : t('Cancel request')}>
              <Button type="text" icon={<DisconnectOutlined />} loading={busy === `remove-${link.id}`} aria-label={link.status === 'active' ? t('Remove funder') : t('Cancel request')} />
            </Tooltip>
          </Popconfirm>
        )}
      </div>
    )
  }

  return (
      <Space orientation="vertical" size={20} style={{ width: '100%' }}>
        {loadError && <Alert type="error" showIcon message={t('Funders could not be loaded.')} />}
        <div className="funder-link-list">
          {loading ? <Typography.Text type="secondary">{t('Loading funders...')}</Typography.Text>
            : links.length ? links.map(renderLink)
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No funders linked yet. Add the organisations that fund this programme so they can follow its results.')} />}
        </div>

        {!inviting ? (
          <div>
            <Typography.Text strong className="funder-section-label">{t('Add a funder')}</Typography.Text>
            <Flex gap={8}>
              <Select
                showSearch
                filterOption={false}
                value={chosen}
                searchValue={search}
                onSearch={setSearch}
                onChange={setChosen}
                loading={searching}
                placeholder={t('Search funder organisations on the platform')}
                notFoundContent={debouncedSearch.length < 2 ? t('Type at least two letters') : searching ? t('Searching...') : t('No funder by that name')}
                options={options.map((option) => ({ value: option.id, label: option.name, disabled: linkedOrgIds.has(option.id) }))}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button type="primary" icon={<SendOutlined />} disabled={!chosen} loading={!!chosen && busy === `request-${chosen}`} onClick={() => chosen && void askFunder(chosen)}>{t('Request link')}</Button>
            </Flex>
            <Typography.Text type="secondary" className="funder-hint">
              {t('Not listed?')} <Button type="link" size="small" className="funder-inline-link" icon={<PlusOutlined />} onClick={() => { setInviting(true); form.setFieldsValue({ name: search.trim(), type: 'other' }) }}>{t('Invite a new funder organisation')}</Button>
            </Typography.Text>
          </div>
        ) : (
          <div className="funder-invite-box">
            <Typography.Text strong className="funder-section-label">{t('Invite a new funder')}</Typography.Text>
            <Form form={form} layout="vertical" requiredMark={false} initialValues={{ type: 'other' }}>
              <Form.Item name="name" label={t('Organisation name')} rules={[{ required: true, whitespace: true, min: 2, message: t('Enter the funder organisation\'s name.') }]} style={{ marginBottom: lookalikes.length ? 8 : undefined }}>
                <Input maxLength={120} placeholder="Green Futures Fund" />
              </Form.Item>
              {lookalikes.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  icon={<WarningOutlined />}
                  className="funder-lookalike"
                  message={t('A similar funder is already on the platform')}
                  description={<Space orientation="vertical" size={4}>
                    {lookalikes.map((match) => (
                      <Flex key={match.id} align="center" justify="space-between" gap={8} wrap>
                        <Typography.Text>{match.name}</Typography.Text>
                        <Button size="small" disabled={linkedOrgIds.has(match.id)} loading={busy === `request-${match.id}`}
                          onClick={() => void askFunder(match.id).then((asked) => { if (asked) closeInvite() })}>
                          {linkedOrgIds.has(match.id) ? t('Already linked') : t('Request a link to it instead')}
                        </Button>
                      </Flex>
                    ))}
                  </Space>}
                />
              )}
              <Form.Item name="type" label={t('Type')}>
                <Select options={FUNDER_ORG_TYPES.map((value) => ({ value, label: t(FUNDER_ORG_TYPE_LABELS[value]) }))} />
              </Form.Item>
              <Form.Item name="contactName" label={t('Contact name')} rules={[{ required: true, whitespace: true, message: t('Enter the contact\'s name.') }]}>
                <Input maxLength={120} placeholder="Thandi Mokoena" />
              </Form.Item>
              <Form.Item name="email" label={t('Contact work email')} rules={[{ required: true, type: 'email', message: t('Enter a valid email address.') }]}>
                <Input type="email" maxLength={200} placeholder="name@funder.org" />
              </Form.Item>
            </Form>
            <Typography.Text type="secondary" className="funder-hint">{t('They get an email to set a password. Nothing about this programme is shown until a system admin confirms the organisation and the funder accepts the link.')}</Typography.Text>
            <Flex justify="flex-end" gap={8} className="funder-invite-actions">
              <Button onClick={closeInvite}>{t('Cancel')}</Button>
              <Button type="primary" icon={<SendOutlined />} loading={busy === 'invite'} onClick={() => void sendInvite()}>{t('Send invite')}</Button>
            </Flex>
          </div>
        )}
      </Space>
  )
}
