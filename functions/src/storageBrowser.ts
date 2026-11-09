// functions/src/storageBrowser.ts
//
// The system admin's Storage page (src/routes/admin/storage). Browsing goes
// through the Admin SDK rather than storage.rules: the rules grant each path
// to its own users only, and a system-admin catch-all there would override
// every one of those restrictions (see the note at the top of storage.rules).
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { onCall, type CallableRequest, HttpsError } from 'firebase-functions/v2/https';



const STORAGE_ADMIN_ROLES = new Set(['systemadmin']);
const PAGE_SIZE = 200;
/** "Measure" stops counting here so one click can't walk the whole bucket for minutes. */
const MEASURE_CAP = 20_000;
const MAX_DELETE = 50;

async function assertStorageAdmin(req: CallableRequest<unknown>) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const snap = await admin.firestore().collection('users').doc(uid).get();
  const role = String(snap.data()?.role || '').trim().toLowerCase();
  if (!STORAGE_ADMIN_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'Only a system admin can manage stored files.');
  }
  return { uid, role, email: req.auth?.token?.email || snap.data()?.email || null };
}

/** "a/b/" style folder prefix; empty for the bucket root. Rejects anything that could escape a folder. */
function cleanPrefix(value: unknown) {
  const raw = String(value || '').trim().replace(/^\/+/, '');
  if (raw.split('/').some((part) => part === '..')) {
    throw new HttpsError('invalid-argument', 'That path is not allowed.');
  }
  return raw;
}

function cleanPath(value: unknown) {
  const path = cleanPrefix(value);
  if (!path || path.endsWith('/')) throw new HttpsError('invalid-argument', 'Give a file path.');
  return path;
}

type FileMetadata = {
  name?: string;
  size?: string | number;
  contentType?: string;
  updated?: string;
  timeCreated?: string;
  metadata?: Record<string, string>;
};

/**
 * Owner ids the app writes on each upload (src/lib/storageOwner.ts). They are
 * shown as names, not listed with the rest of the file's metadata.
 */
const OWNER_TAGS = ['uploadedBy', 'ownerUid', 'participantId', 'applicationId'];

const describe = (meta: FileMetadata) => ({
  path: String(meta.name || ''),
  size: Number(meta.size || 0),
  contentType: meta.contentType || null,
  updated: meta.updated || meta.timeCreated || null,
  created: meta.timeCreated || null,
  customMetadata: Object.fromEntries(
    Object.entries(meta.metadata || {}).filter(([key]) => key !== 'firebaseStorageDownloadTokens' && !OWNER_TAGS.includes(key)),
  ),
});

const ownerTagsOf = (meta: FileMetadata) =>
  Object.fromEntries(Object.entries(meta.metadata || {}).filter(([key, value]) => OWNER_TAGS.includes(key) && value));

/*
 * Paths are built from Firestore ids (profile-images/{uid}/avatar,
 * intervention-evidence/{programId}/{participantId}/{assignmentId}/...).
 * LAYOUTS says what each id segment under a top-level folder is, so the page
 * can show "Thabo Mokoena · SME" instead of the id. Folders not listed here
 * try the common collections for anything that looks like an id.
 */
type Kind =
  | 'user' | 'participant' | 'application' | 'program' | 'assignment' | 'training'
  | 'trainingEnrollment' | 'attendee' | 'course' | 'academyEnrollment' | 'branch'
  | 'department' | 'appointment' | 'certificateTemplate' | 'workflowQuery';

const KINDS: Record<Kind, { collections: string[]; label: string; person?: boolean }> = {
  user: { collections: ['users'], label: 'User', person: true },
  participant: { collections: ['participants'], label: 'SME', person: true },
  application: { collections: ['applications'], label: 'Application', person: true },
  program: { collections: ['programs'], label: 'Programme' },
  assignment: { collections: ['assignedInterventions'], label: 'Intervention' },
  training: { collections: ['trainings'], label: 'Training' },
  trainingEnrollment: { collections: ['trainingEnrollments', 'participants'], label: 'Enrolment', person: true },
  attendee: { collections: ['trainingAttendees'], label: 'Attendee', person: true },
  course: { collections: ['courses', 'academyCatalog', 'academyDrafts'], label: 'Course' },
  academyEnrollment: { collections: ['academyEnrollments'], label: 'Enrolment' },
  branch: { collections: ['branches'], label: 'Centre' },
  department: { collections: ['departments'], label: 'Department' },
  appointment: { collections: ['appointments'], label: 'Appointment' },
  certificateTemplate: { collections: ['certificateTemplates'], label: 'Certificate template' },
  workflowQuery: { collections: ['workflowQueries'], label: 'Query' },
};

/** Kind of each segment after the top-level folder (or the kinds to try, in order); null for a segment that isn't an id. */
const LAYOUTS: Record<string, Array<Kind | Kind[] | null>> = {
  'user-profiles': ['user'],
  'consultant-profiles': ['user'],
  'company-logos': ['user'],
  'user-signatures': ['user'],
  'intervention-documents': [null, 'participant', 'assignment'],
  'surveyResponses': ['participant'],
  'courseMaterials': [null],
  'participant_documents': [null, 'program', ['user', 'participant']],
  // functions/src/reports/registry.ts: reports/{centre, or the requester when they have none}/{report}/{month}/
  'reports': [['branch', 'user']],
  'academyMaterials': ['user', 'course'],
  'academySubmissions': ['user', 'academyEnrollment'],
  'signatures': ['user'],
  'library': ['user'],
  'profile-images': ['user'],
  'intervention-evidence': [null, 'assignment'],
  'mov-documents': ['program', 'participant', 'assignment'],
  'compliance': ['participant'],
  'agreements': ['participant'],
  'training_enrollments': ['training'],
  'training_attendees': ['trainingEnrollment', 'attendee'],
  'certificate_templates': ['certificateTemplate'],
  'certificates': ['training'],
  'assignedInterventions': ['assignment'],
  'appointments': ['appointment'],
  'workflowQueries': ['program', 'workflowQuery'],
  'programLogos': ['program'],
  'facilities': ['branch'],
  'consolidatedMOVs': ['department'],
};
const FALLBACK_KINDS: Kind[] = ['user', 'participant', 'application', 'program', 'assignment'];
const looksLikeId = (value: string) => /^[A-Za-z0-9_-]{15,40}$/.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value);

const NAME_FIELDS = ['name', 'displayName', 'fullName', 'beneficiaryName', 'companyName', 'businessName', 'participantName', 'title', 'interventionTitle', 'programName', 'email'];
const OWNER_FIELDS = ['beneficiaryName', 'participantName', 'companyName', 'businessName', 'smeName'];
const pick = (data: FirebaseFirestore.DocumentData, fields: string[]) => {
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

export type Resolved = {
  id: string;
  kind: Kind;
  kindLabel: string;
  name: string;
  /** Email or role, shown under the name. */
  detail: string | null;
  role: string | null;
  person: boolean;
  /** For records that belong to an SME (an intervention), that SME's name. */
  ownerName: string | null;
};

const RESOLVE_TTL_MS = 10 * 60 * 1000;
const resolveCache = new Map<string, { at: number; value: Resolved | null }>();

function resolvedFrom(kind: Kind, id: string, data: FirebaseFirestore.DocumentData): Resolved {
  const isAssignment = kind === 'assignment';
  const name = (isAssignment ? pick(data, ['interventionTitle', 'title', 'name']) : pick(data, NAME_FIELDS)) || id;
  const email = typeof data.email === 'string' && data.email !== name ? data.email : null;
  const role = kind === 'user' && typeof data.role === 'string' ? data.role : null;
  return {
    id,
    kind,
    kindLabel: KINDS[kind].label,
    name,
    detail: email,
    role,
    person: Boolean(KINDS[kind].person),
    ownerName: isAssignment || kind === 'workflowQuery' || kind === 'appointment' ? pick(data, OWNER_FIELDS) : null,
  };
}

/** Looks up (kind candidates, id) pairs in as few reads as possible, cached for ten minutes. */
async function resolveIds(wanted: Array<{ id: string; kinds: Kind[] }>) {
  const db = admin.firestore();
  const out = new Map<string, Resolved | null>();
  const pending = new Map<string, Kind[]>();
  for (const { id, kinds } of wanted) {
    const key = `${kinds.join(',')}:${id}`;
    const hit = resolveCache.get(key);
    if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) out.set(key, hit.value);
    else pending.set(key, kinds);
  }

  // Try each candidate in order: first all the first choices, then the second
  // choices for whatever is still missing, and so on.
  const unresolved = new Map(pending);
  for (let round = 0; unresolved.size && round < 5; round += 1) {
    const byCollection = new Map<string, Array<{ key: string; id: string; kind: Kind }>>();
    unresolved.forEach((kinds, key) => {
      const kind = kinds[round];
      if (!kind) return;
      const id = key.slice(key.indexOf(':') + 1);
      KINDS[kind].collections.forEach((collection) => {
        const list = byCollection.get(collection) || [];
        list.push({ key, id, kind });
        byCollection.set(collection, list);
      });
    });
    if (!byCollection.size) break;
    await Promise.all(Array.from(byCollection.entries()).map(async ([collection, items]) => {
      const snaps = await db.getAll(...items.map((item) => db.collection(collection).doc(item.id)));
      snaps.forEach((snap, i) => {
        const item = items[i];
        if (snap.exists && unresolved.has(item.key)) {
          out.set(item.key, resolvedFrom(item.kind, item.id, snap.data() || {}));
          unresolved.delete(item.key);
        }
      });
    }));
  }
  unresolved.forEach((_, key) => out.set(key, null));
  pending.forEach((_, key) => resolveCache.set(key, { at: Date.now(), value: out.get(key) || null }));
  return out;
}

/** What each segment of a path could be: [segment index, id, candidate kinds]. */
function segmentCandidates(path: string) {
  const parts = path.split('/').filter(Boolean);
  const layout = LAYOUTS[parts[0]];
  const found: Array<{ index: number; id: string; kinds: Kind[] }> = [];
  parts.slice(1).forEach((part, i) => {
    const index = i + 1;
    const isLast = index === parts.length - 1 && !path.endsWith('/');
    // signatures/{uid}_{timestamp}.png keeps the owner in the file name.
    if (isLast && parts[0] === 'signatures' && parts.length === 2) {
      const uid = part.split('_')[0];
      if (looksLikeId(uid)) found.push({ index, id: uid, kinds: ['user'] });
      return;
    }
    if (isLast) return;
    // Agreements signed before the person had an SME record are filed under "user-{uid}".
    const userPrefixed = /^user-([A-Za-z0-9]{15,40})$/.exec(part);
    if (userPrefixed) {
      found.push({ index, id: userPrefixed[1], kinds: ['user'] });
      return;
    }
    const kind = layout ? layout[i] : undefined;
    if (kind) found.push({ index, id: part, kinds: Array.isArray(kind) ? kind : [kind] });
    else if (!layout && looksLikeId(part)) found.push({ index, id: part, kinds: FALLBACK_KINDS });
  });
  return found;
}

/** Owner tags to look up, most specific first: the SME or application, then a named owner, then whoever uploaded it. */
const TAG_KINDS: Array<{ tag: string; kinds: Kind[] }> = [
  { tag: 'participantId', kinds: ['participant', 'application'] },
  { tag: 'applicationId', kinds: ['application'] },
  { tag: 'ownerUid', kinds: ['user'] },
  { tag: 'uploadedBy', kinds: ['user'] },
];

/**
 * Names for the id folders in these paths, keyed by folder path ("profile-images/{uid}/"),
 * the owner of each path (the person or SME the path names, else the one its
 * upload tags name), and who uploaded it, from the uploadedBy tag.
 */
async function describePaths(paths: string[], tagsByPath: Record<string, Record<string, string>> = {}) {
  const perPath = paths.map((path) => ({
    path,
    candidates: segmentCandidates(path),
    tags: TAG_KINDS.filter(({ tag }) => tagsByPath[path]?.[tag]).map(({ tag, kinds }) => ({ tag, id: tagsByPath[path][tag], kinds })),
  }));
  const resolved = await resolveIds(perPath.flatMap((p) => [
    ...p.candidates.map(({ id, kinds }) => ({ id, kinds })),
    ...p.tags.map(({ id, kinds }) => ({ id, kinds })),
  ]));
  const lookup = (id: string, kinds: Kind[]) => resolved.get(`${kinds.join(',')}:${id}`) || null;

  const labels: Record<string, Resolved> = {};
  const owners: Record<string, Resolved | null> = {};
  const uploaders: Record<string, Resolved | null> = {};
  perPath.forEach(({ path, candidates, tags }) => {
    const parts = path.split('/').filter(Boolean);
    const chain: Resolved[] = [];
    candidates.forEach(({ index, id, kinds }) => {
      const hit = lookup(id, kinds);
      if (!hit) return;
      chain.push(hit);
      const isFileName = index === parts.length - 1 && !path.endsWith('/');
      if (!isFileName) labels[`${parts.slice(0, index + 1).join('/')}/`] = hit;
    });
    const person = chain.find((r) => r.person);
    const withOwner = chain.find((r) => r.ownerName);
    const tagged = tags.map(({ tag, id, kinds }) => ({ tag, hit: lookup(id, kinds) })).filter((t) => t.hit);
    const taggedOwner = tagged.find((t) => t.tag !== 'uploadedBy')?.hit;
    const uploader = tagged.find((t) => t.tag === 'uploadedBy')?.hit || null;

    owners[path] = person
      || (withOwner
        ? { ...withOwner, kind: 'participant', kindLabel: 'SME', name: withOwner.ownerName!, detail: withOwner.name, role: null, person: true }
        : null)
      || taggedOwner
      || uploader;
    uploaders[path] = uploader;
  });
  return { labels, owners, uploaders };
}

/** One page of a folder: its sub-folders and the files directly inside it, with names for the ids. */
export const adminStorageList = onCall(async (req) => {
  await assertStorageAdmin(req);
  const prefix = cleanPrefix(req.data?.prefix);
  const pageToken = req.data?.pageToken ? String(req.data.pageToken) : undefined;

  const [files, nextQuery, apiResponse] = await admin.storage().bucket().getFiles({
    prefix,
    delimiter: '/',
    autoPaginate: false,
    maxResults: PAGE_SIZE,
    pageToken,
  });

  const folders = ((apiResponse as { prefixes?: string[] } | undefined)?.prefixes || []) as string[];
  // The console's "create folder" leaves a zero-byte "folder/" object; it isn't a file.
  const listed = files.filter((file) => file.name !== prefix);
  const fileRows = listed.map((file) => describe(file.metadata as FileMetadata));
  const tagsByPath = Object.fromEntries(listed.map((file) => [file.name, ownerTagsOf(file.metadata as FileMetadata)]));
  const { labels, owners } = await describePaths([...(prefix ? [prefix] : []), ...folders, ...fileRows.map((f) => f.path)], tagsByPath);

  return {
    prefix,
    folders,
    files: fileRows,
    labels,
    owners,
    nextPageToken: (nextQuery as { pageToken?: string } | null)?.pageToken || null,
  };
});

/** The top-level folders with their file counts and sizes, each counted up to OVERVIEW_CAP files. */
const OVERVIEW_CAP = 5_000;
export const adminStorageOverview = onCall({ timeoutSeconds: 300 }, async (req) => {
  await assertStorageAdmin(req);
  const bucket = admin.storage().bucket();
  const [rootFiles, , apiResponse] = await bucket.getFiles({ delimiter: '/', autoPaginate: false, maxResults: 1000 });
  const folders = ((apiResponse as { prefixes?: string[] } | undefined)?.prefixes || []) as string[];

  const areas = await Promise.all(folders.map(async (prefix) => {
    let count = 0;
    let bytes = 0;
    let latest = '';
    let pageToken: string | undefined;
    do {
      const [files, nextQuery] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000, pageToken });
      files.forEach((file) => {
        count += 1;
        bytes += Number(file.metadata?.size || 0);
        const updated = String(file.metadata?.updated || '');
        if (updated > latest) latest = updated;
      });
      pageToken = (nextQuery as { pageToken?: string } | null)?.pageToken;
    } while (pageToken && count < OVERVIEW_CAP);
    return { prefix, count, bytes, latest: latest || null, capped: Boolean(pageToken) };
  }));

  return {
    areas,
    rootFiles: rootFiles.map((file) => describe(file.metadata as FileMetadata)),
  };
});

/** File count and total size of everything under a folder, up to MEASURE_CAP files. */
export const adminStorageMeasure = onCall({ timeoutSeconds: 300 }, async (req) => {
  await assertStorageAdmin(req);
  const prefix = cleanPrefix(req.data?.prefix);
  const bucket = admin.storage().bucket();

  let count = 0;
  let bytes = 0;
  let pageToken: string | undefined;
  do {
    const [files, nextQuery] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000, pageToken });
    files.forEach((file) => {
      count += 1;
      bytes += Number(file.metadata?.size || 0);
    });
    pageToken = (nextQuery as { pageToken?: string } | null)?.pageToken;
  } while (pageToken && count < MEASURE_CAP);

  return { prefix, count, bytes, capped: Boolean(pageToken) };
});

/**
 * A download link for one file. Uses the file's Firebase download token, and
 * adds one when the file has none (files written by functions), which is what
 * the Firebase console's "Create new access token" does.
 */
export const adminStorageFileUrl = onCall(async (req) => {
  await assertStorageAdmin(req);
  const path = cleanPath(req.data?.path);
  const bucket = admin.storage().bucket();
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'That file no longer exists.');

  const [meta] = await file.getMetadata();
  let token = String((meta as FileMetadata).metadata?.firebaseStorageDownloadTokens || '').split(',')[0];
  if (!token) {
    token = randomUUID();
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  }

  const { labels, owners, uploaders } = await describePaths([path], { [path]: ownerTagsOf(meta as FileMetadata) });
  return {
    ...describe(meta as FileMetadata),
    owner: owners[path] || null,
    uploader: uploaders[path] || null,
    // The named folders along the way, outermost first.
    trail: Object.entries(labels)
      .sort(([a], [b]) => a.length - b.length)
      .map(([folder, label]) => ({ folder, ...label })),
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
  };
});

/** Deletes up to MAX_DELETE files, each recorded in auditLogs with the reason given. */
export const adminStorageDelete = onCall(async (req) => {
  const caller = await assertStorageAdmin(req);
  const paths: string[] = Array.isArray(req.data?.paths) ? req.data.paths.map(cleanPath) : [];
  const reason = String(req.data?.reason || '').trim().slice(0, 500);
  if (!paths.length) throw new HttpsError('invalid-argument', 'Choose at least one file.');
  if (paths.length > MAX_DELETE) throw new HttpsError('invalid-argument', `Delete at most ${MAX_DELETE} files at a time.`);
  if (reason.length < 3) throw new HttpsError('invalid-argument', 'Give a reason for deleting.');

  const bucket = admin.storage().bucket();
  const db = admin.firestore();
  const deleted: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const path of Array.from(new Set(paths))) {
    const file = bucket.file(path);
    try {
      const [meta] = await file.getMetadata();
      await file.delete();
      deleted.push(path);
      await db.collection('auditLogs').add({
        type: 'storage_file_deleted',
        when: admin.firestore.FieldValue.serverTimestamp(),
        actor: { uid: caller.uid, email: caller.email, role: caller.role },
        target: {
          path,
          size: Number((meta as FileMetadata).size || 0),
          contentType: (meta as FileMetadata).contentType || null,
        },
        reason,
      });
    } catch (error: unknown) {
      const failure = error as { code?: number; message?: string } | null;
      failed.push({ path, error: failure?.code === 404 ? 'Not found' : String(failure?.message || error) });
    }
  }

  return { deleted, failed };
});
