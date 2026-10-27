import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Button,
    Card,

    Input,
    Progress,
    Rate,
    Space,
    Tag,
    Typography,
    Upload,
    message,
} from "antd";
import {
    BulbOutlined,
    CheckCircleOutlined,
    InboxOutlined,
    RobotOutlined,
    SendOutlined,
    TeamOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { Helmet } from "react-helmet";
import {
    Timestamp,
    addDoc,
    collection,
    doc,
    getDocs,
    increment,
    query,
    serverTimestamp,
    updateDoc,
    where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "@/firebase";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { agentApiBaseUrl, isAgentApiConfigured } from "@/config/agent";
import { getAgentAuthHeaders } from "@/services/agentAuth";

import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useNavigate } from "react-router-dom";
import { workspaceCompanyCode } from "@/services/companiesService";
import { loadSmeWork, type SmeWork } from "@/services/smeWorkService";
import { listConnectionRequestsForSme } from "@/services/connectionRequestService";
import type { ConnectionRequest } from "@/types/connectionRequest";
import { loadSavedSuggestions, requestSuggestions, type SavedSuggestions } from "@/services/roadmapSuggestionsService";
import DashboardPage from "@/components/shared/DashboardPage";
import ResponsiveModal from "@/components/shared/ResponsiveModal";
import { useLanguage } from '@/providers/LanguageProvider'
import "@/styles/roadmap.css";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

type AgentCategory =
    | "compliance"
    | "finance"
    | "market"
    | "operations"
    | "training"
    | "general";
type ChatRole = "agent" | "sme";
type UrgencyLevel = "low" | "medium" | "high" | "urgent";
type FirestoreDate = Timestamp | Date | string | number | null | undefined;

type RecommendedIntervention = {
    title: string;
    interventionId?: string;
    areaOfSupport?: string;
    department?: string;
    urgency?: UrgencyLevel;
    reason?: string;
    expectedImpact?: string;
    targetOutcome?: string;
    estimatedWeeks?: number;
};

type IntakeDecision = {
    stage?: string;
    urgencyLevel?: UrgencyLevel;
    urgencyScore?: number;
    riskLevel?: "low" | "medium" | "high";
    recommendedProgramId?: string;
    recommendedProgramName?: string;
    recommendedInterventions?: RecommendedIntervention[];
    summary?: string;
    classificationReasons?: string[];
    redFlags?: string[];
    growthSignals?: string[];
    benefitsOfProgram?: string[];
    benefitsOfAgents?: string[];
    roadmap?: RoadmapItem[];
};

type IntakeResult = {
    decision?: IntakeDecision;
    missingFields?: Array<{
        field: string;
        label?: string;
        question?: string;
        reason?: string;
    }>;
    missingDocuments?: Array<{ type: string; reason?: string }>;
    warnings?: string[];
    confidence?: number;
};

type IntakeSubmission = {
    id: string;
    companyCode?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    rawStory?: string;
    selectedPath?: "program" | "agents";
    status?: string;
    recommendedProgramId?: string | null;
    recommendedProgramName?: string | null;
    urgencyLevel?: UrgencyLevel | null;
    urgencyScore?: number;
    stage?: string | null;
    riskLevel?: string | null;
    decision?: IntakeDecision | null;
    aiResult?: IntakeResult | null;
    uploadedDocuments?: Array<{ name?: string; type?: string; size?: number; url?: string }>;
    createdByEmail?: string;
    createdAt?: FirestoreDate;
    updatedAt?: FirestoreDate;
};

type RoadmapItem = {
    title: string;
    interventionId?: string;
    areaOfSupport?: string;
    department?: string;
    urgency?: UrgencyLevel;
    reason?: string;
    status?: "not_started" | "in_progress" | "completed" | "blocked";
    estimatedWeeks?: number;
    progress?: number;
    expectedImpact?: string;
    targetOutcome?: string;
    dueDate?: FirestoreDate;
    source?: "diagnostic_plan" | "assignment" | "intake";
};

type SupportAgent = {
    id: string;
    name: string;
    title: string;
    category: AgentCategory;
    department: string;
    focus: string;
    intro: string;
    requestedItems: string[];
    matchedInterventionTitle?: string;
    matchedInterventionTitles?: string[];
    urgency?: UrgencyLevel;
};

type ChatMessage = {
    id: string;
    role: ChatRole;
    text: string;
    createdAt: string;
    requiresRating?: boolean;
    rating?: number;
};

type AgentDocument = {
    id: string;
    type: string;
    fileName?: string | null;
    url?: string | null;
    source: "intake" | "compliance";
    currentStatus?: string | null;
};

const toMillis = (value: FirestoreDate) => {
    if (!value) return 0;
    if (value instanceof Timestamp) return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const formatDate = (value: FirestoreDate) => {
    const millis = toMillis(value);
    if (!millis) return "Not dated";

    return new Intl.DateTimeFormat("en-ZA", {
        year: "numeric",
        month: "short",
        day: "2-digit",
    }).format(new Date(millis));
};

const weeksFromUrgency = (urgency?: UrgencyLevel) => {
    if (urgency === "urgent") return 2;
    if (urgency === "high") return 4;
    if (urgency === "medium") return 6;
    return 8;
};

const categoryFromText = (value?: string): AgentCategory => {
    const text = `${value || ""}`.toLowerCase();

    if (
        text.includes("tax") ||
        text.includes("compliance") ||
        text.includes("cipc") ||
        text.includes("safety")
    )
        return "compliance";
    if (
        text.includes("finance") ||
        text.includes("fund") ||
        text.includes("cash") ||
        text.includes("account")
    )
        return "finance";
    if (
        text.includes("market") ||
        text.includes("sales") ||
        text.includes("tender") ||
        text.includes("customer")
    )
        return "market";
    if (
        text.includes("operation") ||
        text.includes("process") ||
        text.includes("production")
    )
        return "operations";
    if (
        text.includes("training") ||
        text.includes("skill") ||
        text.includes("mentor")
    )
        return "training";
    return "general";
};

const agentNameForCategory = (category: AgentCategory) => {
    const names: Record<AgentCategory, string> = {
        compliance: "Compliance Navigator",
        finance: "Finance Readiness Agent",
        market: "Market Linkage Agent",
        operations: "Operations Improvement Agent",
        training: "Skills Development Agent",
        general: "Business Support Agent",
    };

    return names[category];
};

const requestedItemsForCategory = (category: AgentCategory) => {
    const items: Record<AgentCategory, string[]> = {
        compliance: [
            "Director ID",
            "CIPC document",
            "Tax PIN",
            "Relevant compliance certificates",
        ],
        finance: [
            "Latest bank statement",
            "Revenue estimate",
            "Expense breakdown",
            "Funding requirement",
        ],
        market: [
            "Product/service list",
            "Target customers",
            "Past sales evidence",
            "Tender or buyer interest",
        ],
        operations: [
            "Current process description",
            "Staff count",
            "Equipment list",
            "Known bottlenecks",
        ],
        training: [
            "Training need description",
            "Team roles",
            "Preferred training dates",
        ],
        general: [
            "Business profile",
            "Main challenge",
            "Available supporting documents",
        ],
    };

    return items[category];
};

const cleanDocumentKey = (value?: string) =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

const documentAliases: Record<string, string[]> = {
    "cipc document": ["cipc", "registration", "company registration", "business registration"],
    "director id": ["id document", "identity", "director id"],
    "tax pin": ["tax", "tax clearance", "pin"],
    "relevant compliance certificates": ["certificate", "compliance"],
    "latest bank statement": ["bank statement", "bank"],
    "bank confirmation": ["bank confirmation", "bank letter"],
    "business profile": ["business profile", "company profile", "profile"],
    "available supporting documents": ["supporting", "evidence", "document"],
};

const documentMatchesRequest = (request: string, document: AgentDocument) => {
    const requestKey = cleanDocumentKey(request);
    const docText = cleanDocumentKey(`${document.type} ${document.fileName}`);
    if (!requestKey || !docText) return false;
    if (docText.includes(requestKey) || requestKey.includes(docText)) return true;
    return (documentAliases[requestKey] || []).some((alias) => docText.includes(cleanDocumentKey(alias)));
};

const dedupeAgents = (items: SupportAgent[]) => {
    const grouped = new Map<AgentCategory, SupportAgent>();

    items.forEach((agent) => {
        const existing = grouped.get(agent.category);
        if (!existing) {
            grouped.set(agent.category, {
                ...agent,
                id: agent.category,
                matchedInterventionTitles: [
                    ...new Set((agent.matchedInterventionTitles?.length ? agent.matchedInterventionTitles : [agent.matchedInterventionTitle]).filter(Boolean) as string[]),
                ],
            });
            return;
        }

        const titles = [
            ...(existing.matchedInterventionTitles || []),
            ...(agent.matchedInterventionTitles || []),
            ...(agent.matchedInterventionTitle ? [agent.matchedInterventionTitle] : []),
        ].filter(Boolean) as string[];
        existing.matchedInterventionTitles = [...new Set(titles)];
        existing.matchedInterventionTitle = existing.matchedInterventionTitles[0];
        existing.focus = existing.matchedInterventionTitles.slice(0, 3).join(", ") || existing.focus;
        existing.department = existing.department === agent.department ? existing.department : "Multi-department Support";
        existing.requestedItems = [...new Set([...existing.requestedItems, ...agent.requestedItems])];
        if (agent.urgency === "urgent" || (agent.urgency === "high" && existing.urgency !== "urgent")) {
            existing.urgency = agent.urgency;
        }
    });

    return Array.from(grouped.values());
};

const buildRoadmap = (submission?: IntakeSubmission | null): RoadmapItem[] => {
    const decision = submission?.decision || submission?.aiResult?.decision;
    const aiRoadmap = decision?.roadmap || [];

    if (aiRoadmap.length) {
        return aiRoadmap.map((item, index) => ({
            ...item,
            areaOfSupport: item.areaOfSupport || item.department || "General Support",
            department: item.areaOfSupport || item.department || "General Support",
            progress: item.progress ?? (index === 0 ? 20 : 0),
            status: item.status || (index === 0 ? "in_progress" : "not_started"),
            estimatedWeeks: item.estimatedWeeks || weeksFromUrgency(item.urgency),
        }));
    }

    return (decision?.recommendedInterventions || []).map((item, index) => ({
        title: item.title,
        interventionId: item.interventionId,
        areaOfSupport: item.areaOfSupport || item.department || "General Support",
        department: item.areaOfSupport || item.department || "General Support",
        urgency: item.urgency || decision?.urgencyLevel || "medium",
        reason: item.reason || "Recommended from the AI intake analysis.",
        status: index === 0 ? "in_progress" : "not_started",
        estimatedWeeks:
            item.estimatedWeeks ||
            weeksFromUrgency(item.urgency || decision?.urgencyLevel),
        progress: index === 0 ? 20 : 0,
        expectedImpact:
            item.expectedImpact ||
            "Improve readiness and reduce the gap identified during intake.",
        targetOutcome:
            item.targetOutcome ||
            "Complete the intervention requirements and move closer to programme readiness.",
    }));
};

const buildAgents = (roadmap: RoadmapItem[]): SupportAgent[] => {
    const grouped = new Map<string, SupportAgent>();

    roadmap.forEach((item) => {
        const supportArea = item.areaOfSupport || item.department || "General Support";
        const category = categoryFromText(`${supportArea} ${item.title}`);
        const key = category;

        if (!grouped.has(key)) {
            grouped.set(key, {
                id: key,
                name: agentNameForCategory(category),
                title: `${agentNameForCategory(category).replace(" Agent", "")} Support`,
                category,
                department: supportArea,
                focus: item.title,
                intro: `I can help with ${item.title.toLowerCase()} and guide the SME through documents, questions and next steps.`,
                requestedItems: requestedItemsForCategory(category),
                matchedInterventionTitle: item.title,
                matchedInterventionTitles: [item.title],
                urgency: item.urgency,
            });
            return;
        }

        const current = grouped.get(key);
        if (current) {
            const titles = current.matchedInterventionTitles || [];
            if (!titles.includes(item.title)) {
                titles.push(item.title);
                current.matchedInterventionTitles = titles;
            }
            current.focus = titles.slice(0, 3).join(", ");
            current.matchedInterventionTitle = titles[0];
            if (!current.department.includes(supportArea)) {
                current.department = "Multi-area Support";
            }
            if (item.urgency === "urgent" || (item.urgency === "high" && current.urgency !== "urgent")) {
                current.urgency = item.urgency;
            }
        }
    });

    return Array.from(grouped.values());
};

const buildChat = (
    agent: SupportAgent,
    submission?: IntakeSubmission | null,
): ChatMessage[] => [
        {
            id: "intro",
            role: "agent",
            text: `Hi ${submission?.contactName || "there"}, I am the ${agent.name}. I can help with ${agent.focus}. Ask me about documents, next steps, blockers, or timelines.`,
            createdAt: "Today",
        },
    ];

const normalizeSupportAgent = (value: Partial<SupportAgent>, index: number): SupportAgent => {
    const category = value.category || categoryFromText(`${value.department} ${value.title} ${value.focus}`);
    const matchedInterventionTitles = Array.isArray(value.matchedInterventionTitles)
        ? value.matchedInterventionTitles.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        : value.matchedInterventionTitle
            ? [value.matchedInterventionTitle]
            : [];

    return {
        id: value.id || `${category}-${index}`,
        name: value.name || agentNameForCategory(category),
        title: value.title || `${agentNameForCategory(category).replace(" Agent", "")} Support`,
        category,
        department: value.department || "General Support",
        focus: value.focus || matchedInterventionTitles[0] || "Recommended support",
        intro: value.intro || "I can guide documents, questions, blockers and next steps for this roadmap.",
        requestedItems: Array.isArray(value.requestedItems) && value.requestedItems.length
            ? value.requestedItems
            : requestedItemsForCategory(category),
        matchedInterventionTitle: value.matchedInterventionTitle || matchedInterventionTitles[0],
        matchedInterventionTitles,
        urgency: value.urgency || "medium",
    };
};

/** One piece of the SME's real work, as the roadmap shows it (see smeWorkService). */
type RoadmapWork = SmeWork;

const SMEIntakeRoadmapPage: React.FC = () => {
    const { t } = useLanguage()
    const { activeProgramId, isAllPrograms } = useActiveProgramId();
    const { user } = useFullIdentity();

    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<IntakeSubmission[]>([]);
    const [selectedAgent, setSelectedAgent] = useState<SupportAgent | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatSending, setChatSending] = useState(false);
    const [ratingMessageId, setRatingMessageId] = useState<string>();
    const [agentAssignmentId, setAgentAssignmentId] = useState<string>();
    const [remoteAgents, setRemoteAgents] = useState<SupportAgent[]>([]);
    const [agentDocuments, setAgentDocuments] = useState<AgentDocument[]>([]);
    const [documentUploading, setDocumentUploading] = useState(false);
    const [work, setWork] = useState<RoadmapWork[]>([]);
    const [saved, setSaved] = useState<SavedSuggestions | null>(null);
    const [challenge, setChallenge] = useState("");
    const [generating, setGenerating] = useState(false);
    const [askOpen, setAskOpen] = useState(false);
    const [showDone, setShowDone] = useState(false);
    const [openedWork, setOpenedWork] = useState<RoadmapWork | null>(null);
    const navigate = useNavigate();

    const userEmail = (
        auth.currentUser?.email ||
        user?.email ||
        ""
    ).toLowerCase();
    const companyCode = user?.companyCode?.trim() || "";

    useEffect(() => {
        const loadSubmissions = async () => {
            try {
                setLoading(true);

                // Only the SME's own intakes: the ones they submitted or that name them as the contact. Never by
                // company, which would list every other SME in the same workspace (independent SMEs all share QTX).
                if (!userEmail) {
                    setRows([]);
                    return;
                }

                const base = collection(db, "smeIntakeSubmissions");
                const queriesToRun = [
                    query(base, where("contactEmail", "==", userEmail)),
                    query(base, where("createdByEmail", "==", userEmail)),
                ];

                const snaps = await Promise.all(
                    queriesToRun.map((item) => getDocs(item)),
                );
                const map = new Map<string, IntakeSubmission>();

                snaps.forEach((snap) => {
                    snap.docs.forEach((docSnap) => {
                        const data = docSnap.data() as Omit<IntakeSubmission, "id">;
                        if (
                            data.status === "temporary_draft" ||
                            (data as any).isTemporaryDraft
                        )
                            return;

                        map.set(docSnap.id, {
                            id: docSnap.id,
                            ...data,
                        });
                    });
                });

                const list = Array.from(map.values())
                    .filter((item) => {
                        if (activeProgramId && !isAllPrograms) {
                            const programId =
                                item.recommendedProgramId ||
                                item.decision?.recommendedProgramId ||
                                item.aiResult?.decision?.recommendedProgramId;
                            return programId === activeProgramId;
                        }
                        return true;
                    })
                    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

                setRows(list);

            } catch (error) {
                console.error("Failed to load SME intake submissions:", error);
                message.error(t('Failed to load AI intake roadmap.'));
                setRows([]);
            } finally {
                setLoading(false);
            }
        };

        loadSubmissions();
    }, [activeProgramId, isAllPrograms, userEmail, t]);

    // The SME's real work: interventions assigned to them, from a programme, a consultant's accepted plan, or an AI
    // agent. Read straight from assignedInterventions by their own ids, so applicants see it too.
    const loadWork = React.useCallback(async () => {
        if (!user) return;
        try {
            setWork(await loadSmeWork(user));
        } catch (error) {
            console.error("Failed to load roadmap work:", error);
            setWork([]);
        }
    }, [user]);

    useEffect(() => { void loadWork(); }, [loadWork]);

    // Steps the SME has already asked someone for (Find support's "Use this plan"), so they show as requested.
    const [requests, setRequests] = useState<ConnectionRequest[]>([]);
    useEffect(() => {
        if (!user?.uid) return;
        let active = true;
        listConnectionRequestsForSme(user.uid).then((rows) => { if (active) setRequests(rows); }).catch(() => undefined);
        return () => { active = false; };
    }, [user?.uid]);
    const requestedSteps = useMemo(() => {
        const byStep = new Map<string, ConnectionRequest>();
        requests.filter((row) => ["pending", "contacted", "proposed"].includes(row.status))
            .forEach((row) => (row.planSteps || []).forEach((step) => byStep.set(cleanDocumentKey(step), row)));
        return byStep;
    }, [requests]);

    // Suggestions the SME asked for, kept on their own account so they survive a reload.
    useEffect(() => {
        if (!user?.uid) return;
        let cancelled = false;
        loadSavedSuggestions(user.uid)
            .then((saved) => {
                if (!cancelled && saved) {
                    setSaved(saved);
                    setChallenge(saved.challenge || "");
                }
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [user?.uid]);

    const selectedSubmission = rows[0] || null;
    const decision = selectedSubmission?.decision || selectedSubmission?.aiResult?.decision;
    const activeWork = useMemo(() => work
        .filter((item) => item.state !== "done")
        .sort((left, right) => (toMillis(left.dueDate) || Number.MAX_SAFE_INTEGER) - (toMillis(right.dueDate) || Number.MAX_SAFE_INTEGER)), [work]);
    const doneWork = useMemo(() => work.filter((item) => item.state === "done"), [work]);
    // Suggestions they asked for; failing that, an older AI intake's recommendations. Anything already under way drops out.
    const suggestionsFromIntake = !saved?.items.length && Boolean(selectedSubmission);
    const suggestionItems = useMemo(() => {
        const taken = new Set(work.map((item) => cleanDocumentKey(item.title)));
        const source: RoadmapItem[] = saved?.items.length ? saved.items as RoadmapItem[] : buildRoadmap(selectedSubmission);
        return source.filter((item) => item.title && !taken.has(cleanDocumentKey(item.title))).slice(0, 4);
    }, [saved, selectedSubmission, work]);
    // What the agents are matched against: the work under way and the suggestions.
    const roadmap = useMemo<RoadmapItem[]>(() => [
        ...activeWork.map((item) => ({ title: item.title, department: item.area, areaOfSupport: item.area, progress: item.progress, dueDate: item.dueDate })),
        ...suggestionItems,
    ], [activeWork, suggestionItems]);
    const localAgents = useMemo(() => dedupeAgents([...(saved?.agents || []).map(normalizeSupportAgent), ...buildAgents(roadmap)]), [roadmap, saved]);
    const canUseMarketplace = user?.role === "incubatee" && user.isApplicant && user.smeJourney === "independent";

    const workStateText = (item: RoadmapWork) => {
        if (item.state === "done") return t("Done");
        if (item.state === "waiting_you") return item.waitingOn === "plan" ? t("Waiting for you to sign the plan") : t("Marked done, waiting for you to confirm");
        if (item.progress > 0) return t("{percent}% done", undefined, { percent: item.progress });
        return item.state === "in_progress" ? t("Started with the agent") : t("Not started yet");
    };

    const agentForWork = (item: RoadmapWork) =>
        agents.find((agent) => agent.id === item.assigneeId)
        || normalizeSupportAgent({ id: item.assigneeId, name: item.helperName, department: item.area, focus: item.title, matchedInterventionTitle: item.title }, 0);
    const agentForSuggestion = (item: RoadmapItem) =>
        agents.find((agent) => agent.matchedInterventionTitle === item.title || agent.matchedInterventionTitles?.includes(item.title))
        || normalizeSupportAgent({ department: item.department, focus: item.title, matchedInterventionTitle: item.title }, 0);

    // Applicants have no interventions page, so a consultant's work opens here; accepted SMEs go to their interventions.
    const openWork = (item: RoadmapWork) => {
        if (user?.isApplicant) setOpenedWork(item);
        else navigate("/incubatee/interventions");
    };

    /** The challenge and the business profile go to the AI; the suggestions are saved on the SME's own account. */
    const generateSuggestions = async () => {
        if (!user || !challenge.trim()) return;
        setGenerating(true);
        try {
            setSaved(await requestSuggestions(user, challenge, work.map((item) => item.title)));
            setAskOpen(false);
            message.success(t("Here are a few places to start."));
        } catch (error) {
            console.error("Roadmap suggestions failed:", error);
            message.error(t("Suggestions couldn’t be made just now. Try again in a moment."));
        } finally {
            setGenerating(false);
        }
    };


    useEffect(() => {
        let cancelled = false;

        const loadRemoteAgents = async () => {
            setRemoteAgents([]);
            if (!isAgentApiConfigured || !roadmap.length) return;

            try {
                const headers: Record<string, string> = { "Content-Type": "application/json", ...(await getAgentAuthHeaders()) };

                const response = await fetch(`${agentApiBaseUrl}/api/roadmap/agents`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        roadmap,
                        decision,
                        participant: selectedSubmission,
                    }),
                });

                if (!response.ok) throw new Error(`Roadmap agents failed with ${response.status}`);

                const payload = await response.json() as { agents?: Array<Partial<SupportAgent>> };
                const loadedAgents = Array.isArray(payload.agents)
                    ? dedupeAgents(payload.agents.map(normalizeSupportAgent))
                    : [];
                if (!cancelled) setRemoteAgents(loadedAgents);
            } catch (error) {
                console.error("Roadmap agents endpoint failed:", error);
                if (!cancelled) setRemoteAgents([]);
            }
        };

        void loadRemoteAgents();

        return () => {
            cancelled = true;
        };
    }, [decision, roadmap, selectedSubmission]);

    const agents = remoteAgents.length ? remoteAgents : localAgents;

    useEffect(() => {
        let cancelled = false;

        const loadDocuments = async () => {
            const intakeDocuments: AgentDocument[] = (selectedSubmission?.uploadedDocuments || []).map((item, index) => ({
                id: `intake-${index}`,
                type: item.type || item.name || "Intake document",
                fileName: item.name || item.type || "Uploaded document",
                url: item.url || null,
                source: "intake",
                currentStatus: "captured",
            }));

            const candidateIds = [
                user?.uid,
                selectedSubmission?.id,
                (selectedSubmission as Record<string, unknown> | null)?.participantId,
                (selectedSubmission as Record<string, unknown> | null)?.participantUid,
            ]
                .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
            const uniqueIds = [...new Set(candidateIds)];

            try {
                const snaps = await Promise.all(
                    uniqueIds.map((participantId) =>
                        getDocs(query(collection(db, "complianceDocuments"), where("participantId", "==", participantId))),
                    ),
                );
                const complianceDocuments = snaps.flatMap((snap) =>
                    snap.docs.map((docSnap) => {
                        const data = docSnap.data() as Record<string, unknown>;
                        return {
                            id: docSnap.id,
                            type: String(data.type || data.key || "Compliance document"),
                            fileName: typeof data.fileName === "string" ? data.fileName : null,
                            url: typeof data.url === "string" ? data.url : null,
                            source: "compliance" as const,
                            currentStatus: typeof data.currentStatus === "string" ? data.currentStatus : "pending",
                        };
                    }),
                );

                const docsByKey = new Map<string, AgentDocument>();
                [...intakeDocuments, ...complianceDocuments].forEach((item) => {
                    docsByKey.set(`${cleanDocumentKey(item.type)}-${cleanDocumentKey(item.fileName || "")}`, item);
                });
                if (!cancelled) setAgentDocuments(Array.from(docsByKey.values()));
            } catch (error) {
                console.error("Failed to load roadmap agent documents:", error);
                if (!cancelled) setAgentDocuments(intakeDocuments);
            }
        };

        void loadDocuments();

        return () => {
            cancelled = true;
        };
    }, [selectedSubmission, user?.uid]);

    const selectedAgentDocumentStatus = useMemo(() => {
        if (!selectedAgent) return [];
        return selectedAgent.requestedItems.map((item) => {
            const matches = agentDocuments.filter((document) => documentMatchesRequest(item, document));
            return { item, matches, ready: matches.length > 0 };
        });
    }, [agentDocuments, selectedAgent]);

    const handleAgentDocumentUpload = async (file: File, type: string) => {
        if (!selectedSubmission && !user) {
            message.error(t('Cannot upload without an active profile.'));
            return false;
        }

        try {
            setDocumentUploading(true);
            const participantId = String(
                (selectedSubmission as Record<string, unknown> | null)?.participantId ||
                (selectedSubmission as Record<string, unknown> | null)?.participantUid ||
                user?.uid ||
                selectedSubmission?.id ||
                "unknown",
            );
            const safeType = cleanDocumentKey(type).replace(/\s+/g, "-") || "document";
            const storagePath = `roadmap-agent-documents/${participantId}/${safeType}/${Date.now()}-${file.name}`;
            const fileRef = ref(storage, storagePath);
            await uploadBytes(fileRef, file);
            const url = await getDownloadURL(fileRef);
            const record = {
                participantId,
                intakeId: selectedSubmission?.id || null,
                programId: selectedSubmission?.recommendedProgramId || decision?.recommendedProgramId || null,
                companyCode: selectedSubmission?.companyCode || companyCode || null,
                type,
                key: safeType,
                fileName: file.name,
                url,
                currentStatus: "pending",
                source: "roadmap-agent",
                uploadedBy: user?.uid || auth.currentUser?.uid || null,
                uploadedByEmail: user?.email || auth.currentUser?.email || null,
                uploadedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            const docRef = await addDoc(collection(db, "complianceDocuments"), record);
            setAgentDocuments((current) => [
                ...current,
                {
                    id: docRef.id,
                    type,
                    fileName: file.name,
                    url,
                    source: "compliance",
                    currentStatus: "pending",
                },
            ]);
            message.success(`Uploaded ${type}`);
        } catch (error) {
            console.error("Failed to upload roadmap agent document:", error);
            message.error(t('Document upload failed.'));
        } finally {
            setDocumentUploading(false);
        }

        return false;
    };
    const openAgent = (agent: SupportAgent) => {
        setSelectedAgent(agent);
        setChatMessages(buildChat(agent, selectedSubmission));
        setAgentAssignmentId(undefined);
    };

    const agentInterventionId = (agent: SupportAgent) => cleanDocumentKey(agent.matchedInterventionTitle || agent.focus || agent.id);

    const recordAgentDelivery = async (agent: SupportAgent) => {
        // The SME's own uid, so the work is theirs (the rule only lets an SME start agent work on themselves).
        const participantId = String(user?.uid || '');
        if (!participantId) return;
        const interventionId = agentInterventionId(agent);
        const programmeId = selectedSubmission?.recommendedProgramId || selectedSubmission?.decision?.recommendedProgramId || activeProgramId;
        const deliveryProgramId = programmeId && programmeId !== 'all' ? programmeId : null;
        let assignmentId = agentAssignmentId;

        if (!assignmentId) {
            const snapshot = await getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', participantId)));
            const existing = snapshot.docs.find((item) => {
                const data = item.data();
                return data.deliveryActorType === 'agent' && data.interventionId === interventionId && (data.programId || null) === deliveryProgramId;
            });
            if (existing) {
                assignmentId = existing.id;
            } else {
                const created = await addDoc(collection(db, 'assignedInterventions'), {
                    companyCode: workspaceCompanyCode(user) || null,
                    participantId,
                    applicationId: selectedSubmission?.id || null,
                    interventionId,
                    interventionTitle: agent.matchedInterventionTitle || agent.focus,
                    areaOfSupport: agent.department || null,
                    businessName: selectedSubmission?.contactName || user?.displayName || 'SME',
                    programId: deliveryProgramId,
                    programName: deliveryProgramId ? selectedSubmission?.recommendedProgramName || null : null,
                    source: 'roadmap_agent',
                    assigneeId: agent.id,
                    assigneeName: agent.name,
                    assigneeType: 'agent',
                    deliveryActorType: 'agent',
                    status: 'in-progress',
                    assigneeStatus: 'accepted',
                    participantStatus: 'accepted',
                    assigneeCompletionStatus: 'pending',
                    participantCompletionStatus: 'pending',
                    progress: 0,
                    agentConversationCount: 0,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                assignmentId = created.id;
            }
            setAgentAssignmentId(assignmentId);
        }

        await updateDoc(doc(db, 'assignedInterventions', assignmentId), {
            agentConversationCount: increment(1),
            lastAgentConversationAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    };

    const rateDeliveryConversation = async (item: ChatMessage, rating: number) => {
        if (!selectedAgent || !user || !rating || item.rating) return;
        try {
            setRatingMessageId(item.id);
            await addDoc(collection(db, 'agentConversationRatings'), {
                messageId: item.id,
                assignmentId: agentAssignmentId || null,
                agentId: selectedAgent.id,
                agentName: selectedAgent.name,
                agentType: 'intervention',
                channel: 'web',
                participantId: user.uid,
                programId: selectedSubmission?.recommendedProgramId || selectedSubmission?.decision?.recommendedProgramId || activeProgramId,
                interventionTitle: selectedAgent.matchedInterventionTitle || selectedAgent.focus,
                rating,
                companyCode: companyCode || null,
                createdAt: serverTimestamp(),
            });
            setChatMessages((current) => current.map((messageItem) => messageItem.id === item.id ? { ...messageItem, rating } : messageItem));
            message.success(t('Agent conversation rated.'));
        } catch {
            message.error(t('The agent rating could not be saved.'));
        } finally {
            setRatingMessageId(undefined);
        }
    };

    const closeAgent = () => {
        if (chatMessages.some((item) => item.requiresRating && !item.rating)) {
            message.warning(t('Rate the latest agent conversation before closing.'));
            return;
        }
        setSelectedAgent(null);
        // Talking to an agent can start a piece of work; show it under way.
        void loadWork();
    };

    const fallbackAgentReply = (agent: SupportAgent, userMessage: string) => {
        const text = userMessage.trim().toLowerCase();
        const focus = agent.matchedInterventionTitle || agent.focus;
        const ready = selectedAgentDocumentStatus.filter((item) => item.ready).map((item) => item.item);
        const missing = selectedAgentDocumentStatus.filter((item) => !item.ready).map((item) => item.item);
        const requested = missing.slice(0, 3).join(", ") || agent.requestedItems.slice(0, 3).join(", ");

        if (/^(hi|hie|hello|hey|sawubona|dumelang|avuxeni)\b/.test(text)) {
            return `Hi, I am the ${agent.name}. I can help you with ${focus}. To start, tell me what you already have ready and what is blocking you.`;
        }

        if (text.includes("document") || text.includes("prepare") || text.includes("need")) {
            if (ready.length && missing.length) {
                return `I can see these are already uploaded: ${ready.join(", ")}. Still outstanding for ${focus}: ${missing.slice(0, 3).join(", ")}. You can upload missing files from this chat panel.`;
            }
            if (ready.length && !missing.length) {
                return `I can see the requested documents for ${focus} are already uploaded. The next step is to review quality, dates, and any verification feedback.`;
            }
            return `For ${focus}, please prepare these first: ${requested}. If one is missing, tell me which one and I will help you work through the next step.`;
        }

        if (text.includes("next") || text.includes("start") || text.includes("first")) {
            return `The first step is to confirm your current status for ${focus}. After that, we can list missing evidence, assign the next action, and track progress against the roadmap.`;
        }

        return `Thanks, I have noted that for ${focus}. What specific help do you need next: documents, requirements, timeline, or a blocker?`;
    };

    const sendChat = async () => {
        const value = chatInput.trim();
        if (!value || !selectedAgent) return;
        if (chatMessages.some((item) => item.requiresRating && !item.rating)) {
            message.warning(t('Rate the previous agent conversation before continuing.'));
            return;
        }
        const isGreeting = /^(hi|hie|hello|hey|sawubona|dumelang|avuxeni)\b/i.test(value);

        const userTurn: ChatMessage = {
            id: `sme-${Date.now()}`,
            role: "sme",
            text: value,
            createdAt: "Now",
        };

        setChatInput("");
        setChatMessages((current) => [...current, userTurn]);
        setChatSending(true);

        try {
            const matchedRoadmapItem = roadmap.find(
                (item) =>
                    item.title === selectedAgent.matchedInterventionTitle ||
                    selectedAgent.matchedInterventionTitles?.includes(item.title) ||
                    item.title === selectedAgent.focus,
            );
            let reply = fallbackAgentReply(selectedAgent, value);

            if (isAgentApiConfigured) {
                const headers: Record<string, string> = { "Content-Type": "application/json", ...(await getAgentAuthHeaders()) };

                const response = await fetch(`${agentApiBaseUrl}/api/roadmap/agent-chat`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        agent: selectedAgent,
                        roadmapItem: matchedRoadmapItem,
                        participant: selectedSubmission,
                        documents: agentDocuments,
                        documentStatus: selectedAgentDocumentStatus,
                        message: value,
                        history: chatMessages.map((item) => ({
                            role: item.role,
                            content: item.text,
                        })),
                    }),
                });

                if (response.ok) {
                    const payload = await response.json() as { reply?: string };
                    const apiReply = payload.reply?.trim();
                    const staleReply = apiReply && (
                        apiReply.includes("Please prepare these first") ||
                        apiReply.includes("Noted. I will use this")
                    );
                    reply = apiReply && !(isGreeting && staleReply) ? apiReply : reply;
                }
            }

            const agentTurn: ChatMessage = {
                id: `agent-${Date.now()}`,
                role: "agent",
                text: reply,
                createdAt: "Now",
                requiresRating: true,
            };
            setChatMessages((current) => [
                ...current,
                agentTurn,
            ]);
            void recordAgentDelivery(selectedAgent).catch((error) => console.error('Agent delivery could not be recorded:', error));
        } catch (error) {
            console.error("Roadmap agent chat failed:", error);
            setChatMessages((current) => [
                ...current,
                {
                    id: `agent-${Date.now()}`,
                    role: "agent",
                    text: fallbackAgentReply(selectedAgent, value),
                    createdAt: "Now",
                    requiresRating: true,
                },
            ]);
        } finally {
            setChatSending(false);
        }
    };

    if (loading) {
        return <PageSkeleton variant="detail" label={t('Loading your roadmap')} />
    }

    const doneCount = doneWork.length
    const totalCount = activeWork.length + doneCount
    const nextUp = activeWork.find((item) => item.state !== 'waiting_you') || activeWork[0]
    const summary = totalCount
        ? [
            t('{done} of {total} done', undefined, { done: doneCount, total: totalCount }),
            nextUp && (nextUp.dueDate
                ? t('next: {title}, due {date}', undefined, { title: nextUp.title, date: formatDate(nextUp.dueDate) })
                : t('next: {title}', undefined, { title: nextUp.title })),
        ].filter(Boolean).join(' · ')
        : t('Your roadmap fills in as you get support.')
    const nothingYet = !totalCount && !suggestionItems.length

    const challengeForm = (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Input.TextArea
                rows={3}
                maxLength={800}
                value={challenge}
                onChange={(event) => setChallenge(event.target.value)}
                placeholder={t('For example: we keep running out of cash at month end, and we don’t know our real costs.')}
            />
            <Text type="secondary" style={{ fontSize: 12.5 }}>{t('AI uses this and your business profile to suggest a few steps. Nothing is booked until you choose how to get help.')}</Text>
            <Button type="primary" icon={<BulbOutlined />} loading={generating} disabled={!challenge.trim()} onClick={() => void generateSuggestions()}>
                {t('Suggest where to start')}
            </Button>
        </Space>
    )

    const workRow = (item: RoadmapWork) => (
        <div key={item.id} className="roadmap-row">
            <span className={`roadmap-dot is-${item.state}`} aria-hidden="true" />
            <div className="roadmap-row-text">
                <Text strong>{item.title}</Text>
                <Text type="secondary">{[workStateText(item), item.dueDate && t('due {date}', undefined, { date: formatDate(item.dueDate) })].filter(Boolean).join(' · ')}</Text>
                {item.helperName && (
                    <Text type="secondary" className="roadmap-helper">
                        {item.helperType === 'agent' ? <RobotOutlined /> : <UserOutlined />} {item.helperType === 'agent' ? t('{name}, AI agent', undefined, { name: item.helperName }) : t('{name}, consultant', undefined, { name: item.helperName })}
                    </Text>
                )}
            </div>
            {item.state !== 'done' && (item.helperType === 'agent'
                ? <Button type="primary" size="small" onClick={() => openAgent(agentForWork(item))}>{t('Continue')}</Button>
                : <Button size="small" onClick={() => openWork(item)}>{t('Open')}</Button>)}
        </div>
    )

    return (
        <DashboardPage className="sme-roadmap-page roadmap-v2">
            <Helmet>
                <title>{t('Roadmap | Smart Incubation')}</title>
            </Helmet>

            <section className="roadmap-head">
                <div className="roadmap-head-row">
                    <div className="roadmap-head-text">
                        <Text strong className="roadmap-title">{t('Your growth roadmap')}</Text>
                        <Text type="secondary">{summary}</Text>
                    </div>
                    {!nothingYet && <Button icon={<BulbOutlined />} onClick={() => setAskOpen(true)}>{t('Suggest what’s next')}</Button>}
                </div>
                {totalCount > 0 && <Progress percent={Math.round((doneCount / totalCount) * 100)} showInfo={false} strokeColor="#6d5dfb" size="small" />}
            </section>

            {nothingYet && (
                <Card className="roadmap-card" title={t('What’s holding the business back?')}>
                    {challengeForm}
                    {canUseMarketplace && (
                        <div className="roadmap-or">
                            <Text type="secondary">{t('Or go straight to help')}</Text>
                            <Button onClick={() => navigate('/applicant/marketplace')}>{t('Find support')}</Button>
                        </div>
                    )}
                </Card>
            )}

            {activeWork.length > 0 && (
                <Card className="roadmap-card" title={t('Under way')} extra={<Text type="secondary" className="roadmap-card-note">{t('Progress from your consultants and agents')}</Text>}>
                    {activeWork.map(workRow)}
                </Card>
            )}

            {suggestionItems.length > 0 && (
                <Card
                    className="roadmap-card"
                    title={<Space size={8}>{t('Suggested next')}<Tag bordered={false} color="purple">{t('AI suggestion')}</Tag></Space>}
                    extra={<Text type="secondary" className="roadmap-card-note">{suggestionsFromIntake ? t('From your earlier intake') : t('From your business profile')}</Text>}
                >
                    <div className="roadmap-suggestions">
                        {suggestionItems.map((item, index) => (
                            <div key={`${item.title}-${index}`} className="roadmap-suggestion">
                                <Text strong>{item.title}</Text>
                                <Text type="secondary">{item.reason || item.expectedImpact}</Text>
                                {(() => {
                                    // Already asked someone for this step (Find support's "Use this plan"): show who, not the options again.
                                    const request = requestedSteps.get(cleanDocumentKey(item.title));
                                    return request ? (
                                        <div className="roadmap-suggestion-actions">
                                            <Tag bordered={false} color="gold" style={{ margin: 0 }}>{t('Requested from {name}', undefined, { name: request.targetName })}</Tag>
                                            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/applicant/marketplace?view=requests&request=${request.id}`)}>{t('View request')}</Button>
                                        </div>
                                    ) : (
                                        <div className="roadmap-suggestion-actions">
                                            {isAgentApiConfigured && <Button size="small" icon={<RobotOutlined />} onClick={() => openAgent(agentForSuggestion(item))}>{t('Do it with an agent')}</Button>}
                                            {canUseMarketplace && <Button size="small" icon={<TeamOutlined />} onClick={() => navigate(`/applicant/marketplace?q=${encodeURIComponent(item.department || item.title)}`)}>{t('Find a consultant')}</Button>}
                                        </div>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {doneWork.length > 0 && (
                <Card
                    className="roadmap-card"
                    title={<Space size={8}><CheckCircleOutlined className="roadmap-done-icon" />{t('Done ({count})', undefined, { count: doneWork.length })}</Space>}
                    extra={<Button type="link" size="small" onClick={() => setShowDone((current) => !current)}>{showDone ? t('Hide') : t('Show')}</Button>}
                >
                    {showDone ? doneWork.map(workRow) : null}
                </Card>
            )}

            <ResponsiveModal
                open={askOpen}
                onClose={() => setAskOpen(false)}
                title={t('What’s holding the business back now?')}
                width={520}
                centered
            >
                {challengeForm}
            </ResponsiveModal>

            {/* A consultant's work, for applicants who have no interventions page: what it is, who's on it, where it stands. */}
            <ResponsiveModal open={!!openedWork} onClose={() => setOpenedWork(null)} title={openedWork?.title} width={480} centered>
                {openedWork && (
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Text>{workStateText(openedWork)}</Text>
                        {openedWork.helperName && <Text type="secondary"><UserOutlined /> {t('{name}, consultant', undefined, { name: openedWork.helperName })}</Text>}
                        {openedWork.dueDate && <Text type="secondary">{t('Due {date}', undefined, { date: formatDate(openedWork.dueDate) })}</Text>}
                        {openedWork.progress > 0 && <Progress percent={openedWork.progress} size="small" strokeColor="#6d5dfb" />}
                        {openedWork.note && <Paragraph type="secondary" style={{ marginBottom: 0 }}>“{openedWork.note}”</Paragraph>}
                    </Space>
                )}
            </ResponsiveModal>

            <ResponsiveModal
                title={selectedAgent?.name || t('Agent Chat')}
                open={!!selectedAgent}
                onClose={closeAgent}
                width={600}
                centered
            >
                {selectedAgent ? (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                        <Alert
                            type="info"
                            showIcon
                            message={selectedAgent.title}
                            description={`Matched to intervention: ${selectedAgent.matchedInterventionTitle || selectedAgent.focus}`}
                        />

                        <Card
                            size="small"
                            title={t('Requested Documents')}
                            style={{ borderRadius: 16 }}
                        >
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                {selectedAgentDocumentStatus.map((row) => (
                                    <div key={row.item} className="agent-document-row">
                                        <Space direction="vertical" size={2}>
                                            <Space wrap>
                                                <Text strong>{row.item}</Text>
                                                <Tag color={row.ready ? "green" : "orange"}>
                                                    {row.ready ? t('Uploaded') : t('Missing')}
                                                </Tag>
                                            </Space>
                                            {row.matches.length ? (
                                                <Text type="secondary">
                                                    {row.matches.map((item) => item.fileName || item.type).join(", ")}
                                                </Text>
                                            ) : (
                                                <Text type="secondary">{t('No matching file found yet.')}</Text>
                                            )}
                                        </Space>
                                        <Upload
                                            showUploadList={false}
                                            beforeUpload={(file) => {
                                                void handleAgentDocumentUpload(file as File, row.item);
                                                return false;
                                            }}
                                            disabled={documentUploading}
                                        >
                                            <Button size="small" icon={<InboxOutlined />} loading={documentUploading}>
                                                {t('Upload')}
                                            </Button>
                                        </Upload>
                                    </div>
                                ))}
                            </Space>
                        </Card>

                        <div className="chat-box">
                            {chatMessages.map((item) => (
                                <div key={item.id} className={`chat-bubble-row ${item.role}`}>
                                    <div className={`chat-bubble ${item.role}`}>
                                        <Text>{item.text}</Text>
                                        <div>
                                            <Text type="secondary" style={{ fontSize: 11 }}>
                                                {item.createdAt}
                                            </Text>
                                        </div>
                                        {item.requiresRating && (
                                            <div className="delivery-agent-rating">
                                                <Text type="secondary">{item.rating ? t('Conversation rated') : t('Rate this conversation to continue')}</Text>
                                                <Rate disabled={!!item.rating || ratingMessageId === item.id} value={item.rating || 0} onChange={(value) => void rateDeliveryConversation(item, value)} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <Space.Compact style={{ width: "100%" }}>
                            <TextArea
                                autoSize={{ minRows: 1, maxRows: 4 }}
                                value={chatInput}
                                disabled={chatSending}
                                onChange={(event) => setChatInput(event.target.value)}
                                placeholder={t('Type what support is needed...')}
                                onPressEnter={(event) => {
                                    if (!event.shiftKey) {
                                        event.preventDefault();
                                        void sendChat();
                                    }
                                }}
                            />
                            <Button
                                type="primary"
                                icon={<SendOutlined />}
                                loading={chatSending}
                                disabled={!chatInput.trim()}
                                onClick={() => void sendChat()}
                            />
                        </Space.Compact>
                    </Space>
                ) : null}
            </ResponsiveModal>

            <style>{`
                .roadmap-step-card {
                    border-radius: 16px;
                    border: 1px solid #e6f4ff;
                    animation: roadmapEnter .28s ease both;
                }

                .agent-card {
                    min-height: 330px;
                    height: 100%;
                    border-radius: 24px;
                    padding: 22px;
                    background: linear-gradient(180deg,#ffffff 0%,#fbfdff 100%);
                    border: 1px solid #e5e7eb;
                    box-shadow: 0 12px 28px rgba(15,23,42,.08);
                    cursor: pointer;
                    transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
                    position: relative;
                    overflow: hidden;
                    animation: roadmapEnter .28s ease both;
                }

                .agent-card:hover {
                    transform: translateY(-6px);
                    box-shadow: 0 22px 48px rgba(15,23,42,.16);
                    border-color: #91caff;
                }

                .agent-card:active {
                    transform: scale(.98);
                }

                .agent-card-top,
                .agent-card-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                }

                .agent-card-footer {
                    margin-top: 20px;
                    padding-top: 16px;
                    border-top: 1px solid #f0f0f0;
                }

                .agent-avatar {
                    display: grid;
                    place-items: center;
                    font-size: 24px;
                }

                .agent-avatar.compliance { background: #e6f4ff; color: #1677ff; }
                .agent-avatar.finance { background: #f6ffed; color: #389e0d; }
                .agent-avatar.market { background: #f9f0ff; color: #722ed1; }
                .agent-avatar.operations { background: #f0f5ff; color: #2f54eb; }
                .agent-avatar.training { background: #fff7e6; color: #d46b08; }
                .agent-avatar.general { background: #f5f5f5; color: #595959; }

                .agent-document-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    padding: 10px 0;
                    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
                }

                .agent-document-row:last-child {
                    border-bottom: 0;
                }

                .chat-box {
                    min-height: 320px;
                    max-height: 420px;
                    overflow-y: auto;
                    padding: 14px;
                    border-radius: 18px;
                    background: #f8fafc;
                    border: 1px solid #e5e7eb;
                }

                .chat-bubble-row {
                    display: flex;
                    margin-bottom: 12px;
                }

                .chat-bubble-row.sme {
                    justify-content: flex-end;
                }

                .chat-bubble {
                    max-width: 82%;
                    padding: 10px 12px;
                    border-radius: 16px;
                    animation: roadmapEnter .2s ease both;
                }

                .chat-bubble.agent {
                    background: #ffffff;
                    border: 1px solid #e5e7eb;
                }

                .chat-bubble.sme {
                    background: #e6f4ff;
                    border: 1px solid #91caff;
                }
                .delivery-agent-rating {
                    display: grid;
                    gap: 4px;
                    margin-top: 9px;
                    padding-top: 8px;
                    border-top: 1px solid rgba(109, 93, 251, .16);
                }

                @keyframes roadmapEnter {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @media (max-width: 767px) {
                    .agent-card {
                        min-height: unset;
                        padding: 18px;
                    }

                    .agent-card-footer {
                        align-items: stretch;
                        flex-direction: column;
                    }
                }
            `}</style>
        </DashboardPage>
    );
};

export default SMEIntakeRoadmapPage;

