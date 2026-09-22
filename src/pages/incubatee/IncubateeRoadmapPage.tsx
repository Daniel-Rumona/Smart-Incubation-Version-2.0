import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Avatar,
    Badge,
    Button,
    Card,
    Col,
    Collapse,
    Drawer,
    Empty,
    Grid,
    Input,
    List,
    Progress,
    Rate,
    Row,
    Segmented,
    Select,
    Space,
    Statistic,
    Tag,
    Timeline,
    Typography,
    Upload,
    message,
} from "antd";
import type { CollapseProps } from "antd";
import {
    AuditOutlined,
    BankOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    FileProtectOutlined,
    FundProjectionScreenOutlined,
    InboxOutlined,
    MessageOutlined,
    ProjectOutlined,
    RiseOutlined,
    SafetyCertificateOutlined,
    SearchOutlined,
    SendOutlined,
    TeamOutlined,
    ThunderboltOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { Helmet } from "react-helmet";
import Highcharts from "highcharts";
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
import { MotionCard } from "@/components/shared/Header";
import { LoadingOverlay } from "@/components/shared/LoadingOverlay";
import DashboardHeader from "@/components/shared/DashboardHeader";
import { ThemedHighcharts } from "@/components/shared/ThemedHighcharts";
import { agentApiBaseUrl, isAgentApiConfigured } from "@/config/agent";
import { getAgentAuthHeaders } from "@/services/agentAuth";

import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { loadIncubateeWorkspace } from "@/services/incubateeWorkspaceService";
import type { IncubateeIntervention, IncubateeWorkspace } from "@/types/incubatee";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { useBreakpoint } = Grid;

type ViewMode = "roadmap" | "projections" | "agents" | "history";
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

const stageLabel = (stage?: string | null) => {
    const labels: Record<string, string> = {
        idea: "Idea Stage",
        startup: "Startup",
        early_growth: "Early Growth",
        struggling: "Struggling",
        scaling: "Scaling",
        market_ready: "Market Ready",
    };

    return labels[stage || ""] || "Not classified";
};

const statusLabel = (status?: string) => {
    const labels: Record<string, string> = {
        program_recommended: "Programme Recommended",
        agent_help_requested: "Agent Support Requested",
        temporary_draft: "Draft",
    };

    return labels[status || ""] || "Submitted";
};

const urgencyColor = (level?: string | null) => {
    if (level === "urgent") return "red";
    if (level === "high") return "volcano";
    if (level === "medium") return "gold";
    if (level === "low") return "green";
    return "default";
};

const riskColor = (level?: string | null) => {
    if (level === "high") return "red";
    if (level === "medium") return "gold";
    if (level === "low") return "green";
    return "default";
};

const categoryColor = (category: AgentCategory) => {
    const colors: Record<AgentCategory, string> = {
        compliance: "blue",
        finance: "green",
        market: "purple",
        operations: "geekblue",
        training: "orange",
        general: "default",
    };

    return colors[category];
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

const urgencyFromDueDate = (dueDate?: FirestoreDate): UrgencyLevel => {
    const millis = toMillis(dueDate);
    if (!millis) return "medium";
    const days = Math.ceil((millis - Date.now()) / 86400000);
    if (days <= 7) return "urgent";
    if (days <= 21) return "high";
    if (days <= 45) return "medium";
    return "low";
};

const roadmapStatusFromIntervention = (status: IncubateeIntervention["status"]): RoadmapItem["status"] => {
    if (status === "Completed") return "completed";
    if (status === "Declined" || status === "Rejected") return "blocked";
    if (status === "In Progress" || status === "Awaiting Confirmation" || status === "Awaiting Your Acceptance") return "in_progress";
    return "not_started";
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

const iconForCategory = (category: AgentCategory) => {
    if (category === "compliance") return <SafetyCertificateOutlined />;
    if (category === "finance") return <BankOutlined />;
    if (category === "market") return <RiseOutlined />;
    if (category === "operations") return <ProjectOutlined />;
    if (category === "training") return <TeamOutlined />;
    return <UserOutlined />;
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

const buildWorkspaceRoadmap = (workspace?: IncubateeWorkspace | null): RoadmapItem[] => {
    if (!workspace?.assignedInterventions.length) return [];

    return [...workspace.assignedInterventions]
        .sort((left, right) => {
            const leftStatus = roadmapStatusFromIntervention(left.status);
            const rightStatus = roadmapStatusFromIntervention(right.status);
            const statusRank: Record<NonNullable<RoadmapItem["status"]>, number> = {
                in_progress: 0,
                not_started: 1,
                blocked: 2,
                completed: 3,
            };
            const statusDelta = statusRank[leftStatus || "not_started"] - statusRank[rightStatus || "not_started"];
            if (statusDelta) return statusDelta;
            return (toMillis(left.dueDate) || Number.MAX_SAFE_INTEGER) - (toMillis(right.dueDate) || Number.MAX_SAFE_INTEGER);
        })
        .map((item) => {
            const status = roadmapStatusFromIntervention(item.status);
            const urgency = urgencyFromDueDate(item.dueDate);
            return {
                title: item.title,
                interventionId: item.interventionId,
                areaOfSupport: item.areaOfSupport || "General Support",
                department: item.areaOfSupport || "General Support",
                urgency,
                reason: item.assigneeName
                    ? `Assigned to ${item.assigneeName}${item.dueDate ? `, due ${formatDate(item.dueDate)}` : ""}.`
                    : item.status === "Pending Assignment"
                        ? "Confirmed in the diagnostic plan and awaiting assignment."
                        : "Confirmed in the diagnostic plan.",
                status,
                estimatedWeeks: item.dueDate
                    ? Math.max(1, Math.ceil((toMillis(item.dueDate) - Date.now()) / 604800000))
                    : weeksFromUrgency(urgency),
                progress: item.progress || (status === "completed" ? 100 : status === "in_progress" ? 35 : 0),
                expectedImpact: `Move ${item.areaOfSupport || "support"} work forward through the confirmed growth plan.`,
                targetOutcome: item.dueDate ? `Complete by ${formatDate(item.dueDate)}.` : "Complete the assigned intervention and capture progress evidence.",
                dueDate: item.dueDate,
                source: item.id.startsWith("unassigned-") ? "diagnostic_plan" : "assignment",
            } satisfies RoadmapItem;
        });
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

const SMEIntakeRoadmapPage: React.FC = () => {
    const screens = useBreakpoint();
    const { activeProgramId, isAllPrograms } = useActiveProgramId();
    const { user } = useFullIdentity();

    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<IntakeSubmission[]>([]);
    const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>();
    const [view, setView] = useState<ViewMode>("roadmap");
    const [search, setSearch] = useState("");
    const [selectedAgent, setSelectedAgent] = useState<SupportAgent | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatSending, setChatSending] = useState(false);
    const [ratingMessageId, setRatingMessageId] = useState<string>();
    const [agentAssignmentId, setAgentAssignmentId] = useState<string>();
    const [remoteAgents, setRemoteAgents] = useState<SupportAgent[]>([]);
    const [agentDocuments, setAgentDocuments] = useState<AgentDocument[]>([]);
    const [documentUploading, setDocumentUploading] = useState(false);
    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>(null);

    const userEmail = (
        auth.currentUser?.email ||
        user?.email ||
        ""
    ).toLowerCase();
    const companyCode = user?.companyCode?.trim() || "";
    const isMobile = !screens.md;

    useEffect(() => {
        const loadSubmissions = async () => {
            try {
                setLoading(true);

                if (!companyCode && !userEmail) {
                    setRows([]);
                    return;
                }

                const base = collection(db, "smeIntakeSubmissions");
                const queriesToRun = [];

                if (companyCode) {
                    queriesToRun.push(
                        query(
                            base,
                            where("companyCode", "==", companyCode),
                            // orderBy("createdAt", "desc"),
                        ),
                    );
                }

                if (userEmail) {
                    queriesToRun.push(
                        query(
                            base,
                            where("contactEmail", "==", userEmail),
                            // orderBy("createdAt", "desc"),
                        ),
                    );
                    queriesToRun.push(
                        query(
                            base,
                            where("createdByEmail", "==", userEmail),
                            // orderBy("createdAt", "desc"),
                        ),
                    );
                }

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
                setSelectedSubmissionId((current) => current || list[0]?.id);
            } catch (error) {
                console.error("Failed to load SME intake submissions:", error);
                message.error("Failed to load AI intake roadmap.");
                setRows([]);
            } finally {
                setLoading(false);
            }
        };

        loadSubmissions();
    }, [activeProgramId, companyCode, isAllPrograms, userEmail]);

    useEffect(() => {
        let cancelled = false;

        const loadWorkspace = async () => {
            if (!user || user.isApplicant) {
                setWorkspace(null);
                return;
            }

            try {
                const loaded = await loadIncubateeWorkspace(user);
                if (!cancelled) setWorkspace(loaded);
            } catch (error) {
                console.error("Failed to load incubatee workspace roadmap:", error);
                if (!cancelled) setWorkspace(null);
            }
        };

        void loadWorkspace();

        return () => {
            cancelled = true;
        };
    }, [user]);

    const selectedSubmission = useMemo(() => {
        return (
            rows.find((item) => item.id === selectedSubmissionId) || rows[0] || null
        );
    }, [rows, selectedSubmissionId]);

    const decision =
        selectedSubmission?.decision || selectedSubmission?.aiResult?.decision;
    const workspaceRoadmap = useMemo(() => buildWorkspaceRoadmap(workspace), [workspace]);
    const roadmap = useMemo(
        () => workspaceRoadmap.length ? workspaceRoadmap : buildRoadmap(selectedSubmission),
        [selectedSubmission, workspaceRoadmap],
    );
    const localAgents = useMemo(() => dedupeAgents(buildAgents(roadmap)), [roadmap]);

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

    const filteredAgents = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return agents;

        return agents.filter((agent) => {
            return [
                agent.name,
                agent.title,
                agent.department,
                agent.focus,
                agent.category,
            ]
                .join(" ")
                .toLowerCase()
                .includes(needle);
        });
    }, [agents, search]);

    const totalWeeks = roadmap.reduce(
        (sum, item) => sum + (item.estimatedWeeks || 0),
        0,
    );
    const averageProgress = roadmap.length
        ? Math.round(
            roadmap.reduce((sum, item) => sum + (item.progress || 0), 0) /
            roadmap.length,
        )
        : 0;
    const completedCount = roadmap.filter(
        (item) => item.status === "completed",
    ).length;
    const estimatedFinishDate = useMemo(() => {
        const dueDates = roadmap.map((item) => toMillis(item.dueDate)).filter(Boolean);
        if (dueDates.length) return formatDate(Math.max(...dueDates));
        if (!selectedSubmission || !totalWeeks) return "Not available";
        const start = toMillis(selectedSubmission.createdAt) || Date.now();
        const finish = new Date(start);
        finish.setDate(finish.getDate() + totalWeeks * 7);
        return formatDate(finish);
    }, [roadmap, selectedSubmission, totalWeeks]);

    const selectedAgentDocumentStatus = useMemo(() => {
        if (!selectedAgent) return [];
        return selectedAgent.requestedItems.map((item) => {
            const matches = agentDocuments.filter((document) => documentMatchesRequest(item, document));
            return { item, matches, ready: matches.length > 0 };
        });
    }, [agentDocuments, selectedAgent]);

    const handleAgentDocumentUpload = async (file: File, type: string) => {
        if (!selectedSubmission && !user) {
            message.error("Cannot upload without an active profile.");
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
            message.error("Document upload failed.");
        } finally {
            setDocumentUploading(false);
        }

        return false;
    };

    const impactChartOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "column", backgroundColor: "transparent", height: 320 },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            xAxis: {
                categories: roadmap.map((item) => item.title),
                labels: { style: { fontSize: "11px" } },
            },
            yAxis: {
                min: 0,
                max: 100,
                title: { text: "Expected Impact / Progress" },
                labels: { format: "{value}%" },
            },
            tooltip: { pointFormat: "<b>{point.y}%</b>" },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        format: "{point.y}%",
                        crop: false,
                        overflow: "allow",
                    },
                },
            },
            series: [
                {
                    type: "column",
                    name: "Impact",
                    data: roadmap.map((item) =>
                        Math.max(
                            35,
                            item.progress ||
                            (item.urgency === "urgent"
                                ? 90
                                : item.urgency === "high"
                                    ? 75
                                    : item.urgency === "medium"
                                        ? 60
                                        : 45),
                        ),
                    ),
                },
            ],
        }),
        [roadmap],
    );

    const projectionSplineOptions: Highcharts.Options = useMemo(() => {
        const cumulative = roadmap.reduce<number[]>((acc, item, index) => {
            const previous = acc[index - 1] || 0;
            const impact =
                item.urgency === "urgent" ? 28 :
                    item.urgency === "high" ? 22 :
                        item.urgency === "medium" ? 16 : 10;

            acc.push(Math.min(100, previous + impact));
            return acc;
        }, []);

        return {
            chart: { type: "spline", backgroundColor: "transparent", height: 340 },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            xAxis: {
                categories: roadmap.map((_, index) => `Step ${index + 1}`),
            },
            yAxis: {
                min: 0,
                max: 100,
                title: { text: "Projected Readiness" },
                labels: { format: "{value}%" },
            },
            tooltip: {
                pointFormat: "<b>{point.y}% readiness</b>",
            },
            plotOptions: {
                spline: {
                    marker: {
                        enabled: true,
                        radius: 5,
                    },
                    dataLabels: {
                        enabled: true,
                        format: "{point.y}%",
                        crop: false,
                        overflow: "allow",
                    },
                },
            },
            series: [
                {
                    type: "spline",
                    name: "Projected Readiness",
                    data: cumulative,
                },
            ],
        };
    }, [roadmap]);

    const radarOptions: Highcharts.Options = useMemo(() => {
        const categories = roadmap.map(item => item.department || "General");

        return {
            chart: {
                polar: true,
                type: "line",
                backgroundColor: "transparent",
                height: 360,
            },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            pane: { size: "75%" },
            xAxis: {
                categories,
                tickmarkPlacement: "on",
                lineWidth: 0,
            },
            yAxis: {
                gridLineInterpolation: "polygon",
                min: 0,
                max: 100,
                tickInterval: 20,
                labels: { format: "{value}%" },
            },
            tooltip: {
                pointFormat: "<b>{point.y}%</b>",
            },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        format: "{point.y}%",
                        crop: false,
                        overflow: "allow",
                    },
                },
            },
            series: [
                {
                    type: "line",
                    name: "Impact Strength",
                    data: roadmap.map(item =>
                        item.urgency === "urgent" ? 95 :
                            item.urgency === "high" ? 82 :
                                item.urgency === "medium" ? 65 : 48
                    ),
                    pointPlacement: "on",
                },
                {
                    type: "line",
                    name: "Current Progress",
                    data: roadmap.map(item => item.progress || 0),
                    pointPlacement: "on",
                },
            ],
        };
    }, [roadmap]);

    const bubbleOptions: Highcharts.Options = useMemo(() => ({
        chart: {
            type: "bubble",
            plotBorderWidth: 1,
            backgroundColor: "transparent",
            height: 360,
        },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        xAxis: {
            title: { text: "Estimated Weeks" },
            min: 0,
        },
        yAxis: {
            title: { text: "Impact Score" },
            min: 0,
            max: 100,
            labels: { format: "{value}%" },
        },
        tooltip: {
            useHTML: true,
            pointFormat:
                "<b>{point.name}</b><br/>Timeline: {point.x} weeks<br/>Impact: {point.y}%<br/>Weight: {point.z}",
        },
        plotOptions: {
            bubble: {
                minSize: 18,
                maxSize: 58,
                dataLabels: {
                    enabled: true,
                    format: "{point.name}",
                    crop: false,
                    overflow: "allow",
                    style: { fontSize: "10px" },
                },
            },
        },
        series: [
            {
                type: "bubble",
                name: "Intervention Weight",
                data: roadmap.map((item, index) => {
                    const impact =
                        item.urgency === "urgent" ? 95 :
                            item.urgency === "high" ? 82 :
                                item.urgency === "medium" ? 65 : 48;

                    return {
                        name: `I${index + 1}`,
                        x: item.estimatedWeeks || 0,
                        y: impact,
                        z: Math.max(10, impact / 2),
                    };
                }),
            },
        ],
    }), [roadmap]);

    const timelineChartOptions: Highcharts.Options = useMemo(
        () => ({
            chart: { type: "bar", backgroundColor: "transparent", height: 320 },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            xAxis: { categories: roadmap.map((item) => item.title) },
            yAxis: {
                min: 0,
                title: { text: "Estimated Weeks" },
                allowDecimals: false,
            },
            tooltip: { pointFormat: "<b>{point.y} weeks</b>" },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        format: "{point.y}w",
                        crop: false,
                        overflow: "allow",
                    },
                },
            },
            series: [
                {
                    type: "bar",
                    name: "Timeline",
                    data: roadmap.map((item) => item.estimatedWeeks || 0),
                },
            ],
        }),
        [roadmap],
    );

    const openAgent = (agent: SupportAgent) => {
        setSelectedAgent(agent);
        setChatMessages(buildChat(agent, selectedSubmission));
        setAgentAssignmentId(undefined);
    };

    const agentInterventionId = (agent: SupportAgent) => cleanDocumentKey(agent.matchedInterventionTitle || agent.focus || agent.id);

    const recordAgentDelivery = async (agent: SupportAgent, roadmapItem?: RoadmapItem) => {
        const participantId = String((selectedSubmission as Record<string, unknown> | null)?.participantId || user?.uid || '');
        if (!participantId) return;
        const interventionId = agentInterventionId(agent);
        const deliveryProgramId = selectedSubmission?.recommendedProgramId || selectedSubmission?.decision?.recommendedProgramId || activeProgramId;
        let assignmentId = agentAssignmentId;

        if (!assignmentId) {
            const snapshot = await getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', participantId)));
            const existing = snapshot.docs.find((item) => {
                const data = item.data();
                return data.deliveryActorType === 'agent' && data.interventionId === interventionId && data.programId === deliveryProgramId;
            });
            if (existing) {
                assignmentId = existing.id;
            } else {
                const created = await addDoc(collection(db, 'assignedInterventions'), {
                    companyCode: selectedSubmission?.companyCode || companyCode || null,
                    participantId,
                    applicationId: selectedSubmission?.id || null,
                    interventionId,
                    interventionTitle: agent.matchedInterventionTitle || agent.focus,
                    areaOfSupport: agent.department,
                    businessName: selectedSubmission?.contactName || user?.displayName || 'SME',
                    programId: deliveryProgramId,
                    programName: selectedSubmission?.recommendedProgramName || null,
                    assigneeId: agent.id,
                    assigneeName: agent.name,
                    assigneeType: 'agent',
                    deliveryActorType: 'agent',
                    status: 'in-progress',
                    assigneeStatus: 'accepted',
                    participantStatus: 'accepted',
                    assigneeCompletionStatus: 'pending',
                    participantCompletionStatus: 'pending',
                    progress: roadmapItem?.progress || 0,
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
            message.success('Agent conversation rated.');
        } catch {
            message.error('The agent rating could not be saved.');
        } finally {
            setRatingMessageId(undefined);
        }
    };

    const closeAgent = () => {
        if (chatMessages.some((item) => item.requiresRating && !item.rating)) {
            message.warning('Rate the latest agent conversation before closing.');
            return;
        }
        setSelectedAgent(null);
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
            message.warning('Rate the previous agent conversation before continuing.');
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
            void recordAgentDelivery(selectedAgent, matchedRoadmapItem).catch((error) => console.error('Agent delivery could not be recorded:', error));
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

    const roadmapItems: CollapseProps["items"] = roadmap.map((item, index) => ({
        key: `${item.title}-${index}`,
        label: (
            <Space wrap>
                <Text strong>{item.title}</Text>
                <Tag color={urgencyColor(item.urgency)}>{item.urgency || "medium"}</Tag>
                <Tag>{item.department || "General Support"}</Tag>
            </Space>
        ),
        children: (
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Paragraph style={{ marginBottom: 0 }}>{item.reason}</Paragraph>
                <Progress percent={item.progress || 0} />
                <Text type="secondary">
                    Estimated duration: {item.estimatedWeeks || 0} weeks
                </Text>
                <Text type="secondary">
                    Expected impact:{" "}
                    {item.expectedImpact || "Improve business readiness."}
                </Text>
            </Space>
        ),
    }));

    if (loading) {
        return (
            <div style={{ minHeight: '100vh' }}>
                <LoadingOverlay tip="Loading AI roadmap" />
            </div>
        )

    }

    return (
        <div className="sme-roadmap-page">
            <Helmet>
                <title>AI Roadmap | Smart Incubation</title>
            </Helmet>

            <DashboardHeader
                title={`${selectedSubmission?.contactName || "SME"} Support Roadmap`}
                subtitle="Review AI intake recommendations, support projections, matched agents, and intake history."
                actions={
                    <Select
                        value={selectedSubmission?.id}
                        onChange={(value) => setSelectedSubmissionId(value)}
                        style={{ width: isMobile ? "100%" : 320 }}
                        placeholder="Select intake"
                        showSearch
                        optionFilterProp="label"
                        options={rows.slice(0, 20).map(item => ({
                            label: `${formatDate(item.createdAt)} - ${statusLabel(item.status)}`,
                            value: item.id
                        }))}
                    />
                }
            />
            <Row gutter={[14, 14]} style={{ marginTop: 16 }}>
                <Col xs={12} md={6}>
                    <MotionCard style={{ borderRadius: 18 }}>
                        <Statistic
                            title="Roadmap Progress"
                            value={averageProgress}
                            suffix="%"
                            prefix={<RiseOutlined />}
                        />
                    </MotionCard>
                </Col>
                <Col xs={12} md={6}>
                    <MotionCard style={{ borderRadius: 18 }}>
                        <Statistic
                            title="Interventions"
                            value={roadmap.length}
                            prefix={<ProjectOutlined />}
                        />
                    </MotionCard>
                </Col>
                <Col xs={12} md={6}>
                    <MotionCard style={{ borderRadius: 18 }}>
                        <Statistic
                            title="Completed"
                            value={completedCount}
                            prefix={<CheckCircleOutlined />}
                        />
                    </MotionCard>
                </Col>
                <Col xs={12} md={6}>
                    <MotionCard style={{ borderRadius: 18 }}>
                        <Statistic
                            title="Projected Finish"
                            value={estimatedFinishDate}
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ fontSize: 18 }}
                        />
                    </MotionCard>
                </Col>
            </Row>

            <MotionCard.SunkenPanel style={{ marginTop: 16 }}>
                <Row gutter={[12, 12]} align="middle">
                    <Col xs={24} md={12} lg={9}>
                        <Segmented
                            block
                            value={view}
                            onChange={(value) => setView(value as ViewMode)}
                            options={[
                                { label: "Roadmap", value: "roadmap" },
                                { label: "Projections", value: "projections" },
                                { label: "Agents", value: "agents" },
                                { label: "History", value: "history" },
                            ]}
                        />
                    </Col>
                    <Col xs={24} md={12} lg={15}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder="Search agents, interventions or departments"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </Col>
                </Row>
            </MotionCard.SunkenPanel>

            {!selectedSubmission ? (
                <MotionCard style={{ marginTop: 16, borderRadius: 20 }}>
                    <Empty description="No AI intake submission found for this SME." />
                </MotionCard>
            ) : null}

            {selectedSubmission && view === "roadmap" && (
                <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                    <Col xs={24} lg={14}>
                        <MotionCard title="Roadmap Timeline" style={{ borderRadius: 20 }}>
                            {roadmap.length ? (
                                isMobile ? (
                                    <Collapse
                                        defaultActiveKey={[roadmapItems[0]?.key as string]}
                                        items={roadmapItems}
                                    />
                                ) : (
                                    <Timeline
                                        items={roadmap.map((item, index) => ({
                                            color:
                                                item.status === "completed"
                                                    ? "green"
                                                    : index === 0
                                                        ? "blue"
                                                        : "gray",
                                            dot: index === 0 ? <ThunderboltOutlined /> : undefined,
                                            children: (
                                                <Card size="small" className="roadmap-step-card">
                                                    <Row gutter={[12, 12]} align="middle">
                                                        <Col xs={24} md={16}>
                                                            <Space direction="vertical" size={6}>
                                                                <Space wrap>
                                                                    <Text strong>{item.title}</Text>
                                                                    <Tag color={urgencyColor(item.urgency)}>
                                                                        {item.urgency || "medium"}
                                                                    </Tag>
                                                                    <Tag>
                                                                        {item.department || "General Support"}
                                                                    </Tag>
                                                                </Space>
                                                                <Text type="secondary">{item.reason}</Text>
                                                                <Text type="secondary">
                                                                    Expected impact:{" "}
                                                                    {item.expectedImpact ||
                                                                        "Improve business readiness."}
                                                                </Text>
                                                            </Space>
                                                        </Col>
                                                        <Col xs={24} md={8}>
                                                            <Progress percent={item.progress || 0} />
                                                            <Text type="secondary">
                                                                {item.estimatedWeeks || 0} weeks estimated
                                                            </Text>
                                                        </Col>
                                                    </Row>
                                                </Card>
                                            ),
                                        }))}
                                    />
                                )
                            ) : (
                                <Empty description="No AI recommended interventions found on this intake." />
                            )}
                        </MotionCard>
                    </Col>

                    <Col xs={24} lg={10}>
                        <Space direction="vertical" size={16} style={{ width: "100%" }}>
                            <MotionCard title="AI Summary" style={{ borderRadius: 20 }}>
                                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                    <Paragraph style={{ marginBottom: 0 }}>
                                        {decision?.summary || "No AI summary was saved."}
                                    </Paragraph>
                                    <Space wrap>
                                        <Tag color="blue">{stageLabel(decision?.stage)}</Tag>
                                        <Tag color={urgencyColor(decision?.urgencyLevel)}>
                                            Urgency: {decision?.urgencyLevel || "unknown"}
                                        </Tag>
                                        <Tag color={riskColor(decision?.riskLevel)}>
                                            Risk: {decision?.riskLevel || "unknown"}
                                        </Tag>
                                    </Space>
                                    {decision?.recommendedProgramName ? (
                                        <Alert
                                            type="info"
                                            showIcon
                                            message="Recommended Programme"
                                            description={decision.recommendedProgramName}
                                        />
                                    ) : null}
                                </Space>
                            </MotionCard>

                            <MotionCard
                                title="Roadmap Projection"
                                style={{ borderRadius: 20 }}
                            >
                                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                                    <Progress percent={averageProgress} />
                                    <Text>Total estimated duration: {totalWeeks || 0} weeks</Text>
                                    <Text>Projected finish: {estimatedFinishDate}</Text>
                                </Space>
                            </MotionCard>
                        </Space>
                    </Col>
                </Row>
            )}

            {selectedSubmission && view === "projections" && (
                <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                    <Col xs={24} lg={8}>
                        <MotionCard title="Projection Summary" style={{ borderRadius: 20 }}>
                            <Space direction="vertical" size={14} style={{ width: "100%" }}>
                                <Statistic
                                    title="Projected Readiness"
                                    value={Math.min(100, averageProgress + roadmap.length * 12)}
                                    suffix="%"
                                    prefix={<RiseOutlined />}
                                />

                                <Statistic
                                    title="Estimated Duration"
                                    value={totalWeeks || 0}
                                    suffix="weeks"
                                    prefix={<ClockCircleOutlined />}
                                />

                                <Statistic
                                    title="Projected Finish"
                                    value={estimatedFinishDate}
                                    prefix={<FundProjectionScreenOutlined />}
                                    valueStyle={{ fontSize: 18 }}
                                />
                            </Space>
                        </MotionCard>
                    </Col>

                    <Col xs={24} lg={16}>
                        <MotionCard title="Readiness Growth Projection" style={{ borderRadius: 20 }}>
                            <ThemedHighcharts options={projectionSplineOptions} />
                        </MotionCard>
                    </Col>

                    <Col xs={24} lg={12}>
                        <MotionCard title="Department Impact Radar" style={{ borderRadius: 20 }}>
                            <ThemedHighcharts options={radarOptions} />
                        </MotionCard>
                    </Col>

                    <Col xs={24} lg={12}>
                        <MotionCard title="Impact vs Timeline Bubble Map" style={{ borderRadius: 20 }}>
                            <ThemedHighcharts options={bubbleOptions} />
                        </MotionCard>
                    </Col>

                    <Col xs={24} lg={12}>
                        <MotionCard
                            title="Expected Impact by Intervention"
                            style={{ borderRadius: 20 }}
                        >
                            <ThemedHighcharts options={impactChartOptions} />
                        </MotionCard>
                    </Col>
                    <Col xs={24} lg={12}>
                        <MotionCard
                            title="Estimated Timeline by Intervention"
                            style={{ borderRadius: 20 }}
                        >
                            <ThemedHighcharts options={timelineChartOptions} />
                        </MotionCard>
                    </Col>
                </Row>
            )}

            {selectedSubmission && view === "agents" && (
                <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                    {filteredAgents.map((agent) => (
                        <Col xs={24} md={12} xl={8} key={agent.id}>
                            <div className="agent-card" onClick={() => openAgent(agent)}>
                                <div className="agent-card-top">
                                    <Avatar
                                        size={58}
                                        className={`agent-avatar ${agent.category}`}
                                        icon={iconForCategory(agent.category)}
                                    />
                                    <Badge
                                        status={
                                            agent.urgency === "urgent" || agent.urgency === "high"
                                                ? "error"
                                                : "processing"
                                        }
                                        text={agent.urgency || "medium"}
                                    />
                                </div>
                                <Title level={4} style={{ margin: "16px 0 4px" }}>
                                    {agent.name}
                                </Title>
                                <Text strong>{agent.title}</Text>
                                <Paragraph type="secondary" style={{ marginTop: 10 }}>
                                    {agent.intro}
                                </Paragraph>
                                <Space wrap>
                                    <Tag color={categoryColor(agent.category)}>
                                        {agent.category}
                                    </Tag>
                                    <Tag>{agent.department}</Tag>
                                </Space>
                                <div className="agent-card-footer">
                                    <Text type="secondary">
                                        Matched to: {(agent.matchedInterventionTitles || [agent.matchedInterventionTitle]).filter(Boolean).slice(0, 2).join(", ")}
                                        {(agent.matchedInterventionTitles?.length || 0) > 2 ? ` +${(agent.matchedInterventionTitles?.length || 0) - 2} more` : ""}
                                    </Text>
                                    <Button
                                        type="primary"
                                        shape="round"
                                        icon={<MessageOutlined />}
                                    >
                                        Open Chat
                                    </Button>
                                </div>
                            </div>
                        </Col>
                    ))}

                    {!filteredAgents.length && (
                        <Col span={24}>
                            <MotionCard style={{ borderRadius: 20 }}>
                                <Empty description="No agents matched this AI roadmap." />
                            </MotionCard>
                        </Col>
                    )}
                </Row>
            )}

            {selectedSubmission && view === "history" && (
                <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                    <Col xs={24} lg={10}>
                        <MotionCard title="Intake History" style={{ borderRadius: 20 }}>
                            <Timeline
                                items={[
                                    {
                                        dot: <AuditOutlined />,
                                        children: (
                                            <Space direction="vertical" size={2}>
                                                <Text strong>AI intake submitted</Text>
                                                <Text type="secondary">
                                                    {formatDate(selectedSubmission.createdAt)}
                                                </Text>
                                            </Space>
                                        ),
                                    },
                                    {
                                        dot: <FundProjectionScreenOutlined />,
                                        children: (
                                            <Space direction="vertical" size={2}>
                                                <Text strong>
                                                    {statusLabel(selectedSubmission.status)}
                                                </Text>
                                                <Text type="secondary">
                                                    {selectedSubmission.recommendedProgramName ||
                                                        decision?.recommendedProgramName ||
                                                        "Agent support path"}
                                                </Text>
                                            </Space>
                                        ),
                                    },
                                    {
                                        dot: <FileProtectOutlined />,
                                        children: (
                                            <Space direction="vertical" size={2}>
                                                <Text strong>Documents captured</Text>
                                                <Text type="secondary">
                                                    {selectedSubmission.uploadedDocuments?.length || 0}{" "}
                                                    uploaded document(s)
                                                </Text>
                                            </Space>
                                        ),
                                    },
                                ]}
                            />
                        </MotionCard>
                    </Col>

                    <Col xs={24} lg={14}>
                        <MotionCard title="Roadmap Record" style={{ borderRadius: 20 }}>
                            <List
                                dataSource={roadmap}
                                locale={{ emptyText: "No roadmap records available." }}
                                renderItem={(item) => (
                                    <List.Item>
                                        <List.Item.Meta
                                            avatar={
                                                <Avatar
                                                    icon={iconForCategory(
                                                        categoryFromText(
                                                            `${item.department} ${item.title}`,
                                                        ),
                                                    )}
                                                />
                                            }
                                            title={
                                                <Space wrap>
                                                    <Text strong>{item.title}</Text>
                                                    <Tag color={urgencyColor(item.urgency)}>
                                                        {item.urgency || "medium"}
                                                    </Tag>
                                                </Space>
                                            }
                                            description={
                                                item.reason ||
                                                item.expectedImpact ||
                                                "AI recommended intervention."
                                            }
                                        />
                                    </List.Item>
                                )}
                            />
                        </MotionCard>
                    </Col>
                </Row>
            )}

            <Drawer
                title={selectedAgent?.name || "Agent Chat"}
                open={!!selectedAgent}
                onClose={closeAgent}
                width={isMobile ? "100%" : 520}
                destroyOnClose
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
                            title="Requested Documents"
                            style={{ borderRadius: 16 }}
                        >
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                {selectedAgentDocumentStatus.map((row) => (
                                    <div key={row.item} className="agent-document-row">
                                        <Space direction="vertical" size={2}>
                                            <Space wrap>
                                                <Text strong>{row.item}</Text>
                                                <Tag color={row.ready ? "green" : "orange"}>
                                                    {row.ready ? "Uploaded" : "Missing"}
                                                </Tag>
                                            </Space>
                                            {row.matches.length ? (
                                                <Text type="secondary">
                                                    {row.matches.map((item) => item.fileName || item.type).join(", ")}
                                                </Text>
                                            ) : (
                                                <Text type="secondary">No matching file found yet.</Text>
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
                                                Upload
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
                                                <Text type="secondary">{item.rating ? 'Conversation rated' : 'Rate this conversation to continue'}</Text>
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
                                placeholder="Type what support is needed..."
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
            </Drawer>

            <style>{`
                .sme-roadmap-page {
                    min-height: 100vh;
                    padding: 24px;
                }

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
                    .sme-roadmap-page {
                        padding: 12px;
                    }

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
        </div>
    );
};

export default SMEIntakeRoadmapPage;

