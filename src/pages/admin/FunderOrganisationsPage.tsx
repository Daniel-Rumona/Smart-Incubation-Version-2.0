import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Badge, Button, Card, Col, Empty, Flex, Form, Input, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd'
import { BankOutlined, CheckOutlined, ClockCircleOutlined, LinkOutlined, MergeCellsOutlined, PlusOutlined, SearchOutlined, SendOutlined, SwapOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  FUNDER_ORG_TYPES, FUNDER_ORG_TYPE_LABELS, confirmFunderOrganisation, convertCompanyFunder, createFunderOrganisation, funderOrgErrorMessage,
  mergeFunderOrganisations, subscribeAllFunderLinks, subscribeFunderAccounts, subscribeFunderOrganisations,
  type FunderLink, type FunderOrgType, type FunderOrganisation, type OldStyleFunder,
} from '@/services/funderOrganisationsService'
import '@/styles/dashboard.css'
import '@/styles/funder-organisations.css'

// The same reduction the server uses for its duplicate check (functions/src/funderOrganisations.ts funderNameKey),
// here only to suggest which organisation to merge a new one into.
const FILLER = new Set(['the', 'fund', 'funds', 'foundation', 'trust', 'agency', 'of', 'and', 'for', 'sa', 'south', 'africa', 'pty', 'ltd', 'npc', 'inc'])
const nameKey = (name: string) => {
  const words = name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
  const kept = words.filter((word) => !FILLER.has(word))
  return (kept.length ? kept : words).join('')
}
const looksAlike = (left: string, right: string) => {
  const [a, b] = [nameKey(left), nameKey(right)]
  if (!a || !b) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return a === b || (short.length >= 4 && long.includes(short))
}

/** The convert modal's "make a new organisation" choice. */
const NEW_ORG = '__new__'

const LINK_COLORS: Record<FunderLink['status'], string> = { active: 'green', pending: 'gold', declined: 'red', expired: 'default', removed: 'default' }

/**
 * System admins: new funder organisations that implementors invited wait here to be confirmed (or merged into one
 * already on the platform), funders made the old way (one company) wait to be converted, and every organisation is
 * listed with its sign-ins and the projects it is linked to. Organisations can also be added here directly.
 */
export default function FunderOrganisationsPage() {
  const { t } = useLanguage()
  const { message, modal } = App.useApp()
  const [organisations, setOrganisations] = useState<FunderOrganisation[]>([])
  const [links, setLinks] = useState<FunderLink[]>([])
  const [members, setMembers] = useState<Map<string, number>>(new Map())
  const [oldStyle, setOldStyle] = useState<OldStyleFunder[]>([])
  const [adding, setAdding] = useState(false)
  const [addForm] = Form.useForm<{ name: string; type: FunderOrgType }>()
  const addName = Form.useWatch('name', addForm) as string | undefined
  const [converting, setConverting] = useState<OldStyleFunder | null>(null)
  const [convertTarget, setConvertTarget] = useState<string>()
  const [convertForm] = Form.useForm<{ name: string; type: FunderOrgType }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string>()
  const [merging, setMerging] = useState<FunderOrganisation | null>(null)
  const [mergeTarget, setMergeTarget] = useState<string>()

  useEffect(() => {
    const failed = () => { setError(t('Funder organisations could not be loaded.')); setLoading(false) }
    const stops = [
      subscribeFunderOrganisations((rows) => { setOrganisations(rows); setLoading(false); setError('') }, failed),
      subscribeAllFunderLinks(setLinks, failed),
      subscribeFunderAccounts(({ counts, oldStyle: rows }) => { setMembers(counts); setOldStyle(rows) }, () => { setMembers(new Map()); setOldStyle([]) }),
    ]
    return () => stops.forEach((stop) => stop())
  }, [attempt, t])

  const linksByOrg = useMemo(() => {
    const map = new Map<string, FunderLink[]>()
    links.filter((link) => link.status !== 'removed').forEach((link) => map.set(link.funderOrgId, [...(map.get(link.funderOrgId) || []), link]))
    return map
  }, [links])

  const confirmed = useMemo(() => organisations.filter((org) => org.status === 'confirmed'), [organisations])
  const awaiting = useMemo(() => organisations.filter((org) => org.status === 'invited')
    .sort((left, right) => (right.createdAt?.getTime() || 0) - (left.createdAt?.getTime() || 0)), [organisations])
  const listed = useMemo(() => {
    const term = search.trim().toLowerCase()
    return confirmed.filter((org) => (!term || org.name.toLowerCase().includes(term)
      || (linksByOrg.get(org.id) || []).some((link) => link.companyName.toLowerCase().includes(term) || link.programName.toLowerCase().includes(term))))
  }, [confirmed, linksByOrg, search])

  const metrics = useMemo(() => {
    const active = links.filter((link) => link.status === 'active')
    const implementorsByOrg = new Map<string, Set<string>>()
    active.forEach((link) => implementorsByOrg.set(link.funderOrgId, (implementorsByOrg.get(link.funderOrgId) || new Set()).add(link.companyCode)))
    return {
      confirmed: confirmed.length,
      multiImplementor: [...implementorsByOrg.values()].filter((codes) => codes.size > 1).length,
      activeLinks: active.length,
      implementors: new Set(active.map((link) => link.companyCode)).size,
      pendingLinks: links.filter((link) => link.status === 'pending').length,
    }
  }, [confirmed, links])

  const confirmOrg = (org: FunderOrganisation) => modal.confirm({
    title: t('Confirm {name}?', undefined, { name: org.name }),
    content: <Space orientation="vertical">
      <Typography.Text>{t('Invited by {company}. Contact: {contact}.', undefined, { company: org.createdByCompanyName || org.createdByCompany || '—', contact: [org.contactName, org.contactEmail].filter(Boolean).join(', ') || '—' })}</Typography.Text>
      <Typography.Text type="secondary">{t('Confirming lets its people accept programme links and lets other implementors find it. Check it is a real funder and the contact works there.')}</Typography.Text>
    </Space>,
    okText: t('Confirm organisation'),
    onOk: async () => {
      setBusy(`confirm-${org.id}`)
      try {
        await confirmFunderOrganisation(org.id)
        message.success(t('{name} confirmed. Its contact has been emailed.', undefined, { name: org.name }))
      } catch (err) {
        message.error(funderOrgErrorMessage(err, t('The organisation could not be confirmed.'), ''))
        throw err
      } finally {
        setBusy(undefined)
      }
    },
  })

  const openMerge = (org: FunderOrganisation) => {
    setMerging(org)
    setMergeTarget(confirmed.find((candidate) => looksAlike(candidate.name, org.name))?.id)
  }

  const runMerge = async () => {
    if (!merging || !mergeTarget) return
    setBusy('merge')
    try {
      await mergeFunderOrganisations(merging.id, mergeTarget)
      message.success(t('Merged. Its people and programme links moved across.'))
      setMerging(null)
    } catch (err) {
      message.error(funderOrgErrorMessage(err, t('The organisations could not be merged.'), ''))
    } finally {
      setBusy(undefined)
    }
  }

  // Names already on the platform that look like the one being added.
  const addLookalikes = useMemo(() => (addName || '').trim().length >= 3
    ? organisations.filter((org) => org.status !== 'merged' && looksAlike(org.name, addName || ''))
    : [], [addName, organisations])

  const addOrganisation = async () => {
    const values = await addForm.validateFields()
    setBusy('add')
    try {
      const created = await createFunderOrganisation(values)
      message.success(t('{name} added and confirmed.', undefined, { name: created.name }))
      setAdding(false)
      addForm.resetFields()
    } catch (err) {
      message.error(funderOrgErrorMessage(err, t('The organisation could not be added.'), ''))
    } finally {
      setBusy(undefined)
    }
  }

  const openConvert = (row: OldStyleFunder) => {
    setConverting(row)
    setConvertTarget(undefined)
    convertForm.setFieldsValue({ name: '', type: 'other' })
  }

  const runConvert = async () => {
    if (!converting || !convertTarget) return
    const newOrg = convertTarget === NEW_ORG ? await convertForm.validateFields() : undefined
    setBusy('convert')
    try {
      const result = await convertCompanyFunder({ userId: converting.uid, ...(newOrg ? { newOrg } : { orgId: convertTarget }) })
      message.success(t('{name} now funds through {org}, with {count} programmes.', undefined, { name: converting.name, org: result.orgName, count: result.programmes }))
      setConverting(null)
    } catch (err) {
      message.error(funderOrgErrorMessage(err, t('The funder could not be converted.'), ''))
    } finally {
      setBusy(undefined)
    }
  }

  const linkTags = (org: FunderOrganisation) => {
    const rows = linksByOrg.get(org.id) || []
    if (!rows.length) return <Typography.Text type="secondary">{t('No projects linked')}</Typography.Text>
    return <div className="funder-org-links">
      {rows.map((link) => (
        <Tag key={link.id} color={LINK_COLORS[link.status]}>
          {link.companyName} · {link.programName}{link.status === 'active' ? '' : ` (${t(link.status)})`}
        </Tag>
      ))}
    </div>
  }

  return <DashboardPage className="funder-orgs-page">
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => setAttempt((value) => value + 1)}>{t('Try again')}</Button>} />}

    <Row gutter={[16, 16]}>
      <Col xs={12} lg={6}>
        <DashboardMetricCard
          loading={loading}
          icon={<BankOutlined />}
          iconClassName="is-users"
          label={t('Funder organisations')}
          value={metrics.confirmed}
          hint={t('{count} with more than one implementor', undefined, { count: metrics.multiImplementor })}
        />
      </Col>
      <Col xs={12} lg={6}>
        <DashboardMetricCard
          loading={loading}
          icon={<ClockCircleOutlined />}
          iconClassName="is-attention"
          label={t('Awaiting confirmation')}
          value={awaiting.length}
          hint={awaiting.length ? t('Invited by implementors, waiting for you') : t('Nothing waiting')}
          clickable={awaiting.length > 0}
          onClick={awaiting.length ? () => document.getElementById('funder-orgs-awaiting')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined}
        />
      </Col>
      <Col xs={12} lg={6}>
        <DashboardMetricCard
          loading={loading}
          icon={<LinkOutlined />}
          iconClassName="is-delivery"
          label={t('Active programme links')}
          value={metrics.activeLinks}
          hint={t('Across {count} implementors', undefined, { count: metrics.implementors })}
        />
      </Col>
      <Col xs={12} lg={6}>
        <DashboardMetricCard
          loading={loading}
          icon={<SendOutlined />}
          iconClassName="is-participants"
          label={t('Requests with funders')}
          value={metrics.pendingLinks}
          hint={t('Not answered yet. They expire after 30 days')}
        />
      </Col>
    </Row>

    {/* Only while there's something to confirm. */}
    {awaiting.length > 0 && (
    <Card
      id="funder-orgs-awaiting"
      className="dashboard-section-card funder-orgs-awaiting"
      title={<Space>{t('Waiting for you to confirm')}<Badge count={awaiting.length} /></Space>}
    >
      <Table
        rowKey="id"
        dataSource={awaiting}
        pagination={false}
        scroll={{ x: 820 }}
        columns={[
          {
            title: t('Organisation'),
            key: 'name',
            render: (_, org) => {
              const similar = confirmed.filter((candidate) => looksAlike(candidate.name, org.name))
              return <Space orientation="vertical" size={2}>
                <Typography.Text strong>{org.name}</Typography.Text>
                <Typography.Text type="secondary">{t(FUNDER_ORG_TYPE_LABELS[org.type])}</Typography.Text>
                {similar.length > 0 && <Tag color="orange">{t('Looks like {name}', undefined, { name: similar.map((row) => row.name).join(', ') })}</Tag>}
              </Space>
            },
          },
          { title: t('Invited by'), key: 'company', render: (_, org) => org.createdByCompanyName || org.createdByCompany || '—' },
          { title: t('Contact'), key: 'contact', render: (_, org) => <Space orientation="vertical" size={0}><Typography.Text>{org.contactName || '—'}</Typography.Text><Typography.Text type="secondary">{org.contactEmail}</Typography.Text></Space> },
          { title: t('Invited'), key: 'createdAt', render: (_, org) => (org.createdAt ? dayjs(org.createdAt).format('D MMM YYYY') : '—') },
          { title: t('Projects'), key: 'links', render: (_, org) => linkTags(org) },
          {
            title: t('Actions'),
            key: 'actions',
            render: (_, org) => <Space>
              <Button type="primary" icon={<CheckOutlined />} loading={busy === `confirm-${org.id}`} onClick={() => confirmOrg(org)}>{t('Confirm')}</Button>
              <Button icon={<MergeCellsOutlined />} disabled={!confirmed.length} onClick={() => openMerge(org)}>{t('Merge')}</Button>
            </Space>,
          },
        ]}
      />
    </Card>
    )}

    {/* Only while funders made the old way (one company) are left to convert. */}
    {oldStyle.length > 0 && (
    <Card
      className="dashboard-section-card funder-orgs-awaiting"
      title={<Space>{t('Funders to convert')}<Badge count={oldStyle.length} /></Space>}
    >
      <Typography.Paragraph type="secondary">
        {t('These funders belong to one company, the old way. Convert each to a funder organisation: the programmes they see today become accepted links, and one sign-in can then cover every implementor they fund.')}
      </Typography.Paragraph>
      <Table
        rowKey="uid"
        dataSource={oldStyle}
        pagination={false}
        scroll={{ x: 700 }}
        columns={[
          { title: t('Funder'), key: 'name', render: (_, row) => <Space orientation="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.email}</Typography.Text>{!row.active && <Tag>{t('Inactive')}</Tag>}</Space> },
          { title: t('Company'), dataIndex: 'companyCode' },
          { title: t('Programmes'), key: 'programmes', render: (_, row) => (row.programIds.length ? t('{count} programmes', undefined, { count: row.programIds.length }) : t('All of the company\'s')) },
          { title: t('Actions'), key: 'actions', width: 140, render: (_, row) => <Button type="primary" icon={<SwapOutlined />} onClick={() => openConvert(row)}>{t('Convert')}</Button> },
        ]}
      />
    </Card>
    )}

    <Card
      className="dashboard-section-card"
      title={t('Funder organisations')}
      extra={<Space wrap className="funder-orgs-tools">
        <Input allowClear prefix={<SearchOutlined />} placeholder={t('Search funders, implementors or programmes')} value={search} onChange={(event) => setSearch(event.target.value)} className="funder-orgs-search" />
        <Button icon={<PlusOutlined />} onClick={() => { addForm.setFieldsValue({ name: '', type: 'other' }); setAdding(true) }}>{t('Add funder organisation')}</Button>
      </Space>}
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={listed}
        scroll={{ x: 820 }}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? t('No funder matches that search.') : t('No confirmed funder organisations yet. Implementors invite them from a programme\'s funders.')} /> }}
        columns={[
          { title: t('Organisation'), key: 'name', render: (_, org) => <Space orientation="vertical" size={2}><Typography.Text strong>{org.name}</Typography.Text><Typography.Text type="secondary">{t(FUNDER_ORG_TYPE_LABELS[org.type])}</Typography.Text></Space> },
          { title: t('Implementors'), key: 'implementors', width: 120, render: (_, org) => new Set((linksByOrg.get(org.id) || []).filter((link) => link.status === 'active').map((link) => link.companyCode)).size },
          { title: t('Sign-ins'), key: 'members', width: 100, render: (_, org) => members.get(org.id) || 0 },
          { title: t('Linked projects'), key: 'links', render: (_, org) => linkTags(org) },
        ]}
      />
    </Card>

    <Modal
      open={!!merging}
      title={t('Merge {name} into another funder', undefined, { name: merging?.name || '' })}
      onCancel={() => setMerging(null)}
      onOk={() => void runMerge()}
      okText={t('Merge')}
      okButtonProps={{ disabled: !mergeTarget, loading: busy === 'merge' }}
      cancelText={t('Cancel')}
      destroyOnHidden
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t('Its people and programme links move to the organisation you choose, and this one is closed. Where both are linked to the same programme, the link further along is kept.')}</Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          value={mergeTarget}
          onChange={setMergeTarget}
          placeholder={t('Choose a confirmed funder organisation')}
          options={confirmed.filter((org) => org.id !== merging?.id).map((org) => ({ value: org.id, label: org.name }))}
          style={{ width: '100%' }}
        />
        {mergeTarget && merging && <Flex vertical gap={4}>
          <Typography.Text>{t('Moves across')}:</Typography.Text>
          <Typography.Text type="secondary">{t('{count} sign-ins', undefined, { count: members.get(merging.id) || 0 })} · {t('{count} programme links', undefined, { count: (linksByOrg.get(merging.id) || []).length })}</Typography.Text>
        </Flex>}
      </Space>
    </Modal>

    <Modal
      open={adding}
      title={t('Add funder organisation')}
      onCancel={() => setAdding(false)}
      onOk={() => void addOrganisation()}
      okText={t('Add and confirm')}
      okButtonProps={{ loading: busy === 'add' }}
      cancelText={t('Cancel')}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{t('Added here, it is confirmed straight away. Implementors can then find it and ask it to accept their programmes.')}</Typography.Paragraph>
      <Form form={addForm} layout="vertical" requiredMark={false} initialValues={{ type: 'other' }}>
        <Form.Item name="name" label={t('Organisation name')} rules={[{ required: true, whitespace: true, min: 2, message: t('Enter the funder organisation\'s name.') }]} style={{ marginBottom: addLookalikes.length ? 8 : undefined }}>
          <Input maxLength={120} placeholder="Sibanye Trust" />
        </Form.Item>
        {addLookalikes.length > 0 && (
          <Alert type="warning" showIcon className="funder-lookalike" message={t('A similar funder is already on the platform')} description={addLookalikes.map((org) => org.name).join(', ')} />
        )}
        <Form.Item name="type" label={t('Type')}>
          <Select options={FUNDER_ORG_TYPES.map((value) => ({ value, label: t(FUNDER_ORG_TYPE_LABELS[value]) }))} />
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      open={!!converting}
      title={t('Convert {name} to a funder organisation', undefined, { name: converting?.name || '' })}
      onCancel={() => setConverting(null)}
      onOk={() => void runConvert()}
      okText={t('Convert')}
      okButtonProps={{ disabled: !convertTarget, loading: busy === 'convert' }}
      cancelText={t('Cancel')}
      destroyOnHidden
    >
      {converting && <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          {converting.programIds.length
            ? t('Their {count} programmes at {company} become accepted links of the organisation you choose, and their company code is cleared. They keep seeing the same data.', undefined, { count: converting.programIds.length, company: converting.companyCode })
            : t('Every programme {company} runs today becomes an accepted link of the organisation you choose, and their company code is cleared. They keep seeing the same data.', undefined, { company: converting.companyCode })}
        </Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          value={convertTarget}
          onChange={setConvertTarget}
          placeholder={t('Choose the funder organisation they work for')}
          options={[
            { value: NEW_ORG, label: t('+ New funder organisation') },
            ...confirmed.map((org) => ({ value: org.id, label: org.name })),
          ]}
          style={{ width: '100%' }}
        />
        {convertTarget === NEW_ORG && (
          <Form form={convertForm} layout="vertical" requiredMark={false} initialValues={{ type: 'other' }}>
            <Form.Item name="name" label={t('Organisation name')} rules={[{ required: true, whitespace: true, min: 2, message: t('Enter the funder organisation\'s name.') }]}>
              <Input maxLength={120} placeholder="Sibanye Trust" />
            </Form.Item>
            <Form.Item name="type" label={t('Type')}>
              <Select options={FUNDER_ORG_TYPES.map((value) => ({ value, label: t(FUNDER_ORG_TYPE_LABELS[value]) }))} />
            </Form.Item>
          </Form>
        )}
      </Space>}
    </Modal>
  </DashboardPage>
}
