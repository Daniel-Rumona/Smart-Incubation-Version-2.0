import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Button, Card, FloatButton, Grid, Progress, Space, Spin, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    SendOutlined,
} from '@ant-design/icons'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import ApplicationConversationalFlow from '@/components/applications/ApplicationConversationalFlow'
import ApplicationReviewPanel from '@/components/applications/ApplicationReviewPanel'
import { useFullscreenMobilePage } from '@/contexts/SystemLayoutTopbarContext'
import { getApplicantProfileBundle } from '@/services/applicantService'
import { clearDraft, loadDraft, saveDraftLocally, saveDraftRemotely } from '@/services/applicationDraftService'
import { callableMessage, enrolInDirectProgramme } from '@/services/programLinkService'
import {
    buildSelectedInterventions,
    calculateComplianceScore,
    createProgramApplication,
    getAgeFromIdNumber,
    getMissingDocuments,
    uploadApplicationDocuments,
} from '@/services/applicationService'
import {
    DEFAULT_INTERVENTION_POLICY,
    getProgramApplicationSetup,
    listProgramDocumentRequirements,
    listSelectableInterventionGroups,
} from '@/services/programApplicationService'
import type {
    ApplicationFormValues,
    ProgramDocumentRequirement,
    ProgramInterventionGroup,
    ProgramInterventionPolicy,
    ProgramQuestion,
} from '@/types/application'
import '@/styles/program-application.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Title } = Typography

type ParticipantSummary = {
    id: string
    data: Record<string, unknown>
}

export default function ProgramApplicationPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const navigate = useNavigate()
    const screens = Grid.useBreakpoint()
    const { programId } = useParams<{ programId: string }>()

    // This is a phone-first, one-question-at-a-time flow: it owns its own
    // header (Back + programme name) instead of the system topbar/bottom bar.
    useFullscreenMobilePage()

    const [programName, setProgramName] = useState('')
    const [companyCode, setCompanyCode] = useState('')

    const [reviewOpen, setReviewOpen] = useState(false)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [values, setValues] = useState<ApplicationFormValues>({})
    const [participant, setParticipant] = useState<ParticipantSummary | null>(null)
    const [programQuestions, setProgramQuestions] = useState<ProgramQuestion[]>([])
    const [documents, setDocuments] = useState<ProgramDocumentRequirement[]>([])
    const [interventionGroups, setInterventionGroups] = useState<ProgramInterventionGroup[]>([])
    const [interventionSelections, setInterventionSelections] = useState<Record<string, string[]>>({})
    const [interventionPolicy, setInterventionPolicy] = useState<ProgramInterventionPolicy>(DEFAULT_INTERVENTION_POLICY)
    // No-application programmes accept the SME on arrival; this holds why that failed, if it did.
    const [enrolError, setEnrolError] = useState('')
    // Drafts only save once the saved one (if any) has been restored, so loading never overwrites it.
    const [draftReady, setDraftReady] = useState(false)
    const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
    const remoteSaveTimer = useRef<number | undefined>(undefined)

    const isMobile = !screens.md

    const isForcedInterventionProgram = interventionPolicy?.mode === 'force_all' || interventionPolicy?.allowSmeSelection === false
    const maxInterventionSelections = Number(interventionPolicy?.maxSelections) > 0 ? Number(interventionPolicy?.maxSelections) : null

    const forcedInterventions = useMemo(() => {
        return Array.isArray(interventionPolicy?.forcedInterventions) ? interventionPolicy.forcedInterventions : []
    }, [interventionPolicy])

    const selectedInterventions = useMemo(() => {
        return buildSelectedInterventions({
            forcedInterventions,
            isForcedInterventionProgram,
            interventionGroups,
            interventionSelections,
        })
    }, [forcedInterventions, interventionGroups, interventionSelections, isForcedInterventionProgram])

    const complianceScore = useMemo(() => calculateComplianceScore(documents), [documents])
    const missingDocuments = useMemo(() => getMissingDocuments(documents), [documents])

    const progressPercent = useMemo(() => {
        const tasks = [
            Boolean(values.motivation?.trim()),
            Boolean(values.challenges?.trim()),
            ...programQuestions.filter((question) => question.required !== false).map((question) => {
                const answer = values.profile?.[question.id]
                return Array.isArray(answer) ? answer.length > 0 : Boolean(String(answer || '').trim())
            }),
            ...documents.filter((document) => document.isRequired !== false).map((document) => Boolean(document.file || document.uploadedUrl)),
            ...(!isForcedInterventionProgram && interventionGroups.length ? [selectedInterventions.length > 0] : []),
        ]
        const complete = tasks.filter(Boolean).length
        return tasks.length ? Math.round((complete / tasks.length) * 100) : 100
    }, [documents, interventionGroups.length, isForcedInterventionProgram, programQuestions, selectedInterventions.length, values.challenges, values.motivation, values.profile])

    const updateValues = (patch: Partial<ApplicationFormValues>) => {
        setValues((current) => {
            const next = {
                ...current,
                ...patch,
                profile: patch.profile ? { ...(current.profile || {}), ...patch.profile } : current.profile,
            }
            return next
        })
    }

    const resolveProgramContext = useCallback(async () => {
        if (!programId) {
            setProgramName('')
            setCompanyCode('')
            return {
                name: '',
                companyCode: '',
                direct: false,
            }
        }

        const programSnap = await getDoc(doc(db, 'programs', programId))

        if (!programSnap.exists()) {
            console.log('Program not found:', programId)

            setProgramName('')
            setCompanyCode('')

            return {
                name: '',
                companyCode: '',
                direct: false,
            }
        }

        const data = programSnap.data() as {
            name?: string
            companyCode?: string
            intakeMode?: string
        }

        const nextProgramName = String(data.name || '').trim()
        const nextCompanyCode = String(data.companyCode || '').trim()

        setProgramName(nextProgramName)
        setCompanyCode(nextCompanyCode)

        return {
            name: nextProgramName,
            companyCode: nextCompanyCode,
            direct: data.intakeMode === 'direct',
        }
    }, [programId])

    useEffect(() => {
        const loadApplicationContext = async () => {
            try {
                setLoading(true)

                const programContext = await resolveProgramContext()

                // No application: the profile they just finished is all this programme needs.
                if (programContext.direct && programId) {
                    try {
                        const enrolled = await enrolInDirectProgramme(programId)
                        if (!enrolled.alreadyAccepted) message.success(`${t('You have been added to')} ${enrolled.programName}.`)
                        // A full load, so the workspace re-reads the SME as a programme participant.
                        window.location.assign('/incubatee')
                    } catch (error) {
                        setEnrolError(callableMessage(error, t('We could not add you to this programme.')))
                        setLoading(false)
                    }
                    return
                }

                const [setup, documentRequirements] = await Promise.all([
                    getProgramApplicationSetup(programId),
                    listProgramDocumentRequirements(programId),
                ])

                setProgramQuestions(setup.programQuestions)
                setInterventionPolicy(setup.interventionPolicy || DEFAULT_INTERVENTION_POLICY)
                setDocuments(documentRequirements)

                const groups = await listSelectableInterventionGroups({
                    programId,
                    companyCode: programContext.companyCode,
                    interventionPolicy: setup.interventionPolicy,
                })
                setInterventionGroups(groups)

                const user = auth.currentUser
                if (user?.email) {
                    const profileBundle = await getApplicantProfileBundle(user.uid, user.email)
                    if (profileBundle) {
                        const participantData = {
                            ...profileBundle.applicantProfile,
                            ...profileBundle.businessProfile,
                        } as unknown as Record<string, unknown>
                        setParticipant({ id: profileBundle.businessProfile.id || user.uid, data: participantData })

                        const seedValues: ApplicationFormValues = {
                            participantName: String(participantData.participantName || user.displayName || ''),
                            email: String(participantData.email || user.email),
                            idNumber: String(participantData.idNumber || ''),
                            gender: String(participantData.gender || ''),
                            phone: String(participantData.phone || ''),
                            beneficiaryName: String(participantData.businessName || ''),
                            sector: String(participantData.sector || ''),
                            natureOfBusiness: String(participantData.natureOfBusiness || ''),
                            registrationNumber: String(participantData.registrationNumber || ''),
                            yearsOfTrading: Number(participantData.yearsOfTrading || 0),
                            businessAddress: String(participantData.businessAddress || ''),
                            province: String(participantData.province || ''),
                            city: String(participantData.city || ''),
                            hub: String(participantData.hub || ''),
                            postalCode: String(participantData.postalCode || ''),
                            location: String(participantData.location || ''),
                        }

                        const age = getAgeFromIdNumber(seedValues.idNumber)
                        if (age) seedValues.age = age

                        setValues(seedValues)
                    } else {
                        const seedValues: ApplicationFormValues = {
                            participantName: user.displayName || '',
                            email: user.email || '',
                        }
                        setValues(seedValues)
                    }

                    if (programId) {
                        const draft = await loadDraft(user.uid, programId)
                        if (draft) {
                            setValues((seed) => ({
                                ...seed,
                                ...draft.values,
                                profile: { ...(seed.profile || {}), ...(draft.values.profile || {}) },
                            }))
                            setInterventionSelections(draft.interventionSelections || {})
                            setDraftStatus('saved')
                            message.info(t('We picked up your saved answers.'))
                        }
                        setDraftReady(true)
                    }
                }
            } catch (error) {
                console.error(error)
                message.error(t('Failed to load application setup'))
            } finally {
                setLoading(false)
            }
        }

        void loadApplicationContext()
    }, [message, programId, resolveProgramContext, t])

    // Save as the SME answers: on this device straight away, to Firestore once they pause.
    useEffect(() => {
        const uid = auth.currentUser?.uid
        if (!draftReady || !uid || !programId) return
        const draft = { values, interventionSelections, savedAt: Date.now() }
        saveDraftLocally(uid, programId, draft)
        setDraftStatus('saving')
        window.clearTimeout(remoteSaveTimer.current)
        remoteSaveTimer.current = window.setTimeout(() => {
            saveDraftRemotely(uid, programId, draft)
                .catch((error) => console.warn('Draft kept on this device only', error))
                .finally(() => setDraftStatus('saved'))
        }, 1200)
        return () => window.clearTimeout(remoteSaveTimer.current)
    }, [draftReady, interventionSelections, programId, values])

    const validateBeforeSubmit = () => {
        if (!values.motivation?.trim() || !values.challenges?.trim()) {
            message.warning(t('Please complete the motivation and business challenges questions.'))
            setReviewOpen(false)
            return false
        }

        const unansweredQuestion = programQuestions.find((question) => {
            if (question.required === false) return false
            const answer = values.profile?.[question.id]
            return Array.isArray(answer) ? !answer.length : !String(answer || '').trim()
        })
        if (unansweredQuestion) {
            message.warning(`Please answer: ${unansweredQuestion.label}`)
            setReviewOpen(false)
            return false
        }

        if (missingDocuments.length) {
            message.warning(t('Please upload all required programme documents before submitting.'))
            return false
        }

        if (!isForcedInterventionProgram && interventionGroups.length && !selectedInterventions.length) {
            message.warning(t('Please select at least one programme intervention.'))
            setReviewOpen(false)
            return false
        }

        if (!isForcedInterventionProgram && maxInterventionSelections && selectedInterventions.length > maxInterventionSelections) {
            message.warning(`${t('This programme lets you choose up to')} ${maxInterventionSelections}. ${t('Please remove some interventions.')}`)
            setReviewOpen(false)
            return false
        }

        return true
    }

    const handleSubmit = async () => {
        if (!validateBeforeSubmit()) return

        try {
            setSubmitting(true)
            const uploadedDocuments = await uploadApplicationDocuments({
                documents,
                companyCode,
                programId,
                participantId: participant?.id,
            })
            setDocuments(uploadedDocuments)

            const nextComplianceScore = calculateComplianceScore(uploadedDocuments)
            if (nextComplianceScore < 10) {
                message.error(t('Compliance must be 10% or higher before this application can be submitted.'))
                return
            }

            await createProgramApplication({
                participantId: participant?.id,
                companyCode,
                programId,
                programName: programName || '',
                applicationStatus: 'pending',
                submittedAt: new Date().toISOString(),
                formValues: values,
                complianceScore: nextComplianceScore,
                complianceDocuments: uploadedDocuments,
                interventions: {
                    required: selectedInterventions,
                    assigned: [],
                    completed: [],
                    participationRate: 0,
                },
            })

            setDraftReady(false)
            window.clearTimeout(remoteSaveTimer.current)
            if (auth.currentUser && programId) await clearDraft(auth.currentUser.uid, programId)

            message.success(t('Application submitted successfully'))
            navigate('/applicant/application-tracker')
        } catch (error) {
            console.error(error)
            message.error(t('Failed to submit application'))
        } finally {
            setSubmitting(false)
        }
    }

    if (enrolError) {
        return (
            <div className="program-application-page program-application-loading">
                <Card>
                    <Space direction="vertical" size={12}>
                        <Title level={4}>{programName || t('Programme')}</Title>
                        <Typography.Text>{enrolError}</Typography.Text>
                        <Button type="primary" onClick={() => navigate('/applicant/profile')}>{t('Review my profile')}</Button>
                    </Space>
                </Card>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="program-application-page program-application-loading">
                <Spin tip={t('Loading application setup...')} />
            </div>
        )
    }

    return (
        <div className="program-application-page">
            <Card className="program-application-header" variant="borderless">
                <div className="program-application-heading">
                    <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} aria-label={t('Back')}>{t('Back')}</Button>

                    <div className="program-application-title-wrap">
                        <Title level={5} className="program-application-title">
                            {programName || t('Programme application')}
                        </Title>
                        {draftStatus !== 'idle' && (
                            <span className="program-application-draft-status" aria-live="polite">
                                {draftStatus === 'saving' ? t('Saving draft...') : t('Draft saved')}
                            </span>
                        )}
                    </div>

                    <div className="program-application-progress-arc-wrap">
                        <Progress
                            type="dashboard"
                            percent={progressPercent}
                            gapDegree={180}
                            gapPosition="bottom"
                            size={isMobile ? 40 : 52}
                            strokeWidth={9}
                            strokeColor="#6d5dfb"
                            showInfo={false}
                            className="program-application-progress-arc"
                            style={{ height: isMobile ? 26 : 32 }}
                        />
                        <span className="program-application-progress-label">{progressPercent}%</span>
                    </div>
                </div>
            </Card>

            <div>
                {reviewOpen ? (
                    <>
                        <ApplicationReviewPanel
                            values={values}
                            documents={documents}
                            complianceScore={complianceScore}
                            selectedInterventions={selectedInterventions}
                            programQuestions={programQuestions}
                        />

                        <div className="program-application-actions">
                            <Button size="large" icon={<ArrowLeftOutlined />} onClick={() => setReviewOpen(false)}>{t('Back to application')}</Button>
                            <Button
                                type="primary"
                                size="large"
                                icon={<SendOutlined />}
                                loading={submitting}
                                onClick={handleSubmit}
                            >
                                {t('Submit application')}
                            </Button>
                        </div>
                    </>
                ) : (
                    <ApplicationConversationalFlow
                        values={values}
                        onValuesChange={updateValues}
                        programQuestions={programQuestions}
                        documents={documents}
                        onDocumentsChange={setDocuments}
                        isForcedInterventionProgram={isForcedInterventionProgram}
                        interventionGroups={interventionGroups}
                        interventionSelections={interventionSelections}
                        onInterventionSelectionsChange={setInterventionSelections}
                        maxInterventionSelections={maxInterventionSelections}
                        onComplete={() => setReviewOpen(true)}
                        programName={programName}
                    />
                )}
            </div>

            <FloatButton.BackTop
                className="program-application-back-top"
                visibilityHeight={320}
                tooltip={t('Back to top')}
            />
        </div>
    )
}
