import { doc, getDoc, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import PizZip from 'pizzip'
import { getFirebaseDb } from '@/config/firebase'
import { storage } from '@/firebase'
import { generateLessonId, type LessonMaterial } from '@/services/courseTemplatesService'

const TEXTS = 'courseMaterialTexts'

export const MATERIAL_ACCEPT = '.pdf,.docx,.txt,.md'
export const MAX_MATERIAL_BYTES = 15 * 1024 * 1024
/** Firestore documents cap at 1 MiB, so extracted text is trimmed well below that. */
const MAX_TEXT_CHARS = 150_000

const materialKind = (name: string): LessonMaterial['kind'] | null => {
    const lower = name.toLowerCase()
    if (lower.endsWith('.pdf')) return 'pdf'
    if (lower.endsWith('.docx')) return 'docx'
    if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text'
    return null
}

export const isSupportedMaterial = (file: File) => materialKind(file.name) !== null

const extractPdfText = async (file: File) => {
    const pdfjs = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = worker

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const content = await page.getTextContent()
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }

    return pages.join('\n\n')
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

const extractDocxText = async (file: File) => {
    const zip = new PizZip(await file.arrayBuffer())
    const xml = zip.file('word/document.xml')?.asText() || ''

    return xml
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] || entity)
}

/** Pulls the readable text out of a file in the browser, so the assistant can be given the material itself. */
export const extractMaterialText = async (file: File) => {
    const kind = materialKind(file.name)
    const raw = kind === 'pdf' ? await extractPdfText(file) : kind === 'docx' ? await extractDocxText(file) : await file.text()
    return raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT_CHARS)
}

/**
 * Stores the original file (so learners can open it) and its extracted text
 * (so the assistant can read it). The text lives in its own collection, keyed
 * by material id, to keep the course document small.
 */
export const uploadCourseMaterial = async (file: File, knownText?: string): Promise<{ material: LessonMaterial, readable: boolean }> => {
    const kind = materialKind(file.name)
    if (!kind) throw new Error('Unsupported file type. Use PDF, Word (.docx), text or Markdown.')
    if (file.size > MAX_MATERIAL_BYTES) throw new Error('That file is larger than 15 MB.')

    const id = generateLessonId()
    // Callers that already extracted the text (e.g. to generate lessons) pass it in rather than reading the file twice.
    const text = knownText ?? await extractMaterialText(file)

    const stored = ref(storage, `courseMaterials/${id}/${file.name}`)
    await uploadBytes(stored, file)
    const url = await getDownloadURL(stored)

    await setDoc(doc(getFirebaseDb(), TEXTS, id), { name: file.name, text, createdAt: new Date().toISOString() })

    return { material: { id, name: file.name, kind, size: file.size, url, chars: text.length }, readable: text.length > 0 }
}

/** The extracted text for each material, by id. Anything that cannot be read is simply left out. */
export const loadMaterialTexts = async (materials: LessonMaterial[]): Promise<Record<string, string>> => {
    const entries = await Promise.all(materials.map(async (material) => {
        try {
            const snapshot = await getDoc(doc(getFirebaseDb(), TEXTS, material.id))
            return [material.id, String(snapshot.data()?.text || '')] as const
        } catch {
            return [material.id, ''] as const
        }
    }))

    return Object.fromEntries(entries.filter(([, text]) => text))
}
