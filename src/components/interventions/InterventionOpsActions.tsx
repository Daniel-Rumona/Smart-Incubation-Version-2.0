import { useEffect, useState } from 'react'
import { App, Alert, Button, Card, Input, Modal, Radio, Select, Space, Typography, Upload } from 'antd'
import { CheckCircleOutlined, InboxOutlined, SwapOutlined, UserSwitchOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { hasRolePermission } from '@/config/permissions'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
  completeInterventionWithEvidence,
  listReassignCandidates,
  reassignIntervention,
  takeOverIntervention,
  type ReassignCandidate,
  type ReassignMode,
} from '@/services/interventionOverrideService'

const { Text } = Typography

const MAX_FILES = 5
const MAX_FILE_BYTES = 10 * 1024 * 1024

type Props = {
  assignment: { id: string, companyCode?: string | null, assigneeId?: string, assigneeName?: string }
  title: string
  participantName: string
  isCompleted: boolean
  /** Called after any successful action so the page can reload its data and close its own modal. */
  onChanged: () => void
}

type ActiveModal = 'takeover' | 'reassign' | 'complete' | null

/** Operations' take over / reassign / complete-with-evidence controls for one assigned intervention. */
export const InterventionOpsActions = ({ assignment, title, participantName, isCompleted, onChanged }: Props) => {
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const [active, setActive] = useState<ActiveModal>(null)
  const [saving, setSaving] = useState(false)
  const [candidates, setCandidates] = useState<ReassignCandidate[]>([])
  const [candidateId, setCandidateId] = useState<string>()
  const [mode, setMode] = useState<ReassignMode>('continue')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [files, setFiles] = useState<UploadFile[]>([])

  const allowed = !!user && hasRolePermission(user.role, 'assign_interventions', user.permissions)
  const isMine = !!user && assignment.assigneeId === user.uid

  useEffect(() => {
    if (active !== 'reassign' || !user) return
    void listReassignCandidates(user, assignment.assigneeId).then(setCandidates).catch(() => setCandidates([]))
  }, [active, assignment.assigneeId, user])

  if (!allowed || !user) return null

  const close = () => {
    setActive(null)
    setCandidateId(undefined)
    setMode('continue')
    setNote('')
    setReason('')
    setFiles([])
  }

  const run = async (action: () => Promise<void>, success: string) => {
    try {
      setSaving(true)
      await action()
      message.success(success)
      close()
      onChanged()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'That could not be completed.')
    } finally {
      setSaving(false)
    }
  }

  const selectedCandidate = candidates.find((candidate) => candidate.id === candidateId)

  return (
    <>
      <Card size="small" title="Operations actions" extra={<Text type="secondary">Recorded in the intervention's history</Text>}>
        <Space wrap>
          <Button icon={<UserSwitchOutlined />} disabled={isCompleted || isMine} onClick={() => setActive('takeover')}>Take over</Button>
          <Button icon={<SwapOutlined />} disabled={isCompleted} onClick={() => setActive('reassign')}>Reassign</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} disabled={isCompleted} onClick={() => setActive('complete')}>Complete</Button>
        </Space>
        {isCompleted && <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>This intervention is already completed.</Text>}
      </Card>

      <Modal
        open={active === 'takeover'}
        title="Take over this intervention"
        onCancel={close}
        okText="Take over"
        confirmLoading={saving}
        onOk={() => void run(() => takeOverIntervention(user, assignment, note), 'You are now the assignee.')}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text><strong>{title}</strong> for {participantName} will be reassigned from <strong>{assignment.assigneeName || 'the current assignee'}</strong> to you. Progress and upcoming appointments are kept as they are.</Text>
          <Input.TextArea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why are you taking this over? (optional)" maxLength={500} showCount />
        </Space>
      </Modal>

      <Modal
        open={active === 'reassign'}
        title="Reassign to another consultant"
        onCancel={close}
        okText="Reassign"
        okButtonProps={{ disabled: !selectedCandidate }}
        confirmLoading={saving}
        onOk={() => selectedCandidate && void run(() => reassignIntervention(user, assignment, selectedCandidate, mode, note), `Reassigned to ${selectedCandidate.name}.`)}
        destroyOnClose
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>New consultant</Text>
            <Select
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              placeholder="Select a consultant"
              value={candidateId}
              onChange={setCandidateId}
              options={candidates.map((candidate) => ({ value: candidate.id, label: `${candidate.name}${candidate.email ? ` (${candidate.email})` : ''}` }))}
              notFoundContent="No other consultants in this company"
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>How should the new consultant start?</Text>
            <Radio.Group value={mode} onChange={(event) => setMode(event.target.value as ReassignMode)} style={{ width: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Radio value="continue"><strong>Continue where it is</strong><br /><Text type="secondary">Keeps the current progress. Upcoming appointments move to the new consultant.</Text></Radio>
                <Radio value="restart"><strong>Start anew</strong><br /><Text type="secondary">Resets progress to zero and cancels upcoming appointments, so new ones are scheduled. Appointments already held stay on record.</Text></Radio>
              </Space>
            </Radio.Group>
          </div>
          {mode === 'restart' && <Alert type="warning" showIcon message="Progress recorded so far will be reset for this intervention." />}
          <Input.TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reason for reassigning (optional)" maxLength={500} showCount />
        </Space>
      </Modal>

      <Modal
        open={active === 'complete'}
        title="Complete this intervention"
        onCancel={close}
        okText="Mark as completed"
        okButtonProps={{ disabled: reason.trim().length < 10 || !files.length }}
        confirmLoading={saving}
        onOk={() => void run(() => completeInterventionWithEvidence(user, assignment, { reason, files: files.map((file) => file.originFileObj as File).filter(Boolean) }), 'Intervention completed.')}
        destroyOnClose
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Text type="secondary">Closes <strong>{title}</strong> for {participantName} as done, regardless of progress. A reason and proof of evidence (POE) are required.</Text>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>Reason for completing</Text>
            <Input.TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this intervention is being completed (at least 10 characters)" maxLength={1000} showCount />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>Proof of evidence (POE)</Text>
            <Upload.Dragger
              multiple
              fileList={files}
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
              beforeUpload={(file) => {
                if (file.size > MAX_FILE_BYTES) {
                  message.error(`${file.name} is larger than 10 MB.`)
                  return Upload.LIST_IGNORE
                }
                setFiles((current) => (current.length >= MAX_FILES ? current : [...current, { uid: file.uid, name: file.name, size: file.size, type: file.type, originFileObj: file } as UploadFile]))
                return false
              }}
              onRemove={(file) => setFiles((current) => current.filter((item) => item.uid !== file.uid))}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">Click or drag files here</p>
              <p className="ant-upload-hint">PDF, images or Office documents, up to {MAX_FILES} files of 10 MB each.</p>
            </Upload.Dragger>
          </div>
        </Space>
      </Modal>
    </>
  )
}

export default InterventionOpsActions
