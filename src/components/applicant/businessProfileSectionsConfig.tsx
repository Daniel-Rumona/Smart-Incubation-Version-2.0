import type { ReactNode } from 'react'
import { EnvironmentOutlined, FileProtectOutlined, ShopOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import type { ApplicantProfileFormValues } from '@/pages/applicant/ApplicantProfilePage'

export type FieldName = keyof ApplicantProfileFormValues

/**
 * How a value reads on the page: `label` turns stored option values into words, `paragraph` is
 * free text on its own line, `masked` hides the middle of an ID number, and `tag` shows the value
 * as a small chip under the section instead of a labelled cell.
 */
export type SectionField = {
    name: FieldName
    label: string
    kind?: 'label' | 'date' | 'paragraph' | 'masked' | 'tag'
    wide?: boolean
    /** Shown in the same cell after this field's value (registration number after its status). */
    joinWith?: FieldName
    /** Hidden once directors are captured, because the directors section shows it instead. */
    fromDirectors?: boolean
}

export type BusinessProfileSectionKey = 'personal' | 'business' | 'directors' | 'compliance' | 'location'

/**
 * The business comes first (main column), the people second (side column on desktop).
 * `steps` are the manual form's step indexes each section edits.
 */
export const BUSINESS_PROFILE_SECTIONS: { key: BusinessProfileSectionKey, title: string, icon: ReactNode, column: 'main' | 'side', steps: number[], fields: SectionField[] }[] = [
    {
        key: 'business', title: 'Business', icon: <ShopOutlined />, column: 'main', steps: [2],
        fields: [
            { name: 'businessName', label: 'Business name' },
            { name: 'sector', label: 'Sector' },
            { name: 'natureOfBusiness', label: 'What the business does', kind: 'paragraph', wide: true },
            { name: 'yearsOfTrading', label: 'Years of trading' },
        ],
    },
    {
        key: 'compliance', title: 'Registration and compliance', icon: <FileProtectOutlined />, column: 'main', steps: [3],
        fields: [
            { name: 'registrationStatus', label: 'Registration', kind: 'label', joinWith: 'registrationNumber' },
            { name: 'dateOfRegistration', label: 'Date registered', kind: 'date' },
            { name: 'beeLevel', label: 'B-BBEE level' },
            { name: 'blackOwnedPercent', label: 'Black-owned %', fromDirectors: true },
            { name: 'femaleOwnedPercent', label: 'Female-owned %', fromDirectors: true },
            { name: 'youthOwnedPercent', label: 'Youth-owned %', fromDirectors: true },
        ],
    },
    {
        key: 'location', title: 'Location', icon: <EnvironmentOutlined />, column: 'main', steps: [4],
        fields: [
            { name: 'businessAddress', label: 'Business address', wide: true },
            { name: 'city', label: 'City / town' },
            { name: 'province', label: 'Province' },
            { name: 'postalCode', label: 'Postal code' },
            { name: 'locationType', label: 'Location type', kind: 'tag' },
            { name: 'hostCommunity', label: 'Host community', kind: 'tag' },
        ],
    },
    // Directors are a list with their own add / edit, not a set of form fields.
    { key: 'directors', title: 'Directors and ownership', icon: <TeamOutlined />, column: 'side', steps: [], fields: [] },
    {
        key: 'personal', title: 'Your details', icon: <UserOutlined />, column: 'side', steps: [0, 1],
        fields: [
            { name: 'participantName', label: 'Name', wide: true },
            { name: 'phone', label: 'Phone' },
            { name: 'idNumber', label: 'ID number', kind: 'masked' },
            { name: 'email', label: 'Email', wide: true },
            { name: 'gender', label: 'Gender', kind: 'label' },
            { name: 'alternativePhone', label: 'Alternative phone' },
            { name: 'maritalStatus', label: 'Marital status', kind: 'label' },
            { name: 'educationLevel', label: 'Education', kind: 'label' },
            { name: 'employmentStatus', label: 'Employment status', kind: 'label' },
            { name: 'disabilityStatus', label: 'Disability status', kind: 'label' },
        ],
    },
]

export const hasProfileValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== ''
