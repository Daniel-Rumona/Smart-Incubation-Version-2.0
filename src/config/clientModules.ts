/**
 * Client modules: whole areas built for one client that stay switched off for every other company.
 *
 * Unlike plan features (config/entitlements.ts), where companies without a plan keep everything, a client module is
 * only on when a platform admin switches it on for that company (Client modules page). The switch is a boolean on
 * `companies/{code}`, so it reaches pages through SystemSettingsProvider like any other company setting, and
 * firestore.rules reads the same field before allowing the module's records.
 *
 * A company whose work is mainly one module can also have that module as its staff's home (`clientHomeModule`):
 * signing in, the Home link and the Agentic home then open the module instead of the standard dashboard.
 */
export type ClientModuleKey = 'awarenessTraining' | 'esgReporting'

export type ClientModule = {
    /** The `companies/{code}` field that switches the module on. */
    setting: string
    label: string
    description: string
    /** Staff roles that run the module (they also get it as their home when it is the company's home module). */
    staffRoles: string[]
    /** Where the module's staff home is. */
    homePath: string
    /**
     * When the module is the company's home: the shared pages its staff still use. Every other page leaves their
     * menu and top bar (as for Training SMEs, links to them keep working), except other client modules switched on.
     */
    keepPaths: string[]
    /** When the module is the company's home: the top-bar links after Home (phones show the first three, the rest stay in the Menu). */
    quickLinkPaths: string[]
    /** When the module is the company's home: where the company's funder lands (a read-only report of its work). */
    funderHomePath?: string
}

export const CLIENT_MODULES: Record<ClientModuleKey, ClientModule> = {
    awarenessTraining: {
        setting: 'awarenessTrainingEnabled',
        label: 'Awareness training',
        description: 'Training classes in person or online: learners from client organisations, a daily attendance register, written tests marked against a memo, group assignments, results, certificates, revenue and a report for the company\'s funder.',
        staffRoles: ['projectadmin', 'operations'],
        homePath: '/training/home',
        // Client organisations apply to the company's listed programme, so programmes and applications stay.
        keepPaths: ['/operations/programs', '/shared/applications'],
        quickLinkPaths: ['/training/classes', '/training/assessments', '/training/surveys', '/esg/reports', '/training/revenue'],
        funderHomePath: '/training/funder',
    },
    esgReporting: {
        setting: 'esgReportingEnabled',
        label: 'ESG reporting',
        description: 'ESG reports for client organisations: the GRI and country standards chosen from sector, country and dates, the data, risk, stakeholder and action registers (imported from the ESG toolkit workbook), checks, AI-drafted sections, a GRI content index and a Word report.',
        staffRoles: ['projectadmin', 'operations'],
        homePath: '/esg/reports',
        keepPaths: [],
        quickLinkPaths: [],
    },
}

export const CLIENT_MODULE_KEYS = Object.keys(CLIENT_MODULES) as ClientModuleKey[]

/** `companies/{code}` field naming the module that is the company's staff home. */
export const CLIENT_HOME_SETTING = 'clientHomeModule'

export const isClientModuleKey = (value: unknown): value is ClientModuleKey =>
    typeof value === 'string' && CLIENT_MODULE_KEYS.includes(value as ClientModuleKey)

/**
 * The module that is this person's home: the company's home module, switched on, and run by their role (or, for the
 * company's funder, when the module has a funder home).
 */
export const clientHomeModuleFor = (settings: Record<string, unknown>, role?: string): ClientModuleKey | null => {
    const key = settings[CLIENT_HOME_SETTING]
    if (!isClientModuleKey(key) || settings[CLIENT_MODULES[key].setting] !== true) return null
    const module = CLIENT_MODULES[key]
    if (role === 'funder') return module.funderHomePath ? key : null
    return role && module.staffRoles.includes(role) ? key : null
}

/** Whether the company has ESG reporting switched on (training pages leave out ESG wording and figures when not). */
export const esgReportingOn = (settings: Record<string, unknown>) => settings[CLIENT_MODULES.esgReporting.setting] === true

/**
 * The workspace type: Incubation (the standard app) or Training (awareness training is the staff home and the
 * incubation pages leave the menu). The client modules on top are add-ons: ESG reporting on either type, and training
 * inside an incubation workspace. Derived from the fields above (training switched on and set as the home), so no
 * record changes shape and firestore.rules and the assistant keep reading the same fields; clientModulesService writes
 * them through workspaceTypeFields.
 */
export type WorkspaceType = 'incubation' | 'training'

export const WORKSPACE_TYPES: Array<{ key: WorkspaceType, label: string, description: string }> = [
    { key: 'incubation', label: 'Incubation', description: 'Programmes, SMEs, interventions, diagnostics and the standard reports.' },
    { key: 'training', label: 'Training', description: 'Classes, learners from client companies, assessments, certificates, surveys, revenue and a funder report. No SMEs, interventions or diagnostics.' },
]

export const workspaceTypeOf = (settings: Record<string, unknown>): WorkspaceType =>
    settings[CLIENT_HOME_SETTING] === 'awarenessTraining' && settings[CLIENT_MODULES.awarenessTraining.setting] === true ? 'training' : 'incubation'

/** The client modules a workspace type can add on (training is part of a Training workspace, not an add-on to it). */
export const WORKSPACE_ADD_ONS: Record<WorkspaceType, ClientModuleKey[]> = {
    incubation: ['esgReporting', 'awarenessTraining'],
    training: ['esgReporting'],
}

/**
 * The `companies/{code}` fields for a workspace type; `null` means remove the field. Training switches the training
 * module on and makes it the home; Incubation removes the home and leaves training on as an add-on (its records stay
 * visible until the add-on is switched off).
 */
export const workspaceTypeFields = (type: WorkspaceType): Record<string, true | string | null> => type === 'training'
    ? { [CLIENT_MODULES.awarenessTraining.setting]: true, [CLIENT_HOME_SETTING]: 'awarenessTraining' }
    : { [CLIENT_HOME_SETTING]: null }

/** The settings of the client modules switched on for the company, so their pages stay in a client-home menu. */
export const enabledClientModuleSettings = (settings: Record<string, unknown>) =>
    new Set(CLIENT_MODULE_KEYS.map((key) => CLIENT_MODULES[key].setting).filter((setting) => settings[setting] === true))
