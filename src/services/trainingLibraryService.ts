import { collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import { extractMaterialText, isSupportedMaterial } from '@/services/courseMaterialsService'
import { trainingCompanyOf } from '@/services/trainingService'
import type { FullIdentity } from '@/types/identity'
import type { TrainingLibraryAudience, TrainingLibraryCategory, TrainingLibraryItem, TrainingLibraryValues } from '@/types/training'

/**
 * The training company's library: course material, reading, templates and references, as files or links.
 *
 * Shared items are for her learners and client companies too; staff items stay with her team. Files sit under
 * `training-library/{company}/{item}/` and are fetched through the storage rules, never by a shareable link. The
 * readable text of PDF, Word and text files is kept in trainingLibraryTexts (staff and the assistant only), so Q can
 * answer from her own material.
 */

const LIBRARY = 'trainingLibrary'
const TEXTS = 'trainingLibraryTexts'

export const LIBRARY_ACCEPT = '.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.md,.jpg,.jpeg,.png'
export const MAX_LIBRARY_BYTES = 25 * 1024 * 1024
const CATEGORIES: TrainingLibraryCategory[] = ['course_material', 'reading', 'template', 'reference']

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const now = () => new Date().toISOString()

export const toLibraryItem = (id: string, data: Record<string, unknown>): TrainingLibraryItem => ({
    id,
    companyCode: text(data.companyCode),
    title: text(data.title),
    description: text(data.description),
    category: CATEGORIES.includes(data.category as TrainingLibraryCategory) ? data.category as TrainingLibraryCategory : 'reference',
    courseTitle: text(data.courseTitle),
    audience: data.audience === 'staff' ? 'staff' : 'shared',
    kind: data.kind === 'link' ? 'link' : 'file',
    fileName: text(data.fileName) || undefined,
    storagePath: text(data.storagePath) || undefined,
    contentType: text(data.contentType) || undefined,
    size: typeof data.size === 'number' ? data.size : undefined,
    url: text(data.url) || undefined,
    textChars: typeof data.textChars === 'number' ? data.textChars : 0,
    createdAt: text(data.createdAt) || undefined,
    updatedAt: text(data.updatedAt) || undefined,
})

const byTitle = (rows: TrainingLibraryItem[]) => [...rows].sort((left, right) => left.title.localeCompare(right.title))

/** Staff see the whole library; learners and client companies the shared items of their training company. */
export const listTrainingLibrary = async (user: FullIdentity) => {
    const companyCode = text(user.companyCode)
    if (!companyCode) return []
    const source = collection(getFirebaseDb(), LIBRARY)
    const staff = user.role === 'projectadmin' || user.role === 'operations'
    const snapshot = await getDocs(staff
        ? query(source, where('companyCode', '==', companyCode))
        : query(source, where('companyCode', '==', companyCode), where('audience', '==', 'shared')))
    return byTitle(snapshot.docs.map((row) => toLibraryItem(row.id, row.data())))
}

/** The items a learner of this course sees: those for the course and those for every course. */
export const itemsForCourse = (items: TrainingLibraryItem[], courseTitle: string) =>
    items.filter((item) => item.audience === 'shared' && (!item.courseTitle || item.courseTitle.toLowerCase() === courseTitle.trim().toLowerCase()))

const cleanValues = (values: TrainingLibraryValues) => ({
    title: values.title.trim(),
    description: values.description.trim(),
    category: CATEGORIES.includes(values.category) ? values.category : 'reference',
    courseTitle: values.courseTitle.trim(),
    audience: (values.audience === 'staff' ? 'staff' : 'shared') as TrainingLibraryAudience,
})

export const libraryFileProblem = (file: File): 'size' | null => (file.size > MAX_LIBRARY_BYTES ? 'size' : null)

/** Uploads a file to the library with its readable text (when it has any) for the assistant. */
export const addLibraryFile = async (user: FullIdentity, values: TrainingLibraryValues, file: File) => {
    const companyCode = trainingCompanyOf(user)
    if (libraryFileProblem(file)) throw new Error('library_file_size')
    const item = doc(collection(getFirebaseDb(), LIBRARY))
    const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-100) || 'document'
    const storagePath = `training-library/${companyCode}/${item.id}/${safeName}`
    const contentType = file.type || 'application/octet-stream'
    await uploadBytes(ref(getFirebaseStorage(), storagePath), file, { contentType })
    const readable = isSupportedMaterial(file) ? await extractMaterialText(file).catch(() => '') : ''
    const clean = cleanValues(values)
    const batch = writeBatch(getFirebaseDb())
    batch.set(item, {
        ...clean,
        companyCode,
        kind: 'file',
        fileName: file.name,
        storagePath,
        contentType,
        size: file.size,
        textChars: readable.length,
        createdAt: now(),
        createdBy: user.uid,
        updatedAt: now(),
        updatedBy: user.uid,
    })
    if (readable) batch.set(doc(getFirebaseDb(), TEXTS, item.id), { companyCode, audience: clean.audience, title: clean.title, text: readable, updatedAt: now() })
    await batch.commit()
    return item.id
}

/** A link (a website, a video, a shared folder) with its description. */
export const addLibraryLink = async (user: FullIdentity, values: TrainingLibraryValues) => {
    const companyCode = trainingCompanyOf(user)
    const url = text(values.url)
    if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('invalid_url')
    const item = doc(collection(getFirebaseDb(), LIBRARY))
    await setDoc(item, { ...cleanValues(values), companyCode, kind: 'link', url, textChars: 0, createdAt: now(), createdBy: user.uid, updatedAt: now(), updatedBy: user.uid })
    return item.id
}

export const updateLibraryItem = async (user: FullIdentity, item: TrainingLibraryItem, values: TrainingLibraryValues) => {
    trainingCompanyOf(user)
    const clean = cleanValues(values)
    const url = item.kind === 'link' ? text(values.url) : undefined
    if (item.kind === 'link' && !/^https?:\/\/\S+$/i.test(url || '')) throw new Error('invalid_url')
    await updateDoc(doc(getFirebaseDb(), LIBRARY, item.id), { ...clean, ...(url ? { url } : {}), updatedAt: now(), updatedBy: user.uid })
    if (item.textChars) await updateDoc(doc(getFirebaseDb(), TEXTS, item.id), { audience: clean.audience, title: clean.title, updatedAt: now() })
}

export const deleteLibraryItem = async (user: FullIdentity, item: TrainingLibraryItem) => {
    trainingCompanyOf(user)
    if (item.storagePath) await deleteObject(ref(getFirebaseStorage(), item.storagePath)).catch(() => undefined)
    if (item.textChars) await deleteDoc(doc(getFirebaseDb(), TEXTS, item.id)).catch(() => undefined)
    await deleteDoc(doc(getFirebaseDb(), LIBRARY, item.id))
}

/**
 * Opens a link, or a file from a short-lived local link: PDFs, pictures and text open in a new tab, anything else
 * (Word, PowerPoint, Excel) downloads under its own name.
 */
export const openLibraryItem = async (item: TrainingLibraryItem) => {
    if (item.kind === 'link' && item.url) {
        window.open(item.url, '_blank', 'noopener')
        return
    }
    if (!item.storagePath) return
    const blob = await getBlob(ref(getFirebaseStorage(), item.storagePath))
    const url = URL.createObjectURL(blob)
    if (/^(application\/pdf|image\/|text\/)/.test(item.contentType || '')) {
        window.open(url, '_blank', 'noopener')
    } else {
        const link = document.createElement('a')
        link.href = url
        link.download = item.fileName || item.title
        link.click()
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
