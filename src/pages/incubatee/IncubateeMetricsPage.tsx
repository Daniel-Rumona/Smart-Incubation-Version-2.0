import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Button,
    Card,
    Col,
    DatePicker,
    Form,
    Grid,
    InputNumber,
    message,
    Modal,
    Progress,
    Row,
    Segmented,
    Select,
    Space,
    Table,
    Typography,
    Upload,
} from "antd";
import {
    BarChartOutlined,
    CalendarOutlined,
    CheckCircleFilled,
    CloseCircleOutlined,
    DollarCircleOutlined,
    LineChartOutlined,
    PlusOutlined,
    SaveOutlined,
    ShoppingCartOutlined,
    TableOutlined,
    TeamOutlined,
    UsergroupAddOutlined,
} from "@ant-design/icons";
import { Helmet } from "react-helmet";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    setDoc,
    Timestamp,
    where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import dayjs, { Dayjs } from "dayjs";
import Highcharts from "highcharts";
import { auth, db, storage } from "@/firebase";
import { MotionCard } from "@/components/shared/MotionCard";
import DashboardPage from "@/components/shared/DashboardPage";
import DashboardMetricCard from "@/components/shared/DashboardMetricCard";
import { FilterBar } from "@/components/shared/FilterBar";
import { ThemedHighcharts } from "@/components/shared/ThemedHighcharts";
import "@/styles/incubatee.css";
import { tr, useLanguage } from '@/providers/LanguageProvider'

const { Text } = Typography;
const { useBreakpoint } = Grid;

Highcharts.setOptions({ credits: { enabled: false } });

type ViewKey = "data" | "analytics";
type SectionKey = "revenue" | "employees" | "sales" | "traffic" | "networking";

/**
 * An SME rarely has every figure to hand in the same month, so uploads start by choosing
 * what is actually being reported. Only the chosen sections are asked for and written,
 * which keeps "not reported" distinct from a genuine zero.
 */
const METRIC_SECTIONS: Array<{ key: SectionKey; label: string; hint: string; icon: React.ReactNode; fields: string[] }> = [
    { key: "revenue", get label() { return tr('Revenue') }, get hint() { return tr('Turnover plus a bank statement') }, icon: <DollarCircleOutlined />, fields: ["revenue"] },
    { key: "employees", get label() { return tr('Employees') }, get hint() { return tr('Permanent and temporary headcount') }, icon: <TeamOutlined />, fields: ["headPermanent", "headTemporary"] },
    { key: "sales", get label() { return tr('Orders and customers') }, get hint() { return tr('Orders submitted, new customers') }, icon: <ShoppingCartOutlined />, fields: ["orders", "customers"] },
    { key: "traffic", get label() { return tr('Website traffic') }, get hint() { return tr('Visits recorded for the month') }, icon: <LineChartOutlined />, fields: ["traffic"] },
    { key: "networking", get label() { return tr('Networking') }, get hint() { return tr('Events attended this month') }, icon: <UsergroupAddOutlined />, fields: ["networking"] },
];

const fullWidthUploadStyle: React.CSSProperties = { width: "100%" };

const resolveParticipantRecord = async (uid: string, email: string) => {
    const direct = await getDoc(doc(db, "participants", uid));
    if (direct.exists()) return { id: direct.id, data: direct.data() as Record<string, any> };

    const normalizedEmail = email.trim().toLowerCase();
    const lookups: Array<[string, string]> = [
        ["uid", uid],
        ["userId", uid],
        ["participantId", uid],
        ["ownerUid", uid],
        ["email", email],
        ...(normalizedEmail !== email ? [["email", normalizedEmail] as [string, string]] : []),
    ];
    for (const [field, value] of lookups) {
        const snapshot = await getDocs(query(collection(db, "participants"), where(field, "==", value)));
        if (!snapshot.empty) return { id: snapshot.docs[0].id, data: snapshot.docs[0].data() as Record<string, any> };
    }

    const applicationLookups: Array<[string, string]> = [["uid", uid], ["userId", uid], ["email", email]];
    for (const [field, value] of applicationLookups) {
        const snapshot = await getDocs(query(collection(db, "applications"), where(field, "==", value)));
        const application = snapshot.docs[0]?.data() as Record<string, any> | undefined;
        const resolvedId = String(application?.participantId || application?.businessProfileId || application?.applicantProfileId || "").trim();
        if (!resolvedId) continue;
        const participant = await getDoc(doc(db, "participants", resolvedId));
        if (participant.exists()) return { id: participant.id, data: participant.data() as Record<string, any> };
    }

    const businessProfile = await getDoc(doc(db, "businessProfiles", uid));
    if (businessProfile.exists()) return { id: uid, data: businessProfile.data() as Record<string, any> };
    return null;
};

export const MonthlyPerformanceForm: React.FC = () => {
    useLanguage() // re-render when the language changes
    const [form] = Form.useForm();
    const screens = useBreakpoint();
    const isMobile = !screens.md;
    // Sized from the viewport so the charts fill the screen without pushing the page into a scroll.
    const chartHeight = isMobile
        ? 240
        : Math.max(260, Math.min(430, Math.round(window.innerHeight * 0.46)))

    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [participantCreatedAt, setParticipantCreatedAt] = useState<Date | null>(null)
    const [modalVisible, setModalVisible] = useState(false);
    const [participantId, setParticipantId] = useState<string | null>(null);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [view, setView] = useState<ViewKey>("data");

    const [progressVisible, setProgressVisible] = useState(false);
    const [progressPercent, setProgressPercent] = useState(0);
    const [progressMessage, setProgressMessage] = useState("Starting process...");

    const [pRevenueMonthly, setPRevenueMonthly] = useState<
        Record<string, number>
    >({});
    const [pHeadcountMonthly, setPHeadcountMonthly] = useState<
        Record<string, { permanent?: number; temporary?: number }>
    >({});
    const [acceptedAt, setAcceptedAt] = useState<Date | null>(null);
    const [missingMonths, setMissingMonths] = useState<string[]>([]);
    const [step, setStep] = useState<"pick" | "form">("pick");
    const [sections, setSections] = useState<SectionKey[]>([]);
    const [range, setRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf("year"),
        dayjs().endOf("year"),
    ]);

    const thisMonth = dayjs().format("MMMM YYYY");

    const monthNames = useMemo(
        () => [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ],
        [],
    );

    const asJsDate = (v: any): Date | null => {
        if (!v) return null

        try {
            // Firestore Timestamp
            if (typeof v?.toDate === 'function') {
                const d = v.toDate()
                return Number.isFinite(d?.getTime?.()) ? d : null
            }

            // JS Date
            if (v instanceof Date) {
                return Number.isFinite(v.getTime()) ? v : null
            }

            // Firestore serialized timestamp
            // { seconds, nanoseconds }
            if (
                typeof v === 'object' &&
                typeof v.seconds === 'number'
            ) {
                const d = new Date(v.seconds * 1000)
                return Number.isFinite(d.getTime()) ? d : null
            }

            // Nested timestamp map
            // { _seconds, _nanoseconds }
            if (
                typeof v === 'object' &&
                typeof v._seconds === 'number'
            ) {
                const d = new Date(v._seconds * 1000)
                return Number.isFinite(d.getTime()) ? d : null
            }

            // ISO/date string
            if (typeof v === 'string') {
                const d = new Date(v)
                return Number.isFinite(d.getTime()) ? d : null
            }

            // Unix milliseconds
            if (typeof v === 'number') {
                const d = new Date(v)
                return Number.isFinite(d.getTime()) ? d : null
            }

            // Firebase Admin serialized timestamp
            // { timestamp: ... }
            if (typeof v === 'object' && v.timestamp) {
                return asJsDate(v.timestamp)
            }

            console.warn('[INVALID DATE VALUE]', v)
            return null
        } catch (err) {
            console.error('[DATE PARSE ERROR]', err, v)
            return null
        }
    }

    const toMonthKey = (d: Dayjs) => d.format("MMMM YYYY");

    const monthRangeKeys = (start: Dayjs, end: Dayjs) => {
        const out: string[] = [];
        let cur = start.startOf("month");
        const last = end.startOf("month");

        while (cur.isBefore(last) || cur.isSame(last)) {
            out.push(toMonthKey(cur));
            cur = cur.add(1, "month");
        }

        return out;
    };

    const parseMonthKey = (row: any) => {
        const raw = String(row.month || row.key || '').trim()
        const parts = raw.split(/\s+/)

        const monthName = parts[0]
        const year = Number(parts[1])

        return {
            monthName,
            year: Number.isFinite(year) ? year : null,
        }
    }

    const getBaselineMonthYear = (monthName: string, createdAt: Date | null) => {
        const created = createdAt ? dayjs(createdAt) : dayjs()
        const monthIndex = monthNames.findIndex(m => m === monthName)

        if (monthIndex < 0) return created.year()

        // If baseline month is after createdAt month, it belongs to previous year
        return monthIndex > created.month()
            ? created.year() - 1
            : created.year()
    }

    const getRecordYear = (r: any) => {
        const parsed = parseMonthKey(r)
        if (parsed.year) return parsed.year

        const d = asJsDate(r.createdAt)
        return d ? dayjs(d).year() : dayjs().year()
    }

    const getMonthIndexFromRecord = (r: any) => {
        const parsed = parseMonthKey(r)
        return monthNames.findIndex(m => m === parsed.monthName)
    }

    const buildUploadedByMonth = (rows: any[], year: number) => {
        const revenue = Array(12).fill(null) as (number | null)[]
        const perm = Array(12).fill(null) as (number | null)[]
        const temp = Array(12).fill(null) as (number | null)[]
        const orders = Array(12).fill(null) as (number | null)[]
        const customers = Array(12).fill(null) as (number | null)[]

        rows.forEach(r => {
            const parsed = parseMonthKey(r)
            const i = getMonthIndexFromRecord(r)
            const recordYear = getRecordYear(r)

            console.log('[MONTHLY ROW]', {
                raw: r,
                monthField: r.month,
                parsedMonth: parsed.monthName,
                parsedYear: parsed.year,
                createdAt: r.createdAt,
                createdAtParsed: asJsDate(r.createdAt),
                resolvedYear: recordYear,
                selectedYear: year,
                monthIndex: i,
            })

            if (i >= 0 && recordYear === year) {
                // A field that was never reported stays null so the series shows a gap, not a zero.
                const figure = (value: unknown) => (value === undefined || value === null || value === "" ? null : Number(value))

                revenue[i] = figure(r.revenue)
                perm[i] = figure(r.headPermanent)
                temp[i] = figure(r.headTemporary)
                orders[i] = figure(r.orders)
                customers[i] = figure(r.customers)

                console.log('[MONTH APPLIED TO CHART]', {
                    month: parsed.monthName,
                    year: recordYear,
                    revenue: revenue[i],
                })
            }
        })

        return { revenue, perm, temp, orders, customers }
    }

    const normalizeRevenueMap = (m?: Record<string, any>, selectedYear?: number) => {
        const result: (number | null)[] = Array(12).fill(null)
        if (!m) return result

        monthNames.forEach((name, i) => {
            const baselineYear = getBaselineMonthYear(name, participantCreatedAt)

            if (selectedYear && baselineYear !== selectedYear) return

            const v = Number(m[name])
            result[i] = Number.isFinite(v) ? v : null
        })

        return result
    }

    const normalizeHeadcountMap = (
        m?: Record<string, { permanent?: any; temporary?: any }>,
        selectedYear?: number
    ) => {
        const perm: (number | null)[] = Array(12).fill(null)
        const temp: (number | null)[] = Array(12).fill(null)
        if (!m) return { perm, temp }

        monthNames.forEach((name, i) => {
            const baselineYear = getBaselineMonthYear(name, participantCreatedAt)

            if (selectedYear && baselineYear !== selectedYear) return

            const row = m[name] || {}
            const p = Number(row.permanent)
            const t = Number(row.temporary)

            perm[i] = Number.isFinite(p) ? p : null
            temp[i] = Number.isFinite(t) ? t : null
        })

        return { perm, temp }
    }

    const encouragingMessages = [
        "Uploading documents...",
        "Saving your monthly performance...",
        "Almost done...",
        "Finalizing and securing your data...",
        "Wrapping up...",
    ];

    const simulateProgress = () => {
        setProgressVisible(true);
        setProgressPercent(5);

        const interval = setInterval(() => {
            setProgressPercent((prev) => {
                if (prev >= 90) return prev;
                const increment = Math.floor(Math.random() * 10) + 5;
                return Math.min(prev + increment, 90);
            });
            setProgressMessage(
                encouragingMessages[
                Math.floor(Math.random() * encouragingMessages.length)
                ],
            );
        }, 1200);

        return interval;
    };

    const computeMissingMonths = async (pid: string, email: string) => {
        const appQ = query(
            collection(db, "applications"),
            where("participantId", "==", pid),
        );
        const appSnap = await getDocs(appQ);

        const fallbackQ = query(
            collection(db, "applications"),
            where("email", "==", email),
        );
        const fallbackSnap = appSnap.empty ? await getDocs(fallbackQ) : appSnap;

        const appDoc = fallbackSnap.empty ? null : fallbackSnap.docs[0];
        const appData = appDoc?.data() as any;

        const acc = asJsDate(appData?.submittedAt);
        setAcceptedAt(acc);

        const histQ = query(collection(db, `monthlyPerformance/${pid}/history`));
        const histSnap = await getDocs(histQ);
        const uploaded = new Set(histSnap.docs.map((d) => d.id));

        const baseline = acc
            ? dayjs(acc).startOf("month")
            : dayjs().startOf("year");
        const allMonths = monthRangeKeys(baseline, dayjs());
        setMissingMonths(allMonths.filter((m) => !uploaded.has(m)));
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            if (!user?.email) return;

            setUserEmail(user.email);

            const resolved = await resolveParticipantRecord(user.uid, user.email);
            if (!resolved) {
                message.error("No participant record found for this user.");
                return;
            }

            const pid = resolved.id;
            setParticipantId(pid);

            const pdata = resolved.data;

                const created = asJsDate(pdata?.createdAt)
                setParticipantCreatedAt(created)

                console.log('[PARTICIPANT BASELINE]', {
                    participantId: pid,
                    createdAt: pdata?.createdAt,
                    createdAtParsed: created,
                    baselineYear: created ? dayjs(created).year() : null,
                    revenueMonthly: pdata?.revenueHistory?.monthly || {},
                    headcountMonthly: pdata?.headcountHistory?.monthly || {},
                })

                setPRevenueMonthly(pdata?.revenueHistory?.monthly || {})
                setPHeadcountMonthly(pdata?.headcountHistory?.monthly || {})

            await computeMissingMonths(pid, user.email);
        });

        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchData = async () => {
        console.log('[FETCH DATA CALLED]', {
            participantId,
        })
        if (!participantId) return;

        try {
            console.log(
                '[FETCHING FROM PATH]',
                `monthlyPerformance/${participantId}/history`
            )
            const q = query(
                collection(db, `monthlyPerformance/${participantId}/history`),
                orderBy("createdAt", "desc"),
            );
            const snapshot = await getDocs(q);
            console.log(
                '[FETCHED MONTHLY DATA]',
                snapshot.docs.map(d => ({
                    id: d.id,
                    ...d.data(),
                }))
            )
            setData(snapshot.docs.map((d) => ({ key: d.id, ...d.data() })));
        } catch (error) {
            console.error(error);
            message.error("Failed to load monthly performance data.");
        }
    };

    useEffect(() => {
        if (!participantId) return

        console.log('[FETCH EFFECT TRIGGERED]', {
            participantId,
        })

        fetchData()
    }, [participantId])

    const mergePrefUploaded = (
        uploadedArr: (number | null)[],
        participantArr: (number | null)[],
    ) =>
        monthNames.map((_, i) =>
            uploadedArr[i] != null ? uploadedArr[i] : (participantArr[i] ?? null),
        );

    /** One month range drives the table, the cards and the charts. */
    const displayData = useMemo(() => {
        const start = range[0].startOf("month");
        const end = range[1].endOf("month");

        return data.filter((row) => {
            const index = getMonthIndexFromRecord(row);
            const year = getRecordYear(row);
            if (index < 0 || !year) return true;

            const point = dayjs(new Date(year, index, 1));
            return !point.isBefore(start) && !point.isAfter(end);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, range]);

    const selectedYear = range?.[0]?.year() ?? dayjs().year()

    const uploaded = buildUploadedByMonth(displayData, selectedYear)
    const pRev = normalizeRevenueMap(pRevenueMonthly, selectedYear)
    const pHC = normalizeHeadcountMap(pHeadcountMonthly, selectedYear);

    const revenueMerged = mergePrefUploaded(uploaded.revenue, pRev)
    const permMerged = mergePrefUploaded(uploaded.perm, pHC.perm)
    const tempMerged = mergePrefUploaded(uploaded.temp, pHC.temp)

    const ordersMerged = uploaded.orders;
    const customersMerged = uploaded.customers;

    const revMA3 = revenueMerged.map((_, i) => {
        const windowVals = revenueMerged.slice(Math.max(0, i - 2), i + 1);
        const nums = windowVals.filter((v) => typeof v === "number") as number[];
        if (!nums.length) return null;
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        return Math.round(avg * 100) / 100;
    });

    const monthIdxInRange = (() => {
        const startM = range?.[0]?.month() ?? 0;
        const endM = range?.[1]?.month() ?? 11;
        const idxs: number[] = [];

        for (let i = startM; i <= endM; i++) idxs.push(i);
        return idxs;
    })();

    const formatLabel = (mIndex: number, year: number) =>
        dayjs().year(year).month(mIndex).format("MMM YY");
    const categories = monthIdxInRange.map((i) => formatLabel(i, selectedYear));

    const pickRange = (arr: (number | null)[]) =>
        monthIdxInRange.map((i) => arr[i]);

    const mobileChartBase: Highcharts.Options = {
        chart: {
            height: chartHeight,
            backgroundColor: "transparent",
            spacing: isMobile ? [12, 10, 12, 10] : [18, 18, 16, 18],
        },
        title: { text: "" },
        subtitle: { text: "" },
        legend: {
            enabled: !isMobile,
        },
        xAxis: {
            labels: {
                rotation: isMobile ? -35 : 0,
                style: { fontSize: isMobile ? '10px' : '12px' },
            },
        },
    }

    const revenueTrendOptions: Highcharts.Options = {
        ...mobileChartBase,
        chart: {
            ...mobileChartBase.chart,
            type: 'spline',
        },
        title: { text: "" },
        subtitle: { text: "" },
        xAxis: {
            ...mobileChartBase.xAxis,
            categories,
        },
        yAxis: {
            title: { text: isMobile ? "" : 'Revenue (R)' },
            labels: { enabled: true },
        },
        tooltip: { shared: true, valuePrefix: 'R' },
        series: [
            { name: tr('Revenue'), type: 'line', data: pickRange(revenueMerged) },
            ...(!isMobile
                ? [{ name: tr('3-month Avg'), type: 'line' as const, dashStyle: 'ShortDot' as const, data: pickRange(revMA3) }]
                : []),
        ],
    }

    const employeesStackedOptions: Highcharts.Options = {
        ...mobileChartBase,
        chart: {
            ...mobileChartBase.chart,
            type: "column",
        },
        title: { text: "" },
        subtitle: { text: "" },
        xAxis: {
            ...mobileChartBase.xAxis,
            categories,
            crosshair: true,
        },
        yAxis: {
            min: 0,
            title: {
                text: isMobile ? "" : "Employees",
            },
            stackLabels: {
                enabled: !isMobile,
            },
            allowDecimals: false,
        },
        tooltip: {
            shared: true,
            borderRadius: 10,
            valueDecimals: 0,
        },
        plotOptions: {
            column: {
                stacking: "normal",
                borderRadius: 4,
                pointPadding: isMobile ? 0.04 : 0.08,
                groupPadding: isMobile ? 0.08 : 0.12,
                dataLabels: {
                    enabled: isMobile,
                    style: {
                        fontSize: "9px",
                        textOutline: "none",
                    },
                },
            },
        },
        series: [
            { name: tr('Permanent'), type: "column", data: pickRange(permMerged) },
            { name: tr('Temporary'), type: "column", data: pickRange(tempMerged) },
        ],
    }

    const ordersCustomersDualAxis: Highcharts.Options = {
        ...mobileChartBase,
        chart: {
            ...mobileChartBase.chart,
            type: "column",
        },
        title: { text: "" },
        subtitle: { text: "" },
        xAxis: [{ categories, crosshair: true }],
        yAxis: [
            { title: { text: tr('Orders') } },
            { title: { text: tr('Customers') }, opposite: true },
        ],
        tooltip: { shared: true },
        series: [
            {
                name: tr('Orders'),
                type: "column",
                yAxis: 0,
                data: pickRange(ordersMerged),
            },
            {
                name: tr('Customers'),
                type: "spline",
                yAxis: 1,
                data: pickRange(customersMerged),
            },
        ],
    };

    const uploadProofs = async (files: any[], type: string, monthKey: string) => {
        const urls: string[] = [];

        for (const file of files) {
            const cleanName = String(file.name || "file").replace(/\s+/g, "_");
            const storageRef = ref(
                storage,
                `monthlyPerformance/${participantId}/${monthKey}/${type}-${cleanName}`,
            );
            await uploadBytes(storageRef, file.originFileObj);
            const url = await getDownloadURL(storageRef);
            urls.push(url);
        }

        return urls;
    };

    const handleSubmit = async (values: any) => {
        const monthKey = String(values.monthKey || "").trim();

        if (!monthKey) {
            message.error("Please select a month to upload.");
            return;
        }

        if (!participantId || !userEmail) {
            message.error("Unable to determine participant identity.");
            return;
        }

        let interval: any;

        try {
            setLoading(true);
            interval = simulateProgress();

            const reportsRevenue = sections.includes("revenue");
            const reportsEmployees = sections.includes("employees");

            const revenueProofFiles = reportsRevenue
                ? values.revenueProof?.fileList || values.revenueProof || []
                : [];
            const totalEmployees =
                Number(values.headPermanent || 0) + Number(values.headTemporary || 0);
            const employeeProofFiles =
                reportsEmployees && totalEmployees > 0
                    ? values.employeeProof?.fileList || values.employeeProof || []
                    : [];

            const revenueProofUrls = revenueProofFiles.length
                ? await uploadProofs(revenueProofFiles, "revenue", monthKey)
                : [];
            const employeeProofUrls = employeeProofFiles.length
                ? await uploadProofs(employeeProofFiles, "employee", monthKey)
                : [];

            await setDoc(
                doc(db, "monthlyPerformance", participantId),
                { participantId, email: userEmail, updatedAt: Timestamp.now() },
                { merge: true },
            );

            const monthDocRef = doc(
                db,
                `monthlyPerformance/${participantId}/history/${monthKey}`,
            );
            const reported: Record<string, unknown> = {};
            METRIC_SECTIONS
                .filter((section) => sections.includes(section.key))
                .forEach((section) => section.fields.forEach((field) => {
                    if (values[field] !== undefined && values[field] !== null) reported[field] = values[field];
                }));

            await setDoc(
                monthDocRef,
                {
                    month: monthKey,
                    ...reported,
                    reportedSections: sections,
                    revenueProofUrls,
                    employeeProofUrls,
                    revenueProofMeta: revenueProofFiles.map((f: any) => ({
                        name: f.name,
                        size: f.size,
                        type: f.type,
                    })),
                    employeeProofMeta: employeeProofFiles.map((f: any) => ({
                        name: f.name,
                        size: f.size,
                        type: f.type,
                    })),
                    createdAt: Timestamp.now(),
                },
                { merge: true },
            );

            setProgressPercent(100);
            setProgressMessage("All done! Your data has been saved successfully.");
            setTimeout(() => setProgressVisible(false), 900);

            await fetchData();
            await computeMissingMonths(participantId, userEmail);

            message.success(`Saved successfully for ${monthKey}.`);
            setModalVisible(false);
            form.resetFields();
        } catch (err: any) {
            console.error("[MONTHLY PERFORMANCE SAVE ERROR]", err);
            message.error(err?.message || "Failed to save monthly performance data.");
            setProgressVisible(false);
        } finally {
            if (interval) clearInterval(interval);
            setLoading(false);
        }
    };

    const columns = [
        { title: tr('Month'), dataIndex: "month", key: "month" },
        { title: tr('Revenue (R)'), dataIndex: "revenue", key: "revenue" },
        {
            title: tr('Permanent Employees'),
            dataIndex: "headPermanent",
            key: "headPermanent",
        },
        {
            title: tr('Temporary Employees'),
            dataIndex: "headTemporary",
            key: "headTemporary",
        },
        { title: tr('Orders'), dataIndex: "orders", key: "orders" },
        { title: tr('Customers'), dataIndex: "customers", key: "customers" },
        { title: tr('Traffic'), dataIndex: "traffic", key: "traffic" },
        { title: tr('Networking Events'), dataIndex: "networking", key: "networking" },
    ];

    const totalRevenue = displayData.reduce(
        (acc, cur) => acc + (Number(cur.revenue) || 0),
        0,
    );
    const latestEmployees =
        displayData.length > 0
            ? (Number(displayData[0].headPermanent) || 0) +
            (Number(displayData[0].headTemporary) || 0)
            : 0;
    const totalOrders = displayData.reduce(
        (acc, cur) => acc + (Number(cur.orders) || 0),
        0,
    );

    const openUpload = () => {
        setStep("pick");
        setSections([]);
        form.resetFields();
        setModalVisible(true);
        const first = missingMonths[0];
        if (first) form.setFieldsValue({ monthKey: first });
    };

    const renderMobileCards = () => {
        if (!displayData.length) {
            return (
                <Alert
                    type="info"
                    showIcon
                    message={tr('No monthly metrics uploaded yet')}
                    description={tr('Use the upload button to submit the first pending month.')}
                    style={{ borderRadius: 14 }}
                />
            );
        }

        return (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {displayData.map((row) => {
                    const employees =
                        (Number(row.headPermanent) || 0) + (Number(row.headTemporary) || 0);

                    return (
                        <Card
                            key={row.key || row.month}
                            style={{ borderRadius: 16, border: "1px solid #e6efff" }}
                            bodyStyle={{ padding: 14 }}
                        >
                            <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                <Space
                                    align="center"
                                    style={{ justifyContent: "space-between", width: "100%" }}
                                >
                                    <Text strong style={{ fontSize: 15 }}>
                                        {row.month || "-"}
                                    </Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        {tr('Monthly record')}
                                    </Text>
                                </Space>

                                <Row gutter={[10, 10]}>
                                    <Col span={12}>
                                        <Card
                                            size="small"
                                            style={{ borderRadius: 12, background: "#f6ffed" }}
                                            bodyStyle={{ padding: 10 }}
                                        >
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {tr('Revenue')}
                                            </Text>
                                            <div style={{ fontWeight: 800, fontSize: 16 }}>
                                                R{Number(row.revenue || 0).toLocaleString()}
                                            </div>
                                        </Card>
                                    </Col>
                                    <Col span={12}>
                                        <Card
                                            size="small"
                                            style={{ borderRadius: 12, background: "#f0f7ff" }}
                                            bodyStyle={{ padding: 10 }}
                                        >
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {tr('Employees')}
                                            </Text>
                                            <div style={{ fontWeight: 800, fontSize: 16 }}>
                                                {employees}
                                            </div>
                                        </Card>
                                    </Col>
                                </Row>

                                <Row gutter={[8, 8]}>
                                    <Col span={12}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {tr('Orders')}
                                        </Text>
                                        <div style={{ fontWeight: 700 }}>
                                            {Number(row.orders || 0).toLocaleString()}
                                        </div>
                                    </Col>
                                    <Col span={12}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {tr('Customers')}
                                        </Text>
                                        <div style={{ fontWeight: 700 }}>
                                            {Number(row.customers || 0).toLocaleString()}
                                        </div>
                                    </Col>
                                    <Col span={12}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {tr('Traffic')}
                                        </Text>
                                        <div style={{ fontWeight: 700 }}>
                                            {Number(row.traffic || 0).toLocaleString()}
                                        </div>
                                    </Col>
                                    <Col span={12}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                            {tr('Networking')}
                                        </Text>
                                        <div style={{ fontWeight: 700 }}>
                                            {Number(row.networking || 0).toLocaleString()}
                                        </div>
                                    </Col>
                                </Row>
                            </Space>
                        </Card>
                    );
                })}
            </Space>
        );
    };

    const uploadButton = (
        <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!missingMonths.length}
            onClick={openUpload}
        >
            {isMobile
                ? (missingMonths.length ? "Upload" : "Up to date")
                : (missingMonths.length ? `Upload ${missingMonths[0]}` : "All months uploaded")}
        </Button>
    );

    const viewSwitch = (
        <Segmented
            value={view}
            onChange={(v) => setView(v as ViewKey)}
            options={[
                { label: tr('Data'), value: "data", icon: <TableOutlined /> },
                { label: tr('Analytics'), value: "analytics", icon: <BarChartOutlined /> },
            ]}
        />
    );

    return (
        <DashboardPage className="incubatee-page incubatee-metrics-page">
            <Helmet>
                <title>{tr('Monthly Metrics | Smart Incubation')}</title>
            </Helmet>

            <Row gutter={[12, 12]} className="dashboard-metrics-row incubatee-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        icon={<DollarCircleOutlined />}
                        label={tr('Revenue reported')}
                        value={`R${totalRevenue.toLocaleString()}`}
                    />
                </Col>

                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        icon={<TeamOutlined />}
                        label={tr('Latest headcount')}
                        value={latestEmployees}
                    />
                </Col>

                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        icon={<ShoppingCartOutlined />}
                        label={tr('Orders reported')}
                        value={totalOrders.toLocaleString()}
                    />
                </Col>

                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        icon={<CalendarOutlined />}
                        label={tr('Months outstanding')}
                        value={missingMonths.length}
                    />
                </Col>
            </Row>

            <FilterBar
                primary={
                    <>
                        <DatePicker.RangePicker
                            picker="month"
                            value={range}
                            allowEmpty={[false, false]}
                            onChange={(vals) => {
                                if (!vals || !vals[0] || !vals[1]) return;

                                if (vals[0].year() !== vals[1].year()) {
                                    message.warning("Please select months within the same year for now.");
                                    return;
                                }

                                setRange(vals as [Dayjs, Dayjs]);
                            }}
                        />

                        {viewSwitch}
                    </>
                }
                actions={uploadButton}
            />

            {/* The filter bar collapses into a modal on phones, so the view switch and upload stay out here. */}
            {isMobile && (
                <div className="incubatee-metrics-mobile-actions">
                    {viewSwitch}
                    {uploadButton}
                </div>
            )}

            {view === "data" ? (
                <MotionCard
                    className="incubatee-metrics-panel"
                    title={tr('Historical monthly metrics')}
                    extra={
                        <Text type="secondary">
                            {`${displayData.length} month${displayData.length === 1 ? "" : "s"}`}
                            {acceptedAt ? ` · reporting since ${dayjs(acceptedAt).format("MMM YYYY")}` : ""}
                        </Text>
                    }
                >
                    {isMobile ? renderMobileCards() : (
                        <Table
                            size="small"
                            columns={columns}
                            dataSource={displayData}
                            pagination={{ pageSize: 6, size: "small", hideOnSinglePage: true }}
                            scroll={{ x: 720 }}
                        />
                    )}
                </MotionCard>
            ) : (
                <div className="incubatee-metrics-charts">
                    <MotionCard className="incubatee-metrics-panel" title={tr('Revenue trend')}>
                        <ThemedHighcharts immutable options={revenueTrendOptions} />
                    </MotionCard>

                    <MotionCard className="incubatee-metrics-panel" title={tr('Headcount composition')}>
                        <ThemedHighcharts immutable options={employeesStackedOptions} />
                    </MotionCard>

                    {!isMobile && (
                        <MotionCard className="incubatee-metrics-panel is-wide" title={tr('Orders vs customers')}>
                            <ThemedHighcharts immutable options={ordersCustomersDualAxis} />
                        </MotionCard>
                    )}
                </div>
            )}

            <Modal
                title={
                    <Space>
                        <CalendarOutlined />
                        <span>{step === "pick" ? "What are you reporting?" : `Monthly performance - ${form.getFieldValue("monthKey") || thisMonth}`}</span>
                    </Space>
                }
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                width={step === "pick" ? 620 : 760}
                destroyOnHidden={false}
                className="incubatee-upload-modal"
                footer={
                    <Space className="incubatee-upload-footer">
                        {step === "pick" ? (
                            <>
                                <Button icon={<CloseCircleOutlined />} onClick={() => setModalVisible(false)}>
                                    {tr('Cancel')}
                                </Button>

                                <Button
                                    type="primary"
                                    disabled={!sections.length}
                                    onClick={() => setStep("form")}
                                >
                                    {sections.length ? `Continue with ${sections.length}` : "Choose at least one"}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button onClick={() => setStep("pick")}>{tr('Back')}</Button>

                                <Button
                                    type="primary"
                                    icon={<SaveOutlined />}
                                    loading={loading}
                                    onClick={() => form.submit()}
                                >
                                    {tr('Save')}
                                </Button>
                            </>
                        )}
                    </Space>
                }
            >
                {step === "pick" ? (
                    <>
                        <Text type="secondary">
                            {tr('Pick only what you have for this month. Anything you leave out stays empty rather than being recorded as zero.')}
                        </Text>

                        <div className="incubatee-upload-picker">
                            {METRIC_SECTIONS.map((item) => {
                                const active = sections.includes(item.key);
                                return (
                                    <button
                                        type="button"
                                        key={item.key}
                                        className={`incubatee-upload-option${active ? " is-active" : ""}`}
                                        aria-pressed={active}
                                        onClick={() => setSections((current) => (
                                            current.includes(item.key)
                                                ? current.filter((key) => key !== item.key)
                                                : [...current, item.key]
                                        ))}
                                    >
                                        <span className="incubatee-upload-option-icon">{item.icon}</span>
                                        <span className="incubatee-upload-option-copy">
                                            <strong>{item.label}</strong>
                                            <span>{item.hint}</span>
                                        </span>
                                        {active && <CheckCircleFilled className="incubatee-upload-option-check" />}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <Form layout="vertical" form={form} onFinish={handleSubmit}>
                        <Form.Item
                            name="monthKey"
                            label={tr('Month to upload')}
                            rules={[{ required: true, message: tr('Please select a month') }]}
                        >
                            <Select
                                options={missingMonths.map((m) => ({ value: m, label: m }))}
                                placeholder={missingMonths.length ? "Select month..." : "No months pending"}
                                disabled={!missingMonths.length}
                                showSearch
                                filterOption={(input, option) =>
                                    String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        </Form.Item>

                        <Row gutter={[12, 12]}>
                            {sections.includes("revenue") && (
                                <>
                                    <Col xs={24} sm={12}>
                                        <Form.Item name="revenue" label={tr('Revenue (R)')} rules={[{ required: true }]}>
                                            <InputNumber min={0} style={{ width: "100%" }} />
                                        </Form.Item>
                                    </Col>

                                    <Col xs={24} sm={12}>
                                        <Form.Item
                                            name="revenueProof"
                                            label={tr('Bank statement')}
                                            rules={[{ required: true, message: tr('Please upload the bank statement') }]}
                                            valuePropName="fileList"
                                            getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}
                                        >
                                            <Upload multiple beforeUpload={() => false} style={fullWidthUploadStyle}>
                                                <Button block icon={<DollarCircleOutlined />}>{tr('Attach statement')}</Button>
                                            </Upload>
                                        </Form.Item>
                                    </Col>
                                </>
                            )}

                            {sections.includes("employees") && (
                                <>
                                    <Col xs={12} sm={6}>
                                        <Form.Item name="headPermanent" label={tr('Permanent')} rules={[{ required: true }]}>
                                            <InputNumber min={0} style={{ width: "100%" }} />
                                        </Form.Item>
                                    </Col>

                                    <Col xs={12} sm={6}>
                                        <Form.Item name="headTemporary" label={tr('Temporary')} rules={[{ required: true }]}>
                                            <InputNumber min={0} style={{ width: "100%" }} />
                                        </Form.Item>
                                    </Col>

                                    <Col xs={24} sm={12}>
                                        <Form.Item
                                            noStyle
                                            shouldUpdate={(prev, next) =>
                                                prev.headPermanent !== next.headPermanent || prev.headTemporary !== next.headTemporary
                                            }
                                        >
                                            {({ getFieldValue }) => {
                                                const total = Number(getFieldValue("headPermanent") ?? 0) + Number(getFieldValue("headTemporary") ?? 0);
                                                const required = total > 0;

                                                return (
                                                    <Form.Item
                                                        name="employeeProof"
                                                        label={tr('Contracts or payslips')}
                                                        rules={[{
                                                            validator: async (_, value) => {
                                                                const list = value?.fileList ?? value ?? [];
                                                                if (required && !(Array.isArray(list) && list.length)) {
                                                                    throw new Error("Please upload employee proof");
                                                                }
                                                            },
                                                        }]}
                                                        valuePropName="fileList"
                                                        getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}
                                                        extra={required ? "Required while headcount is above zero." : "Not needed while headcount is zero."}
                                                    >
                                                        <Upload multiple beforeUpload={() => false} disabled={!required} style={fullWidthUploadStyle}>
                                                            <Button block icon={<TeamOutlined />} disabled={!required}>{tr('Attach proof')}</Button>
                                                        </Upload>
                                                    </Form.Item>
                                                );
                                            }}
                                        </Form.Item>
                                    </Col>
                                </>
                            )}

                            {sections.includes("sales") && (
                                <>
                                    <Col xs={12} sm={12}>
                                        <Form.Item name="orders" label={tr('Orders submitted')} rules={[{ required: true }]}>
                                            <InputNumber min={0} style={{ width: "100%" }} />
                                        </Form.Item>
                                    </Col>

                                    <Col xs={12} sm={12}>
                                        <Form.Item name="customers" label={tr('New customers')} rules={[{ required: true }]}>
                                            <InputNumber min={0} style={{ width: "100%" }} />
                                        </Form.Item>
                                    </Col>
                                </>
                            )}

                            {sections.includes("traffic") && (
                                <Col xs={24} sm={12}>
                                    <Form.Item name="traffic" label={tr('Website traffic')} rules={[{ required: true }]}>
                                        <InputNumber min={0} style={{ width: "100%" }} />
                                    </Form.Item>
                                </Col>
                            )}

                            {sections.includes("networking") && (
                                <Col xs={24} sm={12}>
                                    <Form.Item name="networking" label={tr('Networking events')} rules={[{ required: true }]}>
                                        <InputNumber min={0} style={{ width: "100%" }} />
                                    </Form.Item>
                                </Col>
                            )}
                        </Row>
                    </Form>
                )}
            </Modal>

            <Modal
                open={progressVisible}
                footer={null}
                closable={false}
                centered
                bodyStyle={{ textAlign: "center", padding: "40px" }}
            >
                <Progress type="circle" percent={progressPercent} />
                <p style={{ marginTop: 20, fontSize: 16, fontWeight: 500 }}>
                    {progressMessage}
                </p>
            </Modal>
        </DashboardPage>
    );
};

export default MonthlyPerformanceForm;

