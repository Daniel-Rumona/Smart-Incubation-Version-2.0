# 06. Agentic Support Standard

## Purpose

The AI assistant must be page-aware. It should understand what the user is viewing, what filters are active, what data is visible, and what actions are allowed.

The assistant must not hallucinate. It must use registered page data and approved service functions.

## Runtime boundary

- The frontend sends assistant requests to `VITE_AGENT_API_BASE_URL`.
- The browser must never receive provider API keys, Firebase service-account credentials, or `AGENT_SHARED_SECRET`.
- The AI backend owns provider credentials and Firestore snapshot sanitization.
- The current backend endpoint is `POST /api/agent` with `message`, `page`, and recent `history`.
- Show the typing state only while the backend request is active. Scroll the conversation to the newest message.
- Offer clickable page-aware starter prompts when a conversation begins.

## Page context shape

Every page should register structured context similar to this:

```ts
export type AgentPageContext = {
  pageKey: string
  pageName: string
  purpose: string
  currentFilters?: Record<string, unknown>
  metrics?: Record<string, unknown>
  dataSummary?: Record<string, unknown>
  allowedActions?: AgentCrudAction[]
  updatedAt: string
}
```

## Minimum context per page

Each page should register:

- `pageKey`: stable unique key.
- `pageName`: translated or human-readable name.
- `purpose`: what the page is for.
- `currentFilters`: the filters currently applied.
- `metrics`: visible metric card values.
- `dataSummary`: summarized table/card data, not huge raw objects.
- `allowedActions`: actions the current user can perform.
- `updatedAt`: ISO timestamp.

## Agent action rules

Agent actions must be explicit.

Each action should define:

- `key`
- `label`
- `description`
- `requiresConfirmation`

Example:

```ts
{
  key: 'archive_user',
  label: 'Archive user',
  description: 'Archive the selected user without deleting their history.',
  requiresConfirmation: true,
}
```

## CRUD through services only

Agent-triggered CRUD actions must use the same services used by the UI.

Do not create separate hidden Firestore logic just for the assistant.

Correct flow:

```txt
Assistant request -> permission check -> confirmation if needed -> domain service -> Firestore -> UI refresh
```

## Destructive action rule

Destructive or irreversible actions must require confirmation.

Examples:

- Delete.
- Archive.
- Disable.
- Reject.
- Remove file.
- Reset status.
- Send notification to many users.

## Hallucination guard

The assistant must say when data is not available in the registered page context.

It should not invent:

- Records.
- Metrics.
- User roles.
- Statuses.
- Dates.
- Firestore paths.
- Permissions.

## Data exposure rule

Do not expose raw internal IDs to end users unless explicitly required for debugging.

For agent context, internal IDs may exist only if needed for service actions. The UI response should use human-friendly names and labels.

## Recommended hook

Create a hook like:

```ts
useRegisterAgentPageContext({
  pageKey,
  pageName,
  purpose,
  currentFilters,
  metrics,
  dataSummary,
  allowedActions,
  updatedAt: new Date().toISOString(),
})
```

The hook should register context when relevant values change.

## Agentic operations (appointments and interventions)

Implemented in `ai-backend/agent_actions.py`. Applies to staff whose permissions allow it (`assign_interventions` / `track_interventions`); everyone else keeps the plain conversational path.

Flow: `POST /api/agent` -> model picks read tools (results fed back to it) or proposes one write tool -> the backend validates it, stores it in `agentActionProposals` and returns `proposal` -> the UI shows a confirmation card -> `POST /api/agent/actions/{id}/confirm` (or `/cancel`).

Rules:

- The model never writes. Only the confirm endpoint writes, and it re-validates against fresh data and current permissions.
- Identity and company come from the verified token, never from page context or the request body.
- A proposal belongs to one user, is single-use, and expires after 15 minutes.
- Writes produce the same documents as the operations UI (`assignedInterventions`, `appointments`, `notifications`), tagged `createdVia: "assistant"`.
- Consultants can only touch appointments and assignments where they are the delivery owner.
- Tools: `find_participants`, `list_assignments`, `list_delivery_owners`, `list_appointments` (read); `assign_intervention`, `schedule_appointment`, `reschedule_appointment`, `cancel_appointment`, `log_appointment_outcome` (write).

Response shape when a write is proposed:

```json
{ "reply": "...", "actionKey": null,
  "proposal": { "id": "...", "tool": "schedule_appointment", "title": "Schedule appointment",
                "summary": [{ "label": "When", "value": "..." }], "warnings": ["..."],
                "expiresAt": "ISO", "requiresConfirmation": true } }
```

### WhatsApp channel

Staff (operations, consultant, admin roles) can use the same tools over WhatsApp. `functions/src/whatsappBot.ts` routes unmatched staff text to `POST /api/whatsapp/agent` (ai-backend `whatsapp_agent.py`) and renders a proposal as Confirm / Discard buttons.

- Auth: `X-WhatsApp-Router-Secret` (constant-time compare, fails closed). The router sends the resolved `userId` and `phone`; the backend re-checks the phone belongs to that user's WhatsApp numbers and takes role and company from the user document.
- Confirm goes through the existing action PIN (`WHATSAPP_ACTION_PIN`) before `POST /api/whatsapp/agent/confirm`; a PIN authorises writes for 10 minutes, as in the assignment flow.
- Short-term memory (30 min, 8 turns) lives in `agentChannelSessions`, server-only.
- Proposals are user-bound and single-use, so a proposal made on the web can only be confirmed by the same user, and vice versa.
