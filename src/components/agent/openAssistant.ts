/** Window event the assistant (AgentFab) listens for, so any page can open it, e.g. a "Get help" button. */
export const OPEN_ASSISTANT_EVENT = 'smartv2:open-assistant'

export const openAssistant = () => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))
