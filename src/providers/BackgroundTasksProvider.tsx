import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { sendAgentMessage } from '@/services/agentService'
import type { AgentChatMessage, AgentPageContext, AgentProposal } from '@/types/agent'

export type BackgroundTaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export type BackgroundAgentTask = {
  id: string
  title: string
  prompt: string
  status: BackgroundTaskStatus
  progress: number
  statusMessage: string
  result?: string
  error?: string
  createdAt: string
  updatedAt: string
}

type QueueTaskInput = {
  title?: string
  prompt: string
  page: AgentPageContext
  history: AgentChatMessage[]
  onCompleted?: (result: string, proposal?: AgentProposal | null) => void
  onFailed?: (error: string) => void
}

type BackgroundTasksContextValue = {
  tasks: BackgroundAgentTask[]
  queueTask: (input: QueueTaskInput) => string
  dismissTask: (taskId: string) => void
  clearFinished: () => void
}

const STORAGE_KEY = 'smart-incubation-background-agent-tasks'
const BackgroundTasksContext = createContext<BackgroundTasksContextValue | undefined>(undefined)

const loadStoredTasks = (): BackgroundAgentTask[] => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') as BackgroundAgentTask[]
    const now = new Date().toISOString()
    return stored.slice(0, 20).map((task) => ['queued', 'running'].includes(task.status)
      ? { ...task, status: 'failed', progress: 100, statusMessage: 'Interrupted when the workspace closed', error: 'This task did not finish before the previous session ended.', updatedAt: now }
      : task)
  } catch {
    return []
  }
}

const taskTitle = (prompt: string) => {
  const clean = prompt.trim().replace(/\s+/g, ' ')
  return clean.length > 54 ? `${clean.slice(0, 54)}…` : clean
}

export const BackgroundTasksProvider = ({ children }: PropsWithChildren) => {
  const [tasks, setTasks] = useState<BackgroundAgentTask[]>(loadStoredTasks)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, 20)))
  }, [tasks])

  const updateTask = useCallback((taskId: string, update: Partial<BackgroundAgentTask>) => {
    setTasks((current) => current.map((task) => task.id === taskId
      ? { ...task, ...update, updatedAt: new Date().toISOString() }
      : task))
  }, [])

  const queueTask = useCallback((input: QueueTaskInput) => {
    const id = `agent-task-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const now = new Date().toISOString()
    const task: BackgroundAgentTask = {
      id,
      title: input.title?.trim() || taskTitle(input.prompt),
      prompt: input.prompt.trim(),
      status: 'queued',
      progress: 8,
      statusMessage: 'Queued for the workspace agent',
      createdAt: now,
      updatedAt: now,
    }
    setTasks((current) => [task, ...current].slice(0, 20))

    window.setTimeout(() => {
      updateTask(id, { status: 'running', progress: 18, statusMessage: 'Reviewing workspace context' })
      const progressTimer = window.setInterval(() => {
        setTasks((current) => current.map((item) => {
          if (item.id !== id || item.status !== 'running') return item
          const progress = Math.min(88, item.progress + Math.max(3, Math.round((90 - item.progress) / 5)))
          const statusMessage = progress < 45
            ? 'Reviewing workspace context'
            : progress < 72
              ? 'Working through the request'
              : 'Preparing the result'
          return { ...item, progress, statusMessage, updatedAt: new Date().toISOString() }
        }))
      }, 900)

      void sendAgentMessage({ message: input.prompt, page: input.page, history: input.history })
        .then((response) => {
          updateTask(id, {
            status: 'completed',
            progress: 100,
            statusMessage: 'Completed',
            result: response.reply,
          })
          input.onCompleted?.(response.reply, response.proposal)
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : 'The background task failed.'
          updateTask(id, {
            status: 'failed',
            progress: 100,
            statusMessage: 'Could not complete the task',
            error: detail,
          })
          input.onFailed?.(detail)
        })
        .finally(() => window.clearInterval(progressTimer))
    }, 250)

    return id
  }, [updateTask])

  const dismissTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId))
  }, [])

  const clearFinished = useCallback(() => {
    setTasks((current) => current.filter((task) => ['queued', 'running'].includes(task.status)))
  }, [])

  const value = useMemo(() => ({ tasks, queueTask, dismissTask, clearFinished }), [clearFinished, dismissTask, queueTask, tasks])

  return <BackgroundTasksContext.Provider value={value}>{children}</BackgroundTasksContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useBackgroundTasks = () => {
  const context = useContext(BackgroundTasksContext)
  if (!context) throw new Error('useBackgroundTasks must be used inside BackgroundTasksProvider')
  return context
}
