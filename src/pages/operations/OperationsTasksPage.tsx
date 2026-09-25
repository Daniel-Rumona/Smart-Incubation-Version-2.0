import { useEffect, useMemo, useState } from 'react'
import { App, Badge, Button, Card, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, Modal, Row, Segmented, Select, Space, Table, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { AppstoreOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, EditOutlined, InboxOutlined, PlusOutlined, TableOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { getFirebaseDb } from '@/config/firebase'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { createOperationsTask, subscribeOperationsTasks, updateOperationsTask, type OperationsTask, type OperationsTaskInput, type OperationsTaskPriority, type OperationsTaskRecurrenceFrequency, type OperationsTaskStatus } from '@/services/operationsTasksService'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text, Paragraph } = Typography
type TaskForm = { title: string; description?: string; status: OperationsTaskStatus; priority: OperationsTaskPriority; startAt?: Dayjs; dueAt?: Dayjs; assigneeIds?: string[]; interventionId?: string; recurrence?: 'none' | OperationsTaskRecurrenceFrequency; recurrenceUntil?: Dayjs }
type StaffOption = { value: string; label: string }
type InterventionOption = { value: string; label: string }

const interventionLabel = (data: Record<string, unknown>) => {
  const label = data.interventionTitle || data.title || data.name || data.label
  if (typeof label === 'string' && label.trim()) return label.trim()
  const area = typeof data.areaOfSupport === 'string' ? data.areaOfSupport.trim() : ''
  return area ? `${area} intervention` : 'Unnamed intervention'
}

const statusMeta: Record<OperationsTaskStatus, { label: string; color: string }> = {
  todo: { get label() { return tr('To Do') }, color: 'default' }, in_progress: { get label() { return tr('In Progress') }, color: 'processing' }, done: { get label() { return tr('Done') }, color: 'success' }, cancelled: { get label() { return tr('Cancelled') }, color: 'error' },
}
const priorityMeta: Record<OperationsTaskPriority, { label: string; color: string }> = {
  low: { get label() { return tr('Low') }, color: 'green' }, medium: { get label() { return tr('Medium') }, color: 'blue' }, high: { get label() { return tr('High') }, color: 'orange' }, urgent: { get label() { return tr('Urgent') }, color: 'red' },
}
const toDate = (value: unknown) => value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() as Date : value ? new Date(value as string) : null
const isOverdue = (task: OperationsTask) => task.status !== 'done' && task.status !== 'cancelled' && !!toDate(task.dueAt) && toDate(task.dueAt)!.getTime() < Date.now()
const deadline = (task: OperationsTask) => {
  const due = toDate(task.dueAt)
  if (!due) return 'No due date'
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000)
  return days < 0 ? `Overdue by ${Math.abs(days)}d` : days === 0 ? 'Due today' : `Due in ${days}d`
}

export const OperationsTasksPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const { activeProgramId, isAllPrograms } = useActiveProgramId()
  const [tasks, setTasks] = useState<OperationsTask[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'table'>('board')
  const [status, setStatus] = useState<OperationsTaskStatus | 'overdue' | 'all'>('all')
  const [priority, setPriority] = useState<OperationsTaskPriority | 'all'>('all')
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [interventions, setInterventions] = useState<InterventionOption[]>([])
  const [editing, setEditing] = useState<OperationsTask | null>(null)
  const [selected, setSelected] = useState<OperationsTask | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [taskFormStep, setTaskFormStep] = useState(0)
  const [assignmentMode, setAssignmentMode] = useState<'self' | 'team'>('self')
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<TaskForm>()
  const [taskDraft, setTaskDraft] = useState<Partial<TaskForm>>({})

  useEffect(() => {
    if (!user?.companyCode) { setTasks([]); setLoading(false); return }
    setLoading(true)
    return subscribeOperationsTasks(user, (rows) => { setTasks(rows); setLoading(false) }, () => { message.error(t('Tasks could not be loaded.')); setLoading(false) })
  }, [message, user, t])

  useEffect(() => {
    if (!user?.companyCode) return
    let active = true
    const loadOptions = async () => {
      try {
        const db = getFirebaseDb()
        const [users, interventionRows] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('companyCode', '==', user.companyCode))),
          getDocs(query(collection(db, 'interventions'), where('companyCode', '==', user.companyCode))),
        ])
        if (!active) return
        setStaff(users.docs.filter((row) => ['operations', 'projectadmin', 'projectmanager', 'consultant'].includes(String(row.data().role || ''))).map((row) => ({ value: row.id, label: String(row.data().name || row.data().displayName || row.data().email || row.id) })))
        setInterventions(interventionRows.docs.map((row) => ({ value: row.id, label: interventionLabel(row.data() as Record<string, unknown>) })).sort((left, right) => left.label.localeCompare(right.label)))
      } catch { if (active) message.warning(t('Task links and assignee options could not be loaded.')) }
    }
    void loadOptions()
    return () => { active = false }
  }, [message, user?.companyCode, t])

  const scopeTasks = useMemo(() => isAllPrograms ? tasks : tasks.filter((task) => task.programId === activeProgramId), [activeProgramId, isAllPrograms, tasks])
  const activeScopeTasks = useMemo(() => scopeTasks.filter((task) => !task.archived), [scopeTasks])
  const counts = useMemo(() => ({ todo: activeScopeTasks.filter((task) => task.status === 'todo' && !isOverdue(task)).length, in_progress: activeScopeTasks.filter((task) => task.status === 'in_progress' && !isOverdue(task)).length, done: activeScopeTasks.filter((task) => task.status === 'done').length, overdue: activeScopeTasks.filter(isOverdue).length }), [activeScopeTasks])
  const filtered = useMemo(() => scopeTasks.filter((task) => {
    const taskDate = toDate(task.dueAt)
    const matchingStatus = status === 'all' || status === 'overdue' ? status !== 'overdue' || isOverdue(task) : task.status === status && !isOverdue(task)
    const matchingPriority = priority === 'all' || task.priority === priority
    const matchingSearch = !search.trim() || `${task.title} ${task.description || ''}`.toLowerCase().includes(search.trim().toLowerCase())
    const matchingRange = !range || (!!taskDate && taskDate >= range[0].startOf('day').toDate() && taskDate <= range[1].endOf('day').toDate())
    return matchingStatus && matchingPriority && matchingSearch && matchingRange && !task.archived
  }), [priority, range, scopeTasks, search, status])

  const buckets = useMemo(() => ({ todo: filtered.filter((task) => task.status === 'todo' && !isOverdue(task)), in_progress: filtered.filter((task) => task.status === 'in_progress' && !isOverdue(task)), done: filtered.filter((task) => task.status === 'done'), cancelled: filtered.filter((task) => task.status === 'cancelled'), overdue: filtered.filter(isOverdue) }), [filtered])
  const boardLanes = useMemo(() => {
    if (status === 'all') return [
      ['todo', 'To Do', 'default'],
      ['in_progress', 'In Progress', 'processing'],
      ['done', 'Done', 'success'],
      ['overdue', 'Overdue', 'error'],
    ] as const
    if (status === 'overdue') return [['overdue', 'Overdue', 'error']] as const
    return [[status, statusMeta[status].label, statusMeta[status].color]] as const
  }, [status])
  const assigneeNames = (task: OperationsTask) => task.assigneeIds.map((id) => staff.find((person) => person.value === id)?.label || 'Team member')

  const openEditor = (task?: OperationsTask) => {
    setEditing(task || null)
    setTaskFormStep(0)
    setAssignmentMode(task?.assigneeIds.includes(user?.uid || '') ? 'self' : 'team')
    const initialValues = task ? { ...task, interventionId: task.interventionId || undefined, startAt: toDate(task.startAt) ? dayjs(toDate(task.startAt)) : undefined, dueAt: toDate(task.dueAt) ? dayjs(toDate(task.dueAt)) : undefined, recurrence: 'none' as const } : { status: 'todo' as const, priority: 'medium' as const, assigneeIds: user?.uid ? [user.uid] : [], recurrence: 'none' as const }
    setTaskDraft(initialValues)
    form.setFieldsValue(initialValues)
    setModalOpen(true)
  }
  const save = async (values: TaskForm) => {
    if (!user) return
    const completeValues = { ...taskDraft, ...values } as TaskForm
    if (!completeValues.title?.trim()) {
      message.error(t('Enter a task title before creating the task.'))
      setTaskFormStep(0)
      return
    }
    const { recurrence = 'none', recurrenceUntil, ...taskValues } = completeValues
    const payload: OperationsTaskInput = { ...taskValues, title: completeValues.title.trim(), programId: isAllPrograms ? null : activeProgramId, interventionId: completeValues.interventionId || null, assigneeIds: completeValues.assigneeIds || [], ...(completeValues.startAt ? { startAt: completeValues.startAt.toDate() } : {}), ...(completeValues.dueAt ? { dueAt: completeValues.dueAt.toDate() } : {}), ...(recurrence !== 'none' && recurrenceUntil ? { recurrence: { frequency: recurrence, endsAt: recurrenceUntil.endOf('day').toDate() } } : {}) }
    try {
      setSaving(true)
      if (editing) await updateOperationsTask(user, editing.id, payload)
      else {
        const created = await createOperationsTask(user, payload)
        message.success(created > 1 ? `${created} recurring tasks created` : t('Task created'))
      }
      if (editing) message.success(t('Task updated'))
      setModalOpen(false)
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || '')
      const detail = error instanceof Error ? error.message : 'unknown error'
      if (code === 'permission-denied' || /insufficient permissions|permission-denied/i.test(detail)) {
        message.error(t('Task could not be saved: Firestore does not yet allow access to operationsTasks.'))
      } else {
        message.error(`Task could not be saved: ${detail}`)
      }
    } finally { setSaving(false) }
  }
  const continueTaskForm = async () => {
    const fields = taskFormStep === 0
      ? ['title']
      : taskFormStep === 2
        ? ['priority', 'status', ...(form.getFieldValue('recurrence') !== 'none' ? ['dueAt', 'recurrenceUntil'] : [])]
        : []
    try {
      if (fields.length) await form.validateFields(fields)
      setTaskFormStep((step) => step + 1)
    } catch {
      // Ant Design renders the field-level validation message.
    }
  }
  const setTaskStatus = async (task: OperationsTask, nextStatus: OperationsTaskStatus) => { if (!user) return; try { await updateOperationsTask(user, task.id, { status: nextStatus }); message.success(nextStatus === 'done' ? t('Task marked complete') : t('Task status updated')) } catch { message.error(t('The task could not be updated.')) } }

  const taskCard = (task: OperationsTask) => <Card key={task.id} size="small" hoverable onClick={() => setSelected(task)} styles={{ body: { padding: 14 } }}>
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}><Tag color={priorityMeta[task.priority].color}>{priorityMeta[task.priority].label}</Tag>{isOverdue(task) ? <Text type="danger"><WarningOutlined /> {deadline(task)}</Text> : <Text type="secondary"><CalendarOutlined /> {deadline(task)}</Text>}</Space>
      <Text strong>{task.title}</Text>
      {task.description ? <Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ margin: 0 }}>{task.description}</Paragraph> : null}
      <Space size={4} wrap>{assigneeNames(task).slice(0, 2).map((name) => <Tag key={name} icon={<TeamOutlined />}>{name}</Tag>)}{task.assigneeIds.length > 2 ? <Tag>+{task.assigneeIds.length - 2}</Tag> : null}</Space>
    </Space>
  </Card>
  const columns: TableProps<OperationsTask>['columns'] = [
    { title: t('Task'), dataIndex: 'title', render: (_, task) => <Space direction="vertical" size={0}><Text strong>{task.title}</Text><Text type="secondary" ellipsis style={{ maxWidth: 300 }}>{task.description || t('No description')}</Text></Space> },
    { title: t('Workflow'), render: (_, task) => <Space direction="vertical" size={4}><Tag color={statusMeta[task.status].color}>{statusMeta[task.status].label}</Tag><Tag color={priorityMeta[task.priority].color}>{priorityMeta[task.priority].label}</Tag></Space> },
    { title: t('Schedule'), render: (_, task) => <Text type={isOverdue(task) ? 'danger' : undefined}>{deadline(task)}</Text> },
    { title: t('Assignees'), render: (_, task) => assigneeNames(task).length ? <Space wrap>{assigneeNames(task).map((name) => <Tag key={name}>{name}</Tag>)}</Space> : <Text type="secondary">{t('Unassigned')}</Text> },
    { title: t('Actions'), render: (_, task) => <Space><Tooltip title={t('View task')}><Button size="small" onClick={() => setSelected(task)}>{t('View')}</Button></Tooltip><Button size="small" icon={<EditOutlined />} onClick={() => openEditor(task)} /></Space> },
  ]

  return <DashboardPage>
    <Row gutter={[16, 16]} className="dashboard-metrics-row">
      <Col xs={12} lg={6}><DashboardMetricCard icon={<InboxOutlined />} label={t('To Do')} value={counts.todo} /></Col>
      <Col xs={12} lg={6}><DashboardMetricCard icon={<ClockCircleOutlined />} label={t('In Progress')} value={counts.in_progress} /></Col>
      <Col xs={12} lg={6}><DashboardMetricCard icon={<WarningOutlined />} label={t('Overdue')} value={counts.overdue} /></Col>
      <Col xs={12} lg={6}><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('Completed')} value={counts.done} /></Col>
    </Row>
    <FilterBar primary={<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', width: '100%', minWidth: 0, overflowX: 'auto', paddingBottom: 1 }}><Segmented value={view} onChange={(value) => setView(value as 'board' | 'table')} options={[{ value: 'board', icon: <AppstoreOutlined /> }, { value: 'table', icon: <TableOutlined /> }]} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search tasks')} allowClear style={{ width: 210, flex: '1 1 210px', minWidth: 160 }} /><Select value={status} onChange={setStatus} style={{ width: 150, flexShrink: 0 }} options={[{ value: 'all', label: t('All statuses') }, { value: 'overdue', label: `Overdue (${counts.overdue})` }, ...Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))]} /><Select value={priority} onChange={setPriority} style={{ width: 140, flexShrink: 0 }} options={[{ value: 'all', label: t('All priorities') }, ...Object.entries(priorityMeta).map(([value, meta]) => ({ value, label: meta.label }))]} /><DatePicker.RangePicker value={range} onChange={(value) => setRange(value as [Dayjs, Dayjs] | null)} style={{ width: 240, flexShrink: 0 }} /><Space size={8} style={{ marginLeft: 'auto', flexShrink: 0 }}><Button onClick={() => { setSearch(''); setStatus('all'); setPriority('all'); setRange(null) }}>{t('Clear')}</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t('New task')}</Button></Space></div>} />
    {view === 'table' ? <Card><Table rowKey="id" loading={loading} dataSource={filtered} columns={columns} pagination={{ pageSize: 8, position: ['bottomCenter'], showSizeChanger: false }} locale={{ emptyText: <Empty description={t('No tasks in this view')} /> }} scroll={{ x: 800 }} /></Card> : <Row gutter={[16, 16]}>{boardLanes.map(([key, label, color]) => <Col xs={24} md={boardLanes.length === 1 ? 24 : 12} xl={boardLanes.length === 1 ? 24 : 6} key={key}><Card title={<Space><Badge color={color} />{label}<Text type="secondary">({buckets[key].length})</Text></Space>} styles={{ body: { maxHeight: 'min(62vh, 640px)', overflowY: 'auto' } }}><Space direction="vertical" size={10} style={{ width: '100%' }}>{buckets[key].length ? buckets[key].map(taskCard) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No tasks')} />}</Space></Card></Col>)}</Row>}
    <Drawer open={!!selected} title={t('Task details')} width={520} onClose={() => setSelected(null)} extra={selected ? <Button icon={<EditOutlined />} onClick={() => { const task = selected; setSelected(null); openEditor(task) }}>{t('Edit')}</Button> : null}>{selected ? <Space direction="vertical" size={20} style={{ width: '100%' }}><Space wrap><Tag color={statusMeta[selected.status].color}>{statusMeta[selected.status].label}</Tag><Tag color={priorityMeta[selected.priority].color}>{priorityMeta[selected.priority].label}</Tag>{isOverdue(selected) ? <Tag color="error">{t('Overdue')}</Tag> : null}</Space><div><Text strong style={{ fontSize: 20 }}>{selected.title}</Text><Paragraph style={{ marginTop: 8 }}>{selected.description || t('No description provided.')}</Paragraph></div><Descriptions column={1} size="small" items={[{ key: 'due', label: t('Schedule'), children: deadline(selected) }, { key: 'assignees', label: t('Assignees'), children: assigneeNames(selected).join(', ') || 'Unassigned' }, { key: 'intervention', label: t('Intervention'), children: selected.interventionId ? interventions.find((item) => item.value === selected.interventionId)?.label || 'Linked intervention is unavailable' : 'Not linked' }]} />{selected.status !== 'done' && selected.status !== 'cancelled' ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void setTaskStatus(selected, 'done')}>{t('Mark complete')}</Button> : null}</Space> : null}</Drawer>
    <Modal open={modalOpen} title={editing ? t('Edit task') : t('New task')} onCancel={() => setModalOpen(false)} footer={null} destroyOnClose maskClosable={false} width={editing ? 680 : 760}>
      <Form form={form} layout="vertical" preserve onValuesChange={(_, values) => setTaskDraft(values)} onFinish={(values) => void save(values)}>
        {!editing ? <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 8 }}>{t('Step')} {taskFormStep + 1} {t('of 4')}</Text> : null}
        {!editing && taskFormStep === 0 ? <div><Text strong style={{ display: 'block', fontSize: 21, textAlign: 'center', marginBottom: 24 }}>{t('What needs to be done?')}</Text><Form.Item name="title" label={t('Task title')} rules={[{ required: true, message: tr('Enter a task title') }]}><Input autoFocus /></Form.Item><Form.Item name="description" label={t('Description')}><Input.TextArea rows={4} /></Form.Item></div> : null}
        {!editing && taskFormStep === 1 ? <div><Text strong style={{ display: 'block', fontSize: 21, textAlign: 'center', marginBottom: 24 }}>{t('Who should own this task?')}</Text><Row gutter={12}><Col xs={24} sm={12}><Card hoverable onClick={() => { setAssignmentMode('self'); form.setFieldValue('assigneeIds', user?.uid ? [user.uid] : []) }} style={{ borderColor: assignmentMode === 'self' ? '#6d5dfb' : undefined, height: '100%' }}><Space direction="vertical"><TeamOutlined /><Text strong>{t('Myself')}</Text><Text type="secondary">{t('Assign this task to me.')}</Text></Space></Card></Col><Col xs={24} sm={12}><Card hoverable onClick={() => { setAssignmentMode('team'); form.setFieldValue('assigneeIds', []) }} style={{ borderColor: assignmentMode === 'team' ? '#6d5dfb' : undefined, height: '100%' }}><Space direction="vertical"><TeamOutlined /><Text strong>{t('Team member')}</Text><Text type="secondary">{t('Assign one or more colleagues.')}</Text></Space></Card></Col></Row>{assignmentMode === 'team' ? <Form.Item name="assigneeIds" label={t('Team members')} style={{ marginTop: 18 }}><Select mode="multiple" options={staff} placeholder={t('Select team members')} /></Form.Item> : <Text type="secondary" style={{ display: 'block', marginTop: 18 }}>{t('This task will be assigned to')} {user?.displayName || user?.name || 'you'}.</Text>}<Form.Item name="interventionId" label={t('Linked intervention')} style={{ marginTop: 18 }}><Select allowClear options={interventions} placeholder={t('Optional')} /></Form.Item></div> : null}
        {!editing && taskFormStep === 2 ? <div><Text strong style={{ display: 'block', fontSize: 21, textAlign: 'center', marginBottom: 24 }}>{t('How should the work be scheduled?')}</Text><Row gutter={12}><Col span={12}><Form.Item name="priority" label={t('Priority')} rules={[{ required: true }]}><Select options={Object.entries(priorityMeta).map(([value, meta]) => ({ value, label: meta.label }))} /></Form.Item></Col><Col span={12}><Form.Item name="status" label={t('Status')} rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} /></Form.Item></Col></Row><Row gutter={12}><Col span={12}><Form.Item name="startAt" label={t('Start date')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item name="dueAt" label={t('Due date')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col></Row><Row gutter={12}><Col span={12}><Form.Item name="recurrence" label={t('Repeat')}><Select options={[{ value: 'none', label: t('Does not repeat') }, { value: 'daily', label: t('Daily') }, { value: 'weekly', label: t('Weekly') }, { value: 'monthly', label: t('Monthly') }]} /></Form.Item></Col><Col span={12}><Form.Item noStyle shouldUpdate={(previous, current) => previous.recurrence !== current.recurrence}>{({ getFieldValue }) => getFieldValue('recurrence') !== 'none' ? <Form.Item name="recurrenceUntil" label={t('Repeat until')} rules={[{ required: true, message: tr('Choose when the series ends') }]}><DatePicker style={{ width: '100%' }} /></Form.Item> : null}</Form.Item></Col></Row></div> : null}
        {!editing && taskFormStep === 3 ? <div><Text strong style={{ display: 'block', fontSize: 21, textAlign: 'center', marginBottom: 24 }}>{t('Does everything look right?')}</Text><Descriptions column={1} bordered size="small" items={[{ key: 'title', label: t('Task'), children: form.getFieldValue('title') || 'Not set' }, { key: 'assignment', label: t('Assignees'), children: (form.getFieldValue('assigneeIds') || []).map((id: string) => staff.find((item) => item.value === id)?.label || id).join(', ') || 'Unassigned' }, { key: 'workflow', label: t('Workflow'), children: `${priorityMeta[(form.getFieldValue('priority') || 'medium') as OperationsTaskPriority].label} · ${statusMeta[(form.getFieldValue('status') || 'todo') as OperationsTaskStatus].label}` }, { key: 'schedule', label: t('Schedule'), children: `${form.getFieldValue('dueAt') ? dayjs(form.getFieldValue('dueAt')).format('DD MMM YYYY') : 'No due date'}${form.getFieldValue('recurrence') && form.getFieldValue('recurrence') !== 'none' ? ` · Repeats ${form.getFieldValue('recurrence')} until ${dayjs(form.getFieldValue('recurrenceUntil')).format('DD MMM YYYY')}` : ''}` }]} /></div> : null}
        {editing ? <><Form.Item name="title" label={t('Task title')} rules={[{ required: true, message: tr('Enter a task title') }]}><Input autoFocus /></Form.Item><Form.Item name="description" label={t('Description')}><Input.TextArea rows={3} /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="priority" label={t('Priority')} rules={[{ required: true }]}><Select options={Object.entries(priorityMeta).map(([value, meta]) => ({ value, label: meta.label }))} /></Form.Item></Col><Col span={12}><Form.Item name="status" label={t('Status')} rules={[{ required: true }]}><Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} /></Form.Item></Col></Row><Row gutter={12}><Col span={12}><Form.Item name="startAt" label={t('Start date')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item name="dueAt" label={t('Due date')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col></Row><Form.Item name="assigneeIds" label={t('Assignees')}><Select mode="multiple" options={staff} placeholder={t('Assign team members')} /></Form.Item><Form.Item name="interventionId" label={t('Linked intervention')}><Select allowClear options={interventions} placeholder={t('Optional')} /></Form.Item></> : null}
        <Space style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}><Button htmlType="button" onClick={() => taskFormStep === 0 || editing ? setModalOpen(false) : setTaskFormStep((step) => step - 1)}>{taskFormStep === 0 || editing ? t('Cancel') : t('Back')}</Button>{editing ? <Button type="primary" htmlType="submit" loading={saving}>{t('Save changes')}</Button> : taskFormStep === 3 ? <Button type="primary" htmlType="submit" loading={saving}>{t('Create task')}</Button> : <Button htmlType="button" type="primary" onClick={() => void continueTaskForm()}>{t('Continue')}</Button>}</Space>
      </Form>
    </Modal>
  </DashboardPage>
}
