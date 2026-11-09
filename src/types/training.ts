/**
 * Awareness training (client module, see config/clientModules.ts).
 *
 * A class is one run of a course (in person, online or both): learners from several client organisations, a daily
 * attendance register, the course assessment written as a pre-assessment and a post-assessment, and a group
 * assignment. Dates are kept as `YYYY-MM-DD`, class hours as `HH:mm` and audit times as ISO strings.
 */

/** `hybrid`: a venue and a meeting link, each learner attending one way or the other. */
export type TrainingDeliveryMode = 'in_person' | 'online' | 'hybrid'

/** How a learner attended a day of a hybrid class. */
export type TrainingAttendanceMode = 'in_person' | 'online'

export type TrainingClassHours = { start: string, end: string }

export type TrainingTestsOpen = { pre: boolean, post: boolean }

export type TrainingClass = {
    id: string
    companyCode: string
    courseTitle: string
    deliveryMode: TrainingDeliveryMode
    /** In-person classes: where the class meets. */
    venue: string
    /** Online classes: the meeting link the facilitator pasted (Zoom, Microsoft Teams, Google Meet, ...). */
    meetingUrl?: string
    /** First training day, `YYYY-MM-DD`. */
    startDate: string
    /** Training days in the class; the attendance register has one column per day. */
    dayCount: number
    /** The usual hours of each training day, `HH:mm`. Classes from before hours were kept have none. */
    hours?: TrainingClassHours
    /** Days whose hours differ from the usual ones, keyed by training day ('1', '2', ...). */
    dayHours?: Record<string, TrainingClassHours>
    /** The post-assessment, and the pre-assessment too unless the class has its own (`preAssessmentId`). */
    assessmentId?: string
    /** A different assessment for the pre-assessment. */
    preAssessmentId?: string
    /** The funder of the class (trainingFunders); its learners count for that funder unless marked otherwise. */
    funderId?: string
    /** The post-test score a learner needs to pass. */
    passMarkPct: number
    /** Extra post-test attempts allowed after a first attempt below the pass mark. */
    reassessmentsAllowed: number
    /** Passing also needs participation in a marked group assignment. */
    groupAssignmentRequired: boolean
    /** Which tests learners may start online; the facilitator opens each one when the class is ready for it. */
    testsOpen: TrainingTestsOpen
    /** Accounts of the class's learners, so each can read their own class. */
    learnerUids: string[]
    createdAt?: string
    createdBy?: string
    updatedAt?: string
    updatedBy?: string
}

export type TrainingClassValues = Omit<TrainingClass, 'id' | 'companyCode' | 'testsOpen' | 'learnerUids' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>

export type TrainingClassPhase = 'upcoming' | 'running' | 'finished'

export type TrainingAttendanceMark = {
    present: boolean
    recordedAt: string
    recordedBy: 'facilitator' | 'learner'
    /** Hybrid classes: whether the learner was there in person or joined online that day. */
    mode?: TrainingAttendanceMode
}

export type TrainingIdDocumentStatus = 'pending' | 'verified' | 'queried'

/** A copy of the learner's ID. Only its storage path is kept: the file is fetched through the storage rules, never by a shareable link. */
export type TrainingIdDocument = {
    fileName: string
    storagePath: string
    contentType: string
    uploadedAt: string
    uploadedBy: 'facilitator' | 'learner'
    /** When the learner agreed to the ID copy being kept for the training record. */
    consentAt?: string
    status: TrainingIdDocumentStatus
    note?: string
    reviewedAt?: string
}

export type TrainingLearner = {
    id: string
    companyCode: string
    classId: string
    name: string
    email: string
    idNumber: string
    /** The client organisation the learner attends for. */
    organisation: string
    /** The client company's record (trainingOrganisations), once the company is registered; its people see this learner. */
    organisationId?: string
    /** Booked by the client company itself (their account's uid) rather than added by the facilitator. */
    bookedBy?: string
    /** A funder for this learner other than the class's (trainingFunders). */
    funderId?: string
    /** The details the facilitator asks of learners (config/trainingDetails.ts): gender, disability, job title, ... */
    details?: TrainingDetails
    phone?: string
    /** The learner's own account, once they have been invited. */
    uid?: string
    invitedAt?: string
    /** Keyed by training day: '1', '2', ... */
    attendance: Record<string, TrainingAttendanceMark>
    attendanceRemark?: string
    idDocument?: TrainingIdDocument
    /** The learner's current certificate for this class, once issued. */
    certificateId?: string
    createdAt?: string
    updatedAt?: string
}

export type TrainingLearnerValues = Pick<TrainingLearner, 'name' | 'email' | 'idNumber' | 'organisation' | 'phone'> & Partial<Pick<TrainingLearner, 'funderId' | 'details'>>

/**
 * A client company the training company works with (trainingOrganisations). Learners link to it by name; its director
 * and coordinators (role clientorg) see their own people's training and book them into classes.
 */
/** Answers to the details asked (config/trainingDetails.ts), by field key. */
export type TrainingDetails = Record<string, string | number>

/** A document a client company uploaded (config/trainingDetails.ts COMPANY_DOCUMENTS), read through the storage rules. */
export type TrainingOrgDocument = {
    fileName: string
    storagePath: string
    contentType: string
    uploadedAt: string
    uploadedBy: string
}

export type TrainingOrganisation = {
    id: string
    companyCode: string
    name: string
    contactName: string
    contactEmail: string
    phone?: string
    /** The business details the facilitator asks for, filled in by the company after its invite (or by her). */
    details: TrainingDetails
    documents: Record<string, TrainingOrgDocument>
    /** When the company first sent its details. */
    detailsSubmittedAt?: string
    createdAt?: string
    updatedAt?: string
}

export type TrainingOrganisationValues = Pick<TrainingOrganisation, 'name' | 'contactName' | 'contactEmail' | 'phone'>

/** `shared`: her learners and client companies see it too; `staff`: only the training company's own people. */
export type TrainingLibraryAudience = 'shared' | 'staff'

export type TrainingLibraryCategory = 'course_material' | 'reading' | 'template' | 'reference'

/**
 * One item in the training company's library: a file (kept in storage, read through the storage rules) or a link.
 * The readable text of PDF, Word and text files is kept apart (trainingLibraryTexts) for the assistant.
 */
export type TrainingLibraryItem = {
    id: string
    companyCode: string
    title: string
    description: string
    category: TrainingLibraryCategory
    /** The course it belongs to; '' for every course. Learners see the items for their own course. */
    courseTitle: string
    audience: TrainingLibraryAudience
    kind: 'file' | 'link'
    fileName?: string
    storagePath?: string
    contentType?: string
    size?: number
    url?: string
    /** Characters of text the assistant can read (0 when the file has none it can read). */
    textChars: number
    createdAt?: string
    updatedAt?: string
}

export type TrainingLibraryValues = Pick<TrainingLibraryItem, 'title' | 'description' | 'category' | 'courseTitle' | 'audience'> & { url?: string }

/** A client company's business figures for one month (trainingOrgMetrics), to show progress against its baseline. */
export type TrainingOrgMetric = {
    id: string
    companyCode: string
    organisationId: string
    /** `YYYY-MM`. */
    period: string
    revenue: number
    employees?: number
    recordedAt?: string
}

export type OrganisationAttempt = { attempt: number, status: 'in_progress' | 'submitted' | 'marked', scorePct: number | null }

/** One of a client company's learners, as getOrganisationTrainingResults returns it: scores only, never answers. */
export type OrganisationLearnerResult = {
    learnerId: string
    name: string
    classId: string
    pre: OrganisationAttempt[]
    post: OrganisationAttempt[]
    bestPostPct: number | null
    passMarkPct: number
    canWrite: Array<'pre' | 'post'>
    certified: boolean
}

export type TrainingOrgRole = 'director' | 'coordinator'

/** A client company's account: its director (given by the training company) or a coordinator the director added. */
export type TrainingOrgMember = {
    uid: string
    name: string
    email: string
    organisationId: string
    orgRole: TrainingOrgRole
    jobTitle: string
}

export type TrainingQuestion = {
    id: string
    text: string
    marks: number
}

export type TrainingRubricCriterion = {
    id: string
    label: string
    maxMarks: number
    /** What the facilitator looks for, e.g. "Three distinct E/S/G topics with rationale". */
    guidance?: string
}

/**
 * The course assessment: the knowledge test (written answers) and the group case assignment with its rubric.
 * Learners may read this record; the memo answers live apart in TrainingAssessmentMemo so they never reach them.
 */
/** What an assessment is written as: before the class, after it, or both (the same questions twice). */
export type TrainingAssessmentUse = 'pre' | 'post' | 'both'

export type TrainingAssessment = {
    id: string
    companyCode: string
    title: string
    use: TrainingAssessmentUse
    instructions?: string
    durationMinutes?: number
    questions: TrainingQuestion[]
    caseBrief?: string
    rubric: TrainingRubricCriterion[]
    createdAt?: string
    updatedAt?: string
    updatedBy?: string
}

/** Facilitator-only: the expected answer for each question, keyed by question id. */
export type TrainingAssessmentMemo = {
    companyCode: string
    answers: Record<string, string>
}

export type TrainingAssessmentValues = Omit<TrainingAssessment, 'id' | 'companyCode' | 'createdAt' | 'updatedAt' | 'updatedBy'> & {
    memo: Record<string, string>
}

export type TrainingTestKind = 'pre' | 'post'

export type TrainingSubmissionStatus = 'in_progress' | 'submitted' | 'marked'

export type TrainingSubmission = {
    id: string
    companyCode: string
    classId: string
    learnerId: string
    /** The learner's account, so they can read their own attempts and results. */
    learnerUid?: string
    assessmentId: string
    kind: TrainingTestKind
    /** 1 for the first post-test, 2 and up for reassessments. Always 1 for the pre-test. */
    attempt: number
    /** `paper`: written on paper in class, so only the marks are captured. */
    source: 'online' | 'paper'
    /** The questions as they were when the test started, so later edits to the assessment cannot change it. */
    questions: TrainingQuestion[]
    answers: Record<string, string>
    status: TrainingSubmissionStatus
    marks: Record<string, number>
    score?: number
    totalMarks: number
    scorePct?: number
    startedAt?: string
    submittedAt?: string
    markedAt?: string
    markedBy?: string
}

export type TrainingGroup = {
    id: string
    companyCode: string
    classId: string
    name: string
    learnerIds: string[]
    /** Members who did not take part; they do not earn the group's participation. */
    absentLearnerIds: string[]
    /** Rubric marks keyed by criterion id; empty until the group is marked. */
    rubricMarks: Record<string, number>
    total?: number
    maxTotal: number
    markedAt?: string
    markedBy?: string
    createdAt?: string
    updatedAt?: string
}

export type TrainingGroupValues = Pick<TrainingGroup, 'name' | 'learnerIds'>

export type TrainingCertificateStatus = 'valid' | 'cancelled'

/**
 * A certificate of completion. Everything printed on it is copied in when it is issued, so the certificate (and
 * its PDF) stays exactly as issued even if the class or the learner's details change later; corrections are made by
 * reissuing. The id is random and is what the verification link and QR code carry.
 */
export type TrainingCertificate = {
    id: string
    companyCode: string
    classId: string
    learnerId: string
    learnerUid?: string
    /** e.g. TNS-2026-0001 */
    certificateNumber: string
    learnerName: string
    organisation: string
    courseTitle: string
    /** "12 – 14 Nov 2026" */
    trainingDates: string
    deliveryLabel: string
    providerName: string
    logoUrl?: string
    /** A second logo (e.g. a recognising body), only once its owner has given written permission. */
    partnerLogoUrl?: string
    signatoryName: string
    signatureUrl?: string
    /** `YYYY-MM-DD` */
    issuedOn: string
    issuedAt: string
    issuedBy: string
    status: TrainingCertificateStatus
    cancelledAt?: string
    cancelReason?: string
    replacedBy?: string
}

/** The public record anyone can look up from the certificate's link or QR code: no contact or ID details. */
export type CertificateVerification = Pick<TrainingCertificate, 'certificateNumber' | 'learnerName' | 'courseTitle' | 'trainingDates' | 'providerName' | 'issuedOn' | 'status' | 'cancelledAt'>

export type TrainingResultStatus =
    | 'not_started'
    | 'awaiting_marking'
    | 'reassessment_available'
    | 'awaiting_group'
    | 'passed'
    | 'not_passed'

export type TrainingLearnerResult = {
    learner: TrainingLearner
    preScorePct?: number
    /** Best marked post-test score across attempts. */
    postScorePct?: number
    postAttempts: number
    group?: TrainingGroup
    groupParticipated: boolean
    status: TrainingResultStatus
}
