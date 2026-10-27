import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Checkbox, Col, Row, Space, Tag, Typography, Upload } from 'antd'
import { CameraOutlined, CheckCircleFilled, EditOutlined, HistoryOutlined, LockOutlined, MailOutlined, SaveOutlined, SettingOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { EditSettingModal } from '@/components/settings/EditSettingModal'
import { SetupChangeRequestModal } from '@/components/settings/SetupChangeRequestModal'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { listCompanySettingsChanges, type DirectSettingKey, type SettingsChange } from '@/services/companySettingsEditService'
import { ASSIGNMENT_OPTIONS, DELIVERY_ROLE_LABELS, DIVISION_OPTIONS, SETUP_SETTINGS, type SetupSettingKey } from '@/components/settings/setupSettings'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  AREA_LABELS,
  DELEGABLE_ROLES,
  ROLE_LABELS,
  canManageArea,
  readDelegation,
  saveCompanyLogo,
  saveDelegation,
  type Delegation,
  type DelegationArea,
  type DelegableRole,
} from '@/services/companyDelegationService'
import { getSystemSettings, listMySystemSettingsChangeRequests } from '@/services/companySettingsService'
import { listWorkspacePrograms } from '@/services/workspaceProgramsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { DEFAULT_INTERVENTION_DELIVERY_ROLES, type ChangeRequestStatus, type SystemSettingsChangeRequest, type SystemSettingsRecord } from '@/types/companySettings'
import '@/styles/dashboard.css'
import '@/styles/profile.css'
import '@/styles/settings.css'

const { Text, Title } = Typography

const REQUEST_STATUS: Record<ChangeRequestStatus, { label: string, color: string }> = {
  pending: { label: 'Waiting', color: 'orange' },
  approved: { label: 'Approved', color: 'green' },
  declined: { label: 'Declined', color: 'red' },
}

// Change requests listed before "Show all".
const RECENT_REQUESTS = 3

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

/**
 * Company settings, laid out like the profile pages: the company card (logo, setup checklist) on the left and the
 * setup, permissions and change requests on the right. Directors change the lower-risk settings directly (each change
 * is logged and emailed to the platform admin); the ones that change who can see what go through a change request.
 * Other roles see it read-only.
 */
export const CompanySettingsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user } = useFullIdentity()
  const [settings, setSettings] = useState<SystemSettingsRecord | null>(null)
  const [requests, setRequests] = useState<SystemSettingsChangeRequest[]>([])
  const [programmeCount, setProgrammeCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestSetting, setRequestSetting] = useState<SetupSettingKey>()
  const [showAllRequests, setShowAllRequests] = useState(false)
  const [delegation, setDelegation] = useState<Delegation>({ structure: [], branding: [] })
  const [savingDelegation, setSavingDelegation] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editField, setEditField] = useState<DirectSettingKey>()
  const [changes, setChanges] = useState<SettingsChange[]>([])
  const [showAllChanges, setShowAllChanges] = useState(false)
  const [hasOlderChanges, setHasOlderChanges] = useState(false)
  const { refresh: refreshSystemSettings } = useSystemSettings()

  const isDirector = user?.role === 'director'
  const canRequest = user?.role === 'director' || user?.role === 'systemadmin'
  // Directors (and platform admins) change the lower-risk settings directly; firestore.rules allows the same fields.
  const canEdit = canRequest
  const canChangeLogo = !!settings && canManageArea(user?.role, settings, 'branding')

  const load = useCallback(async () => {
    if (!user) return
    try {
      const [settingsData, requestData, programmes, changeData] = await Promise.all([
        user.companyCode ? getSystemSettings(user.companyCode) : Promise.resolve(null),
        listMySystemSettingsChangeRequests(user).catch(() => [] as SystemSettingsChangeRequest[]),
        listWorkspacePrograms(user).catch(() => []),
        listCompanySettingsChanges(String(user.companyCode || '')).catch(() => ({ changes: [] as SettingsChange[], hasOlder: false })),
      ])
      setSettings(settingsData)
      setDelegation(readDelegation(settingsData))
      setRequests(requestData)
      setProgrammeCount(programmes.length)
      setChanges(changeData.changes)
      setHasOlderChanges(changeData.hasOlder)
    } catch (error) {
      console.error(error)
      message.error(t('Settings could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [message, t, user])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  useRegisterAgentPageContext({
    pageKey: 'company-settings',
    pageName: 'Company settings',
    purpose: 'Shows how the company is set up (directors change most settings directly; branch visibility and turning off departments or branches go through a request), who may manage structure and the logo, the change history and the director\'s change requests.',
    metrics: { changeRequests: requests.length, pending: requests.filter((request) => request.status === 'pending').length },
  })

  const savedDelegation = useMemo(() => readDelegation(settings), [settings])
  const delegationDirty = JSON.stringify(delegation) !== JSON.stringify(savedDelegation)
  const companyName = settings?.companyName || user?.companyCode || t('Your company')
  const deliveryRoles = settings?.interventionDeliveryRoles?.length ? settings.interventionDeliveryRoles : DEFAULT_INTERVENTION_DELIVERY_ROLES

  const openRequest = (setting?: SetupSettingKey) => {
    setRequestSetting(setting)
    setRequestOpen(true)
  }

  const uploadLogo = async (file: File) => {
    if (!user?.companyCode) return
    setUploading(true)
    try {
      await saveCompanyLogo(user, user.companyCode, file)
      message.success(t('Company logo updated. Reload the page to see it everywhere.'))
      await load()
    } catch {
      message.error(t('The logo could not be uploaded.'))
    } finally {
      setUploading(false)
    }
  }

  const saveChanges = async () => {
    if (!user?.companyCode) return
    setSavingDelegation(true)
    try {
      await saveDelegation(user, user.companyCode, delegation)
      message.success(t('Delegation saved.'))
      await load()
    } catch {
      message.error(t('Delegation could not be saved.'))
    } finally {
      setSavingDelegation(false)
    }
  }

  const canEditSetting = canEdit && !!settings
  const checklist: Array<{ key: string, label: string, done: boolean, action?: { label: string, run: () => void } }> = [
    { key: 'logo', label: t('Company logo'), done: !!settings?.logoUrl, action: canChangeLogo ? { label: t('Upload'), run: () => document.querySelector<HTMLElement>('.settings-logo-target')?.click() } : undefined },
    { key: 'assignment', label: t(SETUP_SETTINGS.assignmentModel), done: !!settings?.assignmentModel, action: canEditSetting ? { label: t('Set'), run: () => setEditField('assignmentModel') } : undefined },
    { key: 'division', label: t('How SMEs are divided'), done: !!settings?.smeDivisionModel, action: canEditSetting ? { label: t('Set'), run: () => setEditField('smeDivisionModel') } : undefined },
    { key: 'delivery', label: t(SETUP_SETTINGS.interventionDeliveryRoles), done: deliveryRoles.length > 0, action: canEditSetting ? { label: t('Set'), run: () => setEditField('interventionDeliveryRoles') } : undefined },
    { key: 'structure', label: t('Company structure'), done: !!settings },
  ]
  const doneCount = checklist.filter((item) => item.done).length

  const editLink = (field: DirectSettingKey, label: string) => (canEditSetting
    ? <Button type="link" size="small" icon={<EditOutlined />} onClick={() => setEditField(field)}>{label}</Button>
    : null)
  const requestLink = (setting: SetupSettingKey) => (canRequest
    ? <Button type="link" size="small" icon={<MailOutlined />} onClick={() => openRequest(setting)}>{t('Request')}</Button>
    : null)
  const yesNo = (value?: boolean) => (value ? t('Yes') : t('No'))

  // A logged value as people read it (the log stores the raw setting value).
  const describeValue = (field: DirectSettingKey, value: SettingsChange['from']) => {
    if (value === null || value === undefined || value === '') return t('Not set')
    if (typeof value === 'boolean') return yesNo(value)
    if (Array.isArray(value)) return value.map((role) => t(DELIVERY_ROLE_LABELS[role as keyof typeof DELIVERY_ROLE_LABELS] || role)).join(', ')
    if (field === 'assignmentModel') return t(ASSIGNMENT_OPTIONS[value] || value)
    if (field === 'smeDivisionModel') return t(DIVISION_OPTIONS[value] || value)
    return `“${value}”`
  }

  const logo = (
    <div className={`settings-logo-target${canChangeLogo ? ' is-editable' : ''}`}>
      {settings?.logoUrl
        ? <img src={settings.logoUrl} alt={t('Company logo')} />
        : <span className="settings-logo-initials">{initialsOf(companyName)}</span>}
      {canChangeLogo && <Button shape="circle" icon={<CameraOutlined />} loading={uploading} className="settings-logo-camera" aria-label={t('Change logo')} />}
    </div>
  )

  const shownRequests = showAllRequests ? requests : requests.slice(0, RECENT_REQUESTS)
  const waiting = requests.filter((request) => request.status === 'pending').length

  return (
    <DashboardPage className="company-settings-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8} className="profile-identity-col">
          <Card loading={loading} className="dashboard-section-card motion-card settings-identity">
            {canChangeLogo ? (
              <Upload accept=".png,.jpg,.jpeg,.webp" showUploadList={false} beforeUpload={(file) => { void uploadLogo(file); return false }}>
                {logo}
              </Upload>
            ) : logo}
            <Title level={4} className="settings-identity-name">{companyName}</Title>
            <Space size={6} wrap className="settings-identity-tags">
              {user?.companyCode && <Tag color="purple" style={{ margin: 0 }}>{user.companyCode}</Tag>}
              {programmeCount !== null && (
                <Tag style={{ margin: 0 }}>{programmeCount === 1 ? t('1 programme') : t('{count} programmes', undefined, { count: programmeCount })}</Tag>
              )}
            </Space>

            <div className="profile-checklist" aria-label={t('Setup checklist')}>
              <strong>{t('Setup {done} of {total} done', undefined, { done: doneCount, total: checklist.length })}</strong>
              <ul>
                {checklist.map((item) => (
                  <li key={item.key} className={item.done ? 'is-done' : 'is-missing'}>
                    {item.done ? <CheckCircleFilled /> : <span className="profile-checklist-ring" />}
                    <span>{item.label}</span>
                    {!item.done && item.action && <button type="button" onClick={item.action.run}>{item.action.label}</button>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="settings-identity-foot">
              <Text type="secondary">{t('Your own details')}</Text>
              <Button type="link" size="small" onClick={() => navigate(user?.role === 'incubatee' ? '/incubatee/profile' : '/profile')}>{t('My profile')} →</Button>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card
              loading={loading}
              className="dashboard-section-card motion-card"
              title={<Space><SettingOutlined /> {t('How your company works')}</Space>}
              extra={canRequest && settings ? <Button icon={<MailOutlined />} onClick={() => openRequest()}>{t('Request a change')}</Button> : undefined}
            >
              {!settings ? (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Alert type="warning" showIcon message={t('No company setup record was found for this workspace.')} />
                  {canRequest && <Button type="primary" icon={<MailOutlined />} onClick={() => openRequest()}>{t('Request your company setup')}</Button>}
                </Space>
              ) : (
                <>
                  <div className="settings-lock">
                    <LockOutlined />
                    <span>
                      {canEdit
                        ? t('You can change most of these yourself, and the platform admin is told about each change. Settings with a Request link affect who can see what, so they go through the platform admin.')
                        : t('Your director manages how your company is set up.')}
                    </span>
                  </div>

                  <div className="settings-group">
                    <span>{t('Delivery')}</span>
                    <div className="settings-rows">
                      <div className="settings-row">
                        <div>{t(SETUP_SETTINGS.assignmentModel)}<small>{t('Operations assigns them, or facilitators pick their own')}</small></div>
                        <div>
                          {settings.assignmentModel ? t(ASSIGNMENT_OPTIONS[settings.assignmentModel] || settings.assignmentModel) : <Tag bordered={false} color="orange">{t('Not set')}</Tag>}
                          {editLink('assignmentModel', settings.assignmentModel ? t('Change') : t('Set'))}
                        </div>
                      </div>
                      <div className="settings-row">
                        <div>{t(SETUP_SETTINGS.interventionDeliveryRoles)}</div>
                        <div>
                          {deliveryRoles.map((role) => <Tag key={role} bordered={false} style={{ margin: 0 }}>{t(DELIVERY_ROLE_LABELS[role])}</Tag>)}
                          {editLink('interventionDeliveryRoles', t('Change'))}
                        </div>
                      </div>
                      <div className="settings-row">
                        <div>{t(SETUP_SETTINGS.smeDivisionModel)}</div>
                        <div>
                          {settings.smeDivisionModel ? t(DIVISION_OPTIONS[settings.smeDivisionModel] || settings.smeDivisionModel) : <Tag bordered={false} color="orange">{t('Not set')}</Tag>}
                          {editLink('smeDivisionModel', settings.smeDivisionModel ? t('Change') : t('Set'))}
                        </div>
                      </div>
                      <div className="settings-row">
                        <div>{t(SETUP_SETTINGS.consultantLabel)}</div>
                        <div>
                          {settings.consultantLabel || t('Facilitators')}
                          {editLink('consultantLabel', t('Change'))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="settings-group">
                    <span>{t('Structure')}</span>
                    <div className="settings-rows">
                      {/* Turning these on is direct; turning them off (units may already exist) goes through a request. */}
                      <div className="settings-row">
                        <div>{t(SETUP_SETTINGS.hasDepartments)}</div>
                        <div>{yesNo(settings.hasDepartments)}{settings.hasDepartments ? requestLink('hasDepartments') : editLink('hasDepartments', t('Turn on'))}</div>
                      </div>
                      <div className="settings-row">
                        <div>{t(SETUP_SETTINGS.hasBranches)}</div>
                        <div>{yesNo(settings.hasBranches)}{settings.hasBranches ? requestLink('hasBranches') : editLink('hasBranches', t('Turn on'))}</div>
                      </div>
                      <div className="settings-row">
                        <div>{t(SETUP_SETTINGS.branchScopedManagement)}<small>{t('Changes who can see which SMEs')}</small></div>
                        <div>{yesNo(settings.branchScopedManagement)}{requestLink('branchScopedManagement')}</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </Card>

            {isDirector && settings && (
              <Card
                loading={loading}
                className="dashboard-section-card motion-card"
                title={<Space><TeamOutlined /> {t('Who can manage what')}</Space>}
                extra={<Text type="secondary" className="settings-hint">{t('Everyone in your company can always see these')}</Text>}
              >
                <Text type="secondary" className="settings-hint settings-matrix-intro">
                  {t('Ticking a box doesn’t change anyone’s role. It only lets everyone with that role edit that area; untick it to take the right away again.')}
                </Text>
                <table className="settings-matrix">
                  <thead>
                    <tr>
                      <th />
                      {DELEGABLE_ROLES.map((role) => <th key={role}>{t(ROLE_LABELS[role])}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(AREA_LABELS) as DelegationArea[]).map((area) => (
                      <tr key={area}>
                        <td>{t(AREA_LABELS[area].title)}<small>{t(AREA_LABELS[area].description)}</small></td>
                        {DELEGABLE_ROLES.map((role: DelegableRole) => (
                          <td key={role}>
                            <Checkbox
                              aria-label={`${t(AREA_LABELS[area].title)}: ${t(ROLE_LABELS[role])}`}
                              checked={delegation[area].includes(role)}
                              onChange={(event) => setDelegation((current) => ({
                                ...current,
                                [area]: event.target.checked ? [...current[area], role] : current[area].filter((value) => value !== role),
                              }))}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            {/* Only once there are requests: the Request links on the rows above are how one is started. */}
            {canRequest && requests.length > 0 && (
              <Card
                loading={loading}
                className="dashboard-section-card motion-card"
                title={<Space><MailOutlined /> {t('Change requests')}</Space>}
                extra={waiting ? <Tag bordered={false} color="orange">{t('{count} waiting', undefined, { count: waiting })}</Tag> : undefined}
              >
                <div className="settings-requests">
                    {shownRequests.map((request) => (
                      <div key={request.id} className="settings-request">
                        <div>
                          <Text strong>{request.reason.split('\n')[0]}</Text>
                          <Tag bordered={false} color={REQUEST_STATUS[request.status]?.color} style={{ margin: 0 }}>{t(REQUEST_STATUS[request.status]?.label || request.status)}</Tag>
                        </div>
                        <Text type="secondary" className="settings-hint">
                          {request.requestedAt ? t('Sent {date}', undefined, { date: dayjs(request.requestedAt).format('D MMM YYYY') }) : ''}
                          {' · '}
                          {request.adminResponse ? `“${request.adminResponse}”` : t('Awaiting the platform admin')}
                        </Text>
                      </div>
                    ))}
                    {requests.length > RECENT_REQUESTS && (
                      <Button type="link" size="small" className="settings-show-all" onClick={() => setShowAllRequests((value) => !value)}>
                        {showAllRequests ? t('Show fewer') : t('Show all {count}', undefined, { count: requests.length })}
                      </Button>
                    )}
                </div>
              </Card>
            )}

            {settings && changes.length > 0 && (
              <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><HistoryOutlined /> {t('Change history')}</Space>}>
                <div className="settings-requests">
                  {(showAllChanges ? changes : changes.slice(0, RECENT_REQUESTS)).map((change) => (
                    <div key={change.id} className="settings-request">
                      <Text strong>{t(SETUP_SETTINGS[change.field] || change.field)}: {describeValue(change.field, change.from)} → {describeValue(change.field, change.to)}</Text>
                      <Text type="secondary" className="settings-hint">
                        {[change.changedByName, change.changedAt?.format('D MMM YYYY, HH:mm')].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                  ))}
                  {/* Only the latest HISTORY_LIMIT changes are loaded; say so when older ones exist. */}
                  {showAllChanges && hasOlderChanges && (
                    <Text type="secondary" className="settings-hint">{t('Showing the latest {count} changes.', undefined, { count: changes.length })}</Text>
                  )}
                  {changes.length > RECENT_REQUESTS && (
                    <Button type="link" size="small" className="settings-show-all" onClick={() => setShowAllChanges((value) => !value)}>
                      {showAllChanges ? t('Show fewer') : t('Show more')}
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {isDirector && settings && (
              <div className="profile-save-bar">
                {delegationDirty && <span className="profile-unsaved">{t('Unsaved changes')}</span>}
                <Button block type="primary" icon={<SaveOutlined />} loading={savingDelegation} disabled={!delegationDirty} onClick={() => void saveChanges()}>{t('Save changes')}</Button>
              </div>
            )}

            {!canRequest && !loading && (
              <Text type="secondary" className="settings-hint">{t('Your director manages these settings.')}</Text>
            )}
          </Space>
        </Col>
      </Row>

      {user && editField && (
        <EditSettingModal
          key={editField}
          field={editField}
          user={user}
          settings={settings}
          onClose={() => setEditField(undefined)}
          onSaved={() => { void load(); void refreshSystemSettings() }}
        />
      )}

      {user && (
        <SetupChangeRequestModal
          open={requestOpen}
          initialSetting={requestSetting}
          user={user}
          settings={settings}
          onClose={() => setRequestOpen(false)}
          onSent={() => void load()}
        />
      )}
    </DashboardPage>
  )
}

export default CompanySettingsPage
