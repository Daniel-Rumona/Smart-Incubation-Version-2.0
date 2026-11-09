import type { TrainingLibraryAudience, TrainingLibraryCategory } from '@/types/training'

/**
 * What a document added to the training library probably is, from its file name alone, so uploading needs no typing:
 * a title from the name, its type, the course (her only course, when she has one) and who sees it. Everything can be
 * changed before it is saved. No runtime imports, so it also runs under Node in tests.
 *
 * - Facilitator material, memos and marking guides: reference, only her team.
 * - Templates, toolkits, forms and registers: template.
 * - Manuals, slides, presentations, modules and learner material: course material.
 * - Other guides: reference. Anything else: reading.
 */
export type LibraryGuess = {
    title: string
    category: TrainingLibraryCategory
    courseTitle: string
    audience: TrainingLibraryAudience
}

const STAFF_ONLY = /\b(facilitators?|memos?|memorandum|memoranda|marking)\b/
const TEMPLATE = /\b(templates?|toolkits?|forms?|registers?)\b/
const COURSE_MATERIAL = /\b(manuals?|slides?|presentations?|modules?|learners?)\b/
const GUIDE = /\bguides?\b/

/** "01_Learner_Manual.docx" -> "Learner Manual": a pack's 1-2 digit numbering goes, a year ("2025 report") stays. */
export const libraryTitleFromFileName = (fileName: string) =>
    fileName.replace(/\.[^.]+$/, '').replace(/^\d{1,2}(?:[\s._-]+)(?=\S)/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

export const guessLibraryDetails = (fileName: string, courses: string[]): LibraryGuess => {
    const words = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    const staffOnly = STAFF_ONLY.test(words)
    const category: TrainingLibraryCategory = staffOnly ? 'reference'
        : TEMPLATE.test(words) ? 'template'
            : COURSE_MATERIAL.test(words) ? 'course_material'
                : GUIDE.test(words) ? 'reference'
                    : 'reading'
    const distinctCourses = [...new Set(courses.map((course) => course.trim()).filter(Boolean))]
    return {
        title: libraryTitleFromFileName(fileName) || fileName,
        category,
        courseTitle: distinctCourses.length === 1 ? distinctCourses[0] : '',
        audience: staffOnly ? 'staff' : 'shared',
    }
}
