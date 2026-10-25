import { App, Avatar, Button, Card, Col, Dropdown, Form, Input, Row, Segmented, Select, Skeleton, Space, Switch, Tag, Tooltip, Typography, type MenuProps, type TableProps } from 'antd'
import { AimOutlined, ArrowLeftOutlined, ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined, LockOutlined, MoreOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined, TeamOutlined, UserSwitchOutlined, WhatsAppOutlined } from '@ant-design/icons'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { WeekHoursEditor } from '@/components/shared/WeekHoursEditor'
import { areasFor, listCompanyAreasOfSupport, saveConsultantWork, saveOperatingHours, saveRequireConsultantAcceptance, useCompanyWorkSettingsState, type CompanyWorkSettings, type WorkWindow } from '@/services/companyWorkSettingsService'
import { useEffect, useMemo, useState } from 'react'
import { countryFromPhone, providersForCountry } from '@/config/phoneProviders'
import '@/styles/staff-modal.css'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { FeaturePermissionsField } from '@/components/shared/FeaturePermissionsField'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { USER_ROLES, type UserRole } from '@/config/roles'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { createOperationsStaff, deleteOperationsStaff, listOperationsStaff, updateOperationsStaff, type StaffValues } from '@/services/operationsStaffService'
import type { IdentityPermission } from '@/types/identity'
import type { ManagedUser } from '@/types/operations'
import { getRolePermissions } from '@/config/permissions'

type StaffForm = Omit<ManagedUser, 'id' | 'status' | 'companyCode'> & { active: boolean }
type Section = 'details' | 'access' | 'work'
type WorkDraft = { areas: string[]; ownHours: boolean; hours: WorkWindow[] }

const SECTION_ORDER: Section[] = ['details', 'access', 'work']
// Details can't be passed (adding) or saved until these match; the Phone number field uses the same pattern.
const PHONE_PATTERN = /^\+?[0-9\s-]{8,16}$/

type RoleCardsProps = {
  value?: UserRole
  onChange?: (role: UserRole) => void
  options: Array<{ value: UserRole, label: string }>
  disabled?: boolean
}

const RoleCards = ({ value, onChange, options, disabled }: RoleCardsProps) => (
  <div className="staff-role-cards" role="radiogroup" aria-disabled={disabled}>
    {options.map((option) => (
      <button key={option.value} type="button" role="radio" disabled={disabled} aria-checked={value === option.value} className={`staff-role-card${value === option.value ? ' is-selected' : ''}`} onClick={() => { if (value !== option.value) onChange?.(option.value) }}>
        <Avatar size={28} icon={option.value === USER_ROLES.CONSULTANT ? <TeamOutlined /> : <UserSwitchOutlined />} />
        <strong>{option.label}</strong>
      </button>
    ))}
  </div>
)

const samePermissions = (left: IdentityPermission[] = [], right: IdentityPermission[] = []) =>
  left.length === right.length && left.every((permission) => right.includes(permission))

const initials = (row: ManagedUser) => (row.name || row.email).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

// The work a consultant has saved, or company hours and no areas when nothing is saved yet.
const savedWork = (settings: CompanyWorkSettings | null, uid?: string): WorkDraft => {
  const own = uid ? settings?.consultants[uid]?.hours : undefined
  return { areas: areasFor(settings, uid), ownHours: !!own?.length, hours: own?.length ? own : settings?.operatingHours || [] }
}

const sameWork = (left: WorkDraft, right: WorkDraft) => JSON.stringify(left) === JSON.stringify(right)

// Whether the form differs from what was loaded into it (permissions compared as a set).
const formChanged = (current: Partial<StaffForm>, initial?: StaffForm) => {
  if (!initial) return false
  const text = (value: unknown) => String(value ?? '').trim()
  return text(current.name) !== text(initial.name)
    || current.role !== initial.role
    || text(current.phone) !== text(initial.phone)
    || text(current.phoneProvider) !== text(initial.phoneProvider)
    || Boolean(current.phoneIsWhatsApp) !== Boolean(initial.phoneIsWhatsApp)
    || Boolean(current.active) !== Boolean(initial.active)
    || !samePermissions(current.permissions, initial.permissions)
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Monday first, matching WeekHoursEditor.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

// Error codes thrown by operationsStaffService and the staff Cloud Functions, mapped to what the manager should read.
const STAFF_ERRORS: Record<string, string> = {
  email_already_exists: 'Someone with this email already has an account.',
  permission_denied: "You don't have permission to manage this staff member.",
  forbidden: "You don't have permission to manage this staff member.",
  user_not_found: 'This staff member no longer exists. Refresh the list.',
  self_lockout: "You can't change your own role or deactivate your own account.",
  self_delete: "You can't delete your own account.",
  self_permissions: "You can't change your own access. Ask another manager on your team.",
}

export const StaffPage = () => {
  const { message, modal } = App.useApp()
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const [form] = Form.useForm<StaffForm>()
  const [staff, setStaff] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [missingAreasOnly, setMissingAreasOnly] = useState(false)
  const [editing, setEditing] = useState<ManagedUser>()
  const [modalOpen, setModalOpen] = useState(false)
  const [formValues, setFormValues] = useState<StaffForm>()
  const [section, setSection] = useState<Section>('details')
  const phone = Form.useWatch('phone', form)
  const role = Form.useWatch('role', form) as UserRole | undefined
  const active = Form.useWatch('active', form) as boolean | undefined
  const phoneCountry = countryFromPhone(phone)
  const providerOptions = providersForCountry(phoneCountry).map((value) => ({ value, label: value }))
  const roleOptions = useMemo(() => [
    { value: USER_ROLES.CONSULTANT, label: t('operations.staff.consultant') },
    { value: USER_ROLES.PROJECT_ADMIN, label: t('operations.staff.projectAdmin') },
  ], [t])
  const roleLabel = (value: UserRole) => value === USER_ROLES.OPERATIONS ? t('Operations') : roleOptions.find((option) => option.value === value)?.label || value
  const roleColor = (value: UserRole) => value === USER_ROLES.OPERATIONS ? 'blue' : 'purple'
  const staffError = (error: unknown, fallbackKey: string) => {
    const code = error instanceof Error ? error.message : ''
    return STAFF_ERRORS[code] ? t(STAFF_ERRORS[code]) : t(fallbackKey)
  }
  const isSelf = (row?: ManagedUser) => Boolean(row && user && row.id === user.uid)

  // How consultants work: company operating hours, and each consultant's areas of support and optional own hours.
  // Nothing that writes these settings is enabled until they have loaded, so an empty draft never replaces them.
  const { settings: workSettings, status: workStatus, retry: retryWork } = useCompanyWorkSettingsState(user?.companyCode)
  const workAvailable = Boolean(user?.companyCode)
  const workReady = workStatus === 'ready' && workSettings !== null
  const [companyAreas, setCompanyAreas] = useState<string[]>([])
  const [hoursOpen, setHoursOpen] = useState(false)
  // Drafts stay undefined until the manager changes something, so they always start from the loaded settings.
  const [hoursDraft, setHoursDraft] = useState<WorkWindow[]>()
  const [workDraft, setWorkDraft] = useState<WorkDraft>()
  const [savingHours, setSavingHours] = useState(false)

  useEffect(() => {
    if (user?.companyCode) void listCompanyAreasOfSupport(user.companyCode).then(setCompanyAreas).catch(() => setCompanyAreas([]))
  }, [user?.companyCode])

  const operatingHours = hoursDraft ?? workSettings?.operatingHours ?? []
  const work = workDraft ?? savedWork(workSettings, editing?.id)
  const workChanged = workDraft !== undefined && !sameWork(workDraft, savedWork(workSettings, editing?.id))
  const updateWork = (patch: Partial<WorkDraft>) => setWorkDraft({ ...work, ...patch })

  const workLoadError = (
    <div className="staff-load-error">
      <Typography.Text type="secondary">{t("The operating hours couldn't be loaded.")}</Typography.Text>
      <Button size="small" icon={<ReloadOutlined />} onClick={retryWork}>{t('Try again')}</Button>
    </div>
  )

  const hoursSummary = (windows: WorkWindow[]) => {
    const sorted = [...windows].sort((left, right) => DAY_ORDER.indexOf(left.dayOfWeek) - DAY_ORDER.indexOf(right.dayOfWeek))
    const runs: WorkWindow[][] = []
    sorted.forEach((window) => {
      const run = runs[runs.length - 1]
      const previous = run?.[run.length - 1]
      const follows = previous && DAY_ORDER.indexOf(window.dayOfWeek) === DAY_ORDER.indexOf(previous.dayOfWeek) + 1
      if (run && follows && previous.startTime === window.startTime && previous.endTime === window.endTime) run.push(window)
      else runs.push([window])
    })
    return runs.map((run) => {
      const days = run.length > 1
        ? t('{from} to {to}', undefined, { from: t(DAY_SHORT[run[0].dayOfWeek]), to: t(DAY_SHORT[run[run.length - 1].dayOfWeek]) })
        : t(DAY_SHORT[run[0].dayOfWeek])
      return `${days}, ${t('{from} to {to}', undefined, { from: run[0].startTime, to: run[0].endTime })}`
    }).join(' · ')
  }

  const openOperatingHours = () => {
    setHoursDraft(undefined)
    setHoursOpen(true)
  }
  const saveHours = async () => {
    if (!user || !workReady || hoursDraft === undefined) return
    try {
      setSavingHours(true)
      await saveOperatingHours(user, hoursDraft)
      message.success(t('Operating hours saved.'))
      setHoursOpen(false)
    } catch {
      message.error(t('The operating hours could not be saved.'))
    } finally {
      setSavingHours(false)
    }
  }
  const [savingAcceptance, setSavingAcceptance] = useState(false)
  const saveAcceptance = async (value: boolean) => {
    if (!user || !workReady) return
    try {
      setSavingAcceptance(true)
      await saveRequireConsultantAcceptance(user, value)
      message.success(value ? t('Consultants now accept new work before it starts.') : t('New work now starts without being accepted.'))
    } catch {
      message.error(t('This setting could not be saved.'))
    } finally {
      setSavingAcceptance(false)
    }
  }

  // Untouched access follows the new role silently; custom access is only replaced if the manager says so.
  const changeRole = (next: UserRole) => {
    const current = form.getFieldValue('permissions') as IdentityPermission[] | undefined
    const isDefault = roleOptions.some((option) => samePermissions(current, getRolePermissions(option.value)))
    const reset = () => form.setFieldValue('permissions', getRolePermissions(next))
    if (isDefault) {
      reset()
      return
    }
    modal.confirm({
      title: t('Reset access permissions?'),
      content: t('This person has custom access permissions. Reset them to the defaults for {role}, or keep their custom access?', undefined, { role: roleLabel(next) }),
      okText: t('Reset to defaults'),
      cancelText: t('Keep custom access'),
      onOk: reset,
    })
  }

  const load = async () => {
    if (!user) return
    try {
      setLoading(true)
      setStaff(await listOperationsStaff(user))
    } catch {
      message.error(t('operations.staff.loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const missingAreas = (row: ManagedUser) => row.role === USER_ROLES.CONSULTANT && row.status === 'active' && !areasFor(workSettings, row.id).length

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    // The signed-in manager is listed too (other admins see them), pinned first and marked "You".
    return staff.filter((row) => {
      if (missingAreasOnly && !missingAreas(row)) return false
      return [row.name, row.email, roleLabel(row.role), row.phone, ...areasFor(workSettings, row.id)].join(' ').toLowerCase().includes(query)
    }).sort((left, right) => Number(isSelf(right)) - Number(isSelf(left)))
  }, [search, staff, missingAreasOnly, workSettings, roleOptions, user]) // eslint-disable-line react-hooks/exhaustive-deps

  const metrics = useMemo(() => ({
    staff: staff.length,
    consultants: staff.filter((row) => row.role === USER_ROLES.CONSULTANT).length,
    projectAdmins: staff.filter((row) => row.role === USER_ROLES.PROJECT_ADMIN).length,
    missingAreas: staff.filter(missingAreas).length,
  }), [staff, workSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Worked out from the live values rather than by asking the form to validate, which raced the modal mounting
  // and left an untouched record looking incomplete. Mirrors the rules on the Details fields.
  const watched = Form.useWatch([], { form, preserve: true }) as Partial<StaffForm> | undefined
  const missingDetails = useMemo(() => {
    if (!watched) return [t('Details')]
    const missing: string[] = []
    if (!watched.role) missing.push(t('common.role'))
    if (!String(watched.name || '').trim()) missing.push(t('common.name'))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(watched.email || '').trim())) missing.push(t('common.email'))
    if (!PHONE_PATTERN.test(String(watched.phone || ''))) missing.push(t('Phone number'))
    if (!watched.phoneProvider) missing.push(t('Service provider'))
    return missing
  }, [watched, t])
  const detailsValid = missingDetails.length === 0
  const dirty = formChanged(watched || {}, formValues)

  const openModal = (record?: ManagedUser) => {
    setEditing(record)
    setFormValues(record
      ? { name: record.name, email: record.email, role: record.role, phone: record.phone || '', phoneIsWhatsApp: record.phoneIsWhatsApp === true, phoneProvider: record.phoneProvider || undefined, permissions: record.permissions || getRolePermissions(record.role), active: record.status === 'active' }
      : { name: '', email: '', role: USER_ROLES.CONSULTANT, phone: '', phoneIsWhatsApp: false, phoneProvider: undefined, permissions: getRolePermissions(USER_ROLES.CONSULTANT), active: true })
    setWorkDraft(undefined)
    setSection('details')
    setModalOpen(true)
  }

  // Editing jumps between sections; adding walks through them in order, so nothing is skipped by accident.
  const showWork = role === USER_ROLES.CONSULTANT
  const sections: Section[] = ['details', 'access', ...(showWork ? ['work' as const] : [])]
  const visibleSection: Section = sections.includes(section) ? section : 'details'
  const stepIndex = sections.indexOf(visibleSection)
  const isLastStep = stepIndex === sections.length - 1
  const sectionLabel: Record<Section, string> = { details: t('Details'), access: t('Access'), work: t('Areas and hours') }
  const panelDirection = (target: Section) => SECTION_ORDER.indexOf(target)

  const [panelFrom, setPanelFrom] = useState<Section>('details')
  const goTo = (target: Section) => {
    setPanelFrom(visibleSection)
    setSection(target)
  }
  const panelClass = `staff-modal-panel ${panelDirection(visibleSection) >= panelDirection(panelFrom) ? 'from-end' : 'from-start'}`

  const canSave = editing ? (dirty || workChanged) && detailsValid : detailsValid

  const save = async (values: StaffForm) => {
    if (!user) return
    const { active, permissions, ...details } = values
    // Role-default access is stored as "no override" (null on update) so later changes to the role's defaults still reach this person.
    const followsRole = samePermissions(permissions, getRolePermissions(values.role))
    const payload: StaffValues = {
      ...details,
      // The sign-in email is fixed once the account exists; createPlatformUser only ever creates new accounts as active.
      email: editing ? editing.email : details.email,
      status: editing && !active ? 'inactive' : 'active',
      permissions: followsRole ? (editing ? null : undefined) : permissions,
    }
    setSaving(true)
    let uid = editing?.id || ''
    try {
      if (editing) {
        if (dirty) await updateOperationsStaff(user, editing.id, payload)
      } else uid = await createOperationsStaff(user, payload)
    } catch (error) {
      message.error(staffError(error, 'operations.staff.saveError'))
      setSaving(false)
      return
    }
    // Areas and hours live in the company's work settings, so they save separately and only when changed.
    if (values.role === USER_ROLES.CONSULTANT && workChanged && workReady && uid) {
      try {
        await saveConsultantWork(user, uid, { areasOfSupport: workDraft.areas, hours: workDraft.ownHours ? workDraft.hours : null })
      } catch {
        message.warning(t('Saved, but their areas and hours could not be saved. Try again from Edit.'))
      }
    }
    message.success(t(editing ? 'operations.staff.updated' : 'operations.staff.added'))
    setSaving(false)
    setModalOpen(false)
    await load()
  }

  const setStatus = async (row: ManagedUser, status: ManagedUser['status']) => {
    if (!user) return
    const { id, ...details } = row
    try {
      await updateOperationsStaff(user, id, { ...details, status })
      message.success(t(status === 'active' ? '{name} is active again.' : '{name} has been deactivated.', undefined, { name: row.name || row.email }))
      await load()
    } catch (error) {
      message.error(staffError(error, 'operations.staff.saveError'))
    }
  }

  const remove = async (id: string) => {
    if (!user) return
    try {
      await deleteOperationsStaff(user, id)
      message.success(t('operations.staff.removed'))
      await load()
    } catch (error) {
      message.error(staffError(error, 'operations.staff.removeError'))
    }
  }

  // Deactivating is the everyday way to remove access; deleting removes the sign-in for good, so it names the person and says so.
  const rowMenu = (row: ManagedUser): MenuProps => ({
    items: [
      row.status === 'active'
        ? { key: 'deactivate', icon: <StopOutlined />, label: t('Deactivate') }
        : { key: 'reactivate', icon: <CheckCircleOutlined />, label: t('Reactivate') },
      { type: 'divider' },
      { key: 'delete', icon: <DeleteOutlined />, label: t('common.delete'), danger: true },
    ],
    onClick: ({ key }) => {
      const name = row.name || row.email
      if (key === 'reactivate') void setStatus(row, 'active')
      if (key === 'deactivate') {
        modal.confirm({
          title: t('Deactivate {name}?', undefined, { name }),
          content: t('They will not be able to sign in until you reactivate them.'),
          okText: t('Deactivate'),
          onOk: () => setStatus(row, 'inactive'),
        })
      }
      if (key === 'delete') {
        modal.confirm({
          title: t('Delete {name}?', undefined, { name }),
          content: t("This permanently deletes their sign-in and can't be undone. Deactivate them instead if they might come back."),
          okText: t('common.delete'),
          okButtonProps: { danger: true },
          onOk: () => remove(row.id),
        })
      }
    },
  })

  // Operations accounts are read-only here, their own included: updatePlatformUser and deleteUserAccount only let
  // managers change consultants and project admins (canManageProjectStaff in functions/src/index.ts).
  const rowActions = (row: ManagedUser) => row.role === USER_ROLES.OPERATIONS
    ? (
      <Tooltip title={t('Operations accounts are managed by your system administrator.')}>
        <span className="staff-row-locked" aria-label={t('Read only')}><LockOutlined /></span>
      </Tooltip>
    )
    : (
    <Space size={4} className="staff-row-actions">
      <Tooltip title={t('common.edit')}><Button icon={<EditOutlined />} aria-label={t('common.edit')} onClick={() => openModal(row)} /></Tooltip>
      {!isSelf(row) && (
        <Dropdown menu={rowMenu(row)} trigger={['click']} placement="bottomRight">
          <Button icon={<MoreOutlined />} aria-label={t('More actions')} />
        </Dropdown>
      )}
    </Space>
  )

  const statusTag = (row: ManagedUser) => <Tag color={row.status === 'active' ? 'green' : undefined}>{t(row.status === 'active' ? 'common.active' : 'common.inactive')}</Tag>

  const areasCell = (row: ManagedUser) => {
    if (row.role !== USER_ROLES.CONSULTANT || !workReady) return <Typography.Text type="secondary">—</Typography.Text>
    const areas = areasFor(workSettings, row.id)
    if (!areas.length) return <Typography.Text type="warning">{t('Not set')}</Typography.Text>
    return <Typography.Text>{areas.slice(0, 2).join(', ')}{areas.length > 2 && <Typography.Text type="secondary"> +{areas.length - 2}</Typography.Text>}</Typography.Text>
  }

  const person = (row: ManagedUser) => (
    <div className="staff-person">
      <Avatar size={36} className={row.status === 'active' ? 'is-active' : ''}>{initials(row)}</Avatar>
      <div className="staff-person-text">
        <span className="staff-person-name">
          <Typography.Text strong ellipsis>{row.name || row.email}</Typography.Text>
          {isSelf(row) && <Tag bordered={false} className="staff-you-tag">{t('You')}</Tag>}
        </span>
        <Typography.Text type="secondary" ellipsis className="staff-person-meta">
          {row.email}
          {row.phone && <> · {row.phone}{row.phoneIsWhatsApp && <WhatsAppOutlined aria-label={t('On WhatsApp')} className="staff-whatsapp" />}</>}
        </Typography.Text>
      </div>
    </div>
  )

  const columns: TableProps<ManagedUser>['columns'] = [
    { title: t('common.name'), key: 'person', render: (_, row) => person(row) },
    { title: t('common.role'), dataIndex: 'role', width: 150, render: (value: UserRole) => <Tag color={roleColor(value)}>{roleLabel(value)}</Tag> },
    { title: t('Areas of support'), key: 'areas', width: 200, responsive: ['lg'], render: (_, row) => areasCell(row) },
    { title: t('common.status'), dataIndex: 'status', width: 110, render: (_, row) => statusTag(row) },
    { title: '', key: 'actions', width: 96, align: 'right', render: (_, row) => rowActions(row) },
  ]

  const renderCard = (row: ManagedUser) => (
    <div className="staff-card">
      <div className="staff-card-head">
        {person(row)}
        {rowActions(row)}
      </div>
      <Space size={[6, 6]} wrap>
        <Tag color={roleColor(row.role)}>{roleLabel(row.role)}</Tag>
        {statusTag(row)}
      </Space>
      {row.role === USER_ROLES.CONSULTANT && <div className="staff-card-areas"><AimOutlined /> {areasCell(row)}</div>}
    </div>
  )

  const isSelfEdit = isSelf(editing)

  const modalFooter = editing
    ? (
      <div className="staff-modal-footer">
        {dirty && !detailsValid && (
          <Typography.Text type="warning" className="staff-modal-footer-note">
            {t('Add the missing details to save: {fields}.', undefined, { fields: missingDetails.join(', ') })}
            {visibleSection !== 'details' && <Button type="link" size="small" onClick={() => goTo('details')}>{t('Go to Details')}</Button>}
          </Typography.Text>
        )}
        <Button type="primary" loading={saving} disabled={!canSave} onClick={() => form.submit()}>{t('Save changes')}</Button>
      </div>
    )
    : (
      <div className="staff-modal-footer">
        {stepIndex > 0 && <Button icon={<ArrowLeftOutlined />} onClick={() => goTo(sections[stepIndex - 1])}>{t('Back')}</Button>}
        {isLastStep
          ? <Button type="primary" loading={saving} disabled={!canSave} onClick={() => form.submit()}>{t('operations.staff.add')}</Button>
          : <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" disabled={visibleSection === 'details' && !detailsValid} onClick={() => goTo(sections[stepIndex + 1])}>{t('Next')}</Button>}
      </div>
    )

  return (
    <DashboardPage className="staff-page">
      <Row gutter={[16, 16]} className="dashboard-metrics-row">
        <Col xs={12} lg={6}><DashboardMetricCard icon={<TeamOutlined />} label={t('operations.staff.members')} value={metrics.staff} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard icon={<TeamOutlined />} label={t('operations.staff.consultants')} value={metrics.consultants} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard icon={<UserSwitchOutlined />} label={t('operations.staff.projectAdmins')} value={metrics.projectAdmins} /></Col>
        <Col xs={12} lg={6}>
          <DashboardMetricCard
            icon={<AimOutlined />}
            label={t('Areas not set')}
            hint={t('Active consultants with no areas of support')}
            value={workReady ? metrics.missingAreas : '—'}
            loading={workAvailable && workStatus === 'loading'}
            active={missingAreasOnly}
            // Nothing to filter to at 0; still clickable while the filter is on, so it can be turned off.
            onClick={workReady && (metrics.missingAreas > 0 || missingAreasOnly) ? () => setMissingAreasOnly((current) => !current) : undefined}
          />
        </Col>
      </Row>
      <FilterBar
        compact
        primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search name, email, role, area or phone')} allowClear />}
        actions={<><Tooltip title={t('common.refresh')}><Button icon={<ReloadOutlined />} aria-label={t('common.refresh')} onClick={() => void load()} loading={loading} className="staff-refresh" /></Tooltip><Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>{t('operations.staff.add')}</Button></>}
      />
      {workAvailable && (
        <div className="staff-hours-strip">
          <ClockCircleOutlined aria-hidden />
          <span className="staff-hours-label">{t('Operating hours')}</span>
          <span className="staff-hours-value">
            {workStatus === 'error'
              ? workLoadError
              : !workReady ? <Skeleton.Input active size="small" /> : workSettings.operatingHours.length ? hoursSummary(workSettings.operatingHours) : <Typography.Text type="secondary">{t('Not set yet')}</Typography.Text>}
          </span>
          <Button onClick={openOperatingHours} disabled={!workReady}>{t('Edit hours')}</Button>
        </div>
      )}
      {workAvailable && (
        <div className="staff-hours-strip">
          <CheckCircleOutlined aria-hidden />
          <span className="staff-hours-value">
            <span className="staff-hours-label">{t('Consultants accept new work before it starts')}</span>
            <Typography.Text type="secondary" className="staff-hours-hint">{t('When off, work you assign to your company’s consultants starts straight away. Freelance consultants always accept, and work you assign to yourself never needs accepting.')}</Typography.Text>
          </span>
          <Switch
            checked={!!workSettings?.requireConsultantAcceptance}
            disabled={!workReady}
            loading={savingAcceptance}
            onChange={(value) => void saveAcceptance(value)}
            aria-label={t('Consultants accept new work before it starts')}
          />
        </div>
      )}
      {missingAreasOnly && (
        <div className="staff-filter-note">
          <Typography.Text type="secondary">{t('Showing active consultants with no areas of support.')}</Typography.Text>
          <Button type="link" size="small" onClick={() => setMissingAreasOnly(false)}>{t('Show everyone')}</Button>
        </div>
      )}
      <Card>
        <ResponsiveDataView rowKey="id" rows={rows} columns={columns} loading={loading} emptyText={t('operations.staff.empty')} renderCard={renderCard} />
      </Card>

      <ResponsiveModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t('Edit {name}', undefined, { name: editing.name || editing.email }) : t('operations.staff.add')}
        width={600}
        centered
        className="staff-modal"
        footer={modalFooter}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={formValues}
          onFinish={(values) => void save(values)}
          onFinishFailed={() => goTo('details')}
        >
          {editing
            ? <Segmented block value={visibleSection} onChange={(value) => goTo(value as Section)} options={sections.map((value) => ({ value, label: sectionLabel[value] }))} className="staff-modal-sections" />
            : (
              <ol className="staff-modal-steps" aria-label={t('Steps')}>
                {sections.map((value, index) => (
                  <li key={value} className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-done' : ''} aria-current={index === stepIndex ? 'step' : undefined}>
                    <span className="staff-modal-step-index">{index < stepIndex ? <CheckCircleOutlined /> : index + 1}</span>
                    <span>{sectionLabel[value]}</span>
                  </li>
                ))}
              </ol>
            )}
          {/* Every panel stays mounted so the form keeps all its fields; only the current one is shown. */}
          <div className={visibleSection === 'details' ? panelClass : 'staff-modal-panel-hidden'}>
            <Form.Item name="role" label={t('common.role')} rules={[{ required: true }]} extra={isSelfEdit ? t("You can't change your own role.") : undefined}>
              <RoleCards options={roleOptions} disabled={isSelfEdit} onChange={changeRole} />
            </Form.Item>
            <Row gutter={12}>
              <Col xs={24} md={12}><Form.Item name="name" label={t('common.name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="email" label={t('common.email')} rules={[{ required: true }, { type: 'email' }]} tooltip={editing ? t("The sign-in email can't be changed here.") : undefined}><Input disabled={Boolean(editing)} /></Form.Item></Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item name="phone" label={t('Phone number')} extra={phoneCountry ? `${t('Country')}: ${phoneCountry}` : undefined} rules={[{ required: true, message: t('Phone number is required.') }, { pattern: PHONE_PATTERN, message: t('Enter a valid phone number, including the country code.') }]}>
                  <Input placeholder={t('Include country code, e.g. +27...')} onChange={(event) => {
                    const provider = form.getFieldValue('phoneProvider')
                    if (provider && !providersForCountry(countryFromPhone(event.target.value)).includes(provider)) form.setFieldValue('phoneProvider', undefined)
                  }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="phoneProvider" label={t('Service provider')} rules={[{ required: true, message: t('Select the service provider for this phone number.') }]}>
                  <Select allowClear placeholder={t('Select provider')} options={providerOptions} />
                </Form.Item>
              </Col>
            </Row>
            {/* Settings-style rows: the whole row is the label, so tapping anywhere on it flips the switch. */}
            <div className="staff-toggle-list">
              <label className="staff-toggle">
                <WhatsAppOutlined className="staff-toggle-icon is-whatsapp" aria-hidden />
                <span className="staff-toggle-text">
                  <strong>{t('On WhatsApp')}</strong>
                  <small>{t('Gets updates and reminders on WhatsApp at this number.')}</small>
                </span>
                <Form.Item name="phoneIsWhatsApp" valuePropName="checked" noStyle><Switch /></Form.Item>
              </label>
              {editing && (
                <label className={`staff-toggle${isSelfEdit ? ' is-disabled' : ''}`}>
                  <CheckCircleOutlined className={`staff-toggle-icon${active ? ' is-active' : ''}`} aria-hidden />
                  <span className="staff-toggle-text">
                    <strong>{t('common.active')}</strong>
                    <small>{isSelfEdit ? t("You can't deactivate your own account.") : active ? t('Can sign in and use the workspace.') : t("Can't sign in until reactivated.")}</small>
                  </span>
                  <Form.Item name="active" valuePropName="checked" noStyle><Switch disabled={isSelfEdit} /></Form.Item>
                </label>
              )}
            </div>
          </div>
          <div className={visibleSection === 'access' ? panelClass : 'staff-modal-panel-hidden'}>
            <Form.Item name="permissions" label={t('permissions.featureAccess')} extra={isSelfEdit ? t("You can't change your own access. Ask another manager on your team.") : undefined}><FeaturePermissionsField disabled={isSelfEdit} /></Form.Item>
          </div>
          {visibleSection === 'work' && (
            <div className={panelClass} key="work">
              {!workAvailable
                ? <Typography.Text type="secondary">{t("Your profile has no company, so areas and hours can't be set.")}</Typography.Text>
                : workStatus === 'error'
                  ? workLoadError
                  : !workReady
                    ? <Skeleton active paragraph={{ rows: 4 }} />
                    : (
                      <>
                        <Form.Item label={t('Areas of support')} extra={companyAreas.length ? t('Interventions in these areas list this consultant first when assigning.') : t('Your interventions have no areas of support yet. Add them when setting up interventions.')}>
                          <Select mode="multiple" allowClear value={work.areas} placeholder={t('Choose areas')} options={companyAreas.map((area) => ({ value: area, label: area }))} onChange={(areas) => updateWork({ areas })} />
                        </Form.Item>
                        <Form.Item label={t('Working hours')}>
                          <Segmented
                            value={work.ownHours ? 'own' : 'company'}
                            onChange={(value) => updateWork({ ownHours: value === 'own', hours: value === 'own' && !work.hours.length ? workSettings.operatingHours : work.hours })}
                            options={[{ value: 'company', label: t('Company hours') }, { value: 'own', label: t('Own hours') }]}
                          />
                        </Form.Item>
                        {work.ownHours
                          ? <WeekHoursEditor value={work.hours} onChange={(hours) => updateWork({ hours })} />
                          : <Typography.Text type="secondary">{workSettings.operatingHours.length ? `${t('Works the company’s operating hours.')} ${hoursSummary(workSettings.operatingHours)}` : t('No company operating hours are set yet.')}</Typography.Text>}
                      </>
                    )}
            </div>
          )}
        </Form>
      </ResponsiveModal>

      <ResponsiveModal
        open={hoursOpen}
        onClose={() => setHoursOpen(false)}
        title={t('Operating hours')}
        width={520}
        centered
        footer={<div className="staff-modal-footer"><Button type="primary" loading={savingHours} disabled={!workReady || hoursDraft === undefined} onClick={() => void saveHours()}>{t('Save')}</Button></div>}
      >
        <Typography.Paragraph type="secondary">{t('The hours your consultants work, unless you give one of them their own. Appointments booked outside them show a warning.')}</Typography.Paragraph>
        {workStatus === 'error' ? workLoadError : workReady ? <WeekHoursEditor value={operatingHours} onChange={setHoursDraft} /> : <Skeleton active paragraph={{ rows: 5 }} />}
      </ResponsiveModal>
    </DashboardPage>
  )
}
