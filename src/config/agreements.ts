// Agreements people sign in the welcome flow (or on /consent), saved to `companyAgreementSubmissions`.
// Ported from the earlier Incubation Platform. SMEs sign both; every other role signs the consent form.
// Shared so the compliance page can rebuild the signed document with the exact wording.

export type CompanyAgreementKey = 'code-of-conduct' | 'company-consent'

export type CompanyAgreementDefinition = {
    key: CompanyAgreementKey
    title: string
    subtitle: string
    savedMessage: string
    acceptLabel: string
    sections: Array<{
        title: string
        body?: string
        bullets?: string[]
    }>
}

export type BeneficiarySnapshot = {
    fullName?: string
    idNumber?: string
    dateOfBirth?: string
    age?: string | number
    nationality?: string
    citizenship?: string
    residentialAddress?: string
    postalAddress?: string
    email?: string
    mobileNumber?: string
    businessName?: string
    taxNumber?: string
}

// Stored on every submission as `version`. If the wording below changes, add the new
// wording under a new version in COMPANY_AGREEMENT_VERSIONS and keep the old entry, so
// previously signed agreements still download with the text that was actually accepted.
export const COMPANY_AGREEMENTS_VERSION = 'generic-company-agreements-v1'

export const COMPANY_AGREEMENTS: Record<CompanyAgreementKey, CompanyAgreementDefinition> = {
    'code-of-conduct': {
        key: 'code-of-conduct',
        title: 'Code of Conduct & Funding Acknowledgement',
        subtitle: 'Programme standards, conduct expectations, and funding acknowledgement.',
        savedMessage: 'Code of conduct already accepted',
        acceptLabel:
            'I have read, understood, and agree to comply with this Code of Conduct and Funding Acknowledgement.',
        sections: [
            {
                title: '1. Purpose',
                body:
                    'This Code of Conduct sets out the standards of behaviour, responsibilities, and expectations for entrepreneurs participating in the programme. Participation is conditional upon adherence to this Code of Conduct.'
            },
            {
                title: '2. Funding principles',
                bullets: [
                    'Funding support does not create an automatic entitlement to cash or direct payment.',
                    'Where funding or resources are approved, they must be used only for approved business tools, equipment, services, resources, or programme-related purposes.',
                    'Funding decisions are made according to programme criteria, funder requirements, compliance, available budget, and business viability.',
                    'Misrepresentation, resale, diversion, or misuse of funded resources is a serious breach of this Code of Conduct.'
                ]
            },
            {
                title: '3. Professional conduct',
                bullets: [
                    'Entrepreneurs must conduct themselves respectfully and professionally at all times.',
                    'Entrepreneurs must uphold integrity, accountability, respect, and excellence.',
                    'Abusive, threatening, discriminatory, dishonest, or disruptive behaviour is not allowed.',
                    'Entrepreneurs must communicate honestly with programme staff, advisors, consultants, funders, and authorised stakeholders.',
                    'Any behaviour that brings the programme, the organisation, or its partners into disrepute may result in suspension or removal.'
                ]
            },
            {
                title: '4. Attendance and participation',
                bullets: [
                    'Entrepreneurs must attend mandatory training sessions, workshops, advisory meetings, and programme activities.',
                    'Entrepreneurs must be punctual, prepared, and actively involved.',
                    'The Programme Coordinator or responsible programme team must be notified in advance where attendance is not possible.',
                    'Repeated absence, late submission, or disengagement may affect programme benefits and funding eligibility.'
                ]
            },
            {
                title: '5. Relationship with advisors and consultants',
                bullets: [
                    'Entrepreneurs must maintain professional working relationships with assigned advisors, consultants, mentors, and programme staff.',
                    'Entrepreneurs must provide accurate financial, operational, and business information when requested.',
                    'Entrepreneurs must implement agreed action plans where applicable and remain open to feedback and coaching.',
                    'Failure to cooperate with programme support processes may affect continued participation.'
                ]
            },
            {
                title: '6. Compliance and documentation',
                bullets: [
                    'Entrepreneurs must provide truthful and accurate information at all times.',
                    'Entrepreneurs must submit required documentation within specified timeframes.',
                    'Entrepreneurs must comply with reporting, audit, monitoring, and evaluation requirements linked to the programme.',
                    'False information or withholding material information may result in immediate removal from the programme.'
                ]
            },
            {
                title: '7. Conflict of interest and ethical conduct',
                bullets: [
                    'Entrepreneurs must disclose any actual or potential conflicts of interest.',
                    'Entrepreneurs must not attempt to influence funding, procurement, or programme decisions improperly.',
                    'Entrepreneurs must not offer gifts, incentives, or personal benefits to staff, advisors, consultants, or decision-makers.'
                ]
            },
            {
                title: '8. Protection of funded assets',
                bullets: [
                    'Tools, equipment, or resources funded through the programme must be used for approved business purposes only.',
                    'Funded assets may not be sold, pawned, transferred, or misused.',
                    'Funded assets may be subject to verification visits or monitoring checks.',
                    'Misuse of assets may result in recovery action, withdrawal of support, and termination from the programme.'
                ]
            },
            {
                title: '9. Consequences of breach',
                bullets: [
                    'The organisation may issue written warnings, suspend participation, withdraw approvals, remove the participant from the programme, or notify funders where required.',
                    'All decisions will be made to protect programme integrity, funder trust, participating businesses, and organisational sustainability.'
                ]
            },
            {
                title: '10. Acknowledgement and agreement',
                bullets: [
                    'I confirm that I have read and understood this Code of Conduct.',
                    'I acknowledge that programme funding or resources are subject to approval and are not guaranteed.',
                    'I agree to comply with programme requirements, funding processes, reporting requirements, and ethical standards.',
                    'I understand that non-compliance may result in removal from the programme.'
                ]
            }
        ]
    },
    'company-consent': {
        key: 'company-consent',
        title: 'Consent to Collect, Process and Share Information',
        subtitle: 'Consent for programme administration, communication, reporting, monitoring, and media use.',
        savedMessage: 'Consent form already accepted',
        acceptLabel:
            'I have read, understood, and voluntarily consent to the collection, processing, storage, retention, sharing, and use of my information as outlined above.',
        sections: [
            {
                title: '1. Consent to process information',
                body:
                    'I consent to the organisation collecting, processing, storing, retaining, and sharing my personal, business, and programme-related information for legitimate programme purposes.'
            },
            {
                title: '2. Information that may be processed',
                body:
                    'The information may include full names, identity number, date of birth, race, gender, contact details, residential address, business information, financial and operational information, programme records, attendance records, documents, assessments, reports, and any other information reasonably required for programme administration.'
            },
            {
                title: '3. Purpose of processing',
                bullets: [
                    'Programme administration and participant onboarding.',
                    'Monitoring and evaluation.',
                    'Reporting to authorised stakeholders and funders.',
                    'Communication, scheduling, support, training, mentoring, and advisory services.',
                    'Funding compliance, audit, verification, research, and legitimate programme-related activities.'
                ]
            },
            {
                title: '4. Sharing of information',
                body:
                    'I consent to the organisation sharing my information with programme partners, funders, service providers, auditors, consultants, advisors, and authorised stakeholders where required for programme implementation, monitoring, reporting, auditing, compliance, support, or any legitimate business or legal requirement.'
            },
            {
                title: '5. Data protection',
                body:
                    'My information must be processed in line with applicable data protection legislation and reasonable security safeguards. Information will only be retained for as long as required for programme, legal, reporting, audit, operational, or legitimate business purposes.'
            },
            {
                title: '6. Photographs, videos, voice recordings, and media use',
                bullets: [
                    'I consent to photographs, videos, and voice recordings being taken during programme activities.',
                    'These materials may be used for social media, online platforms, print media, television, radio, reports, impact reports, presentations, proposals, marketing material, annual reports, and training or educational material.',
                    'I understand that these materials may be used in future communication and promotional material without further notification.',
                    'I understand that no personal or financial compensation will be payable for the use of these materials.'
                ]
            },
            {
                title: '7. Withdrawal of consent',
                body:
                    'I understand that I may withdraw consent where permitted by law. Withdrawal will not affect processing already undertaken or processing required to fulfil contractual, programme, audit, reporting, or legal obligations.'
            },
            {
                title: '8. Declaration',
                body:
                    'I confirm that the information held by the platform is true and correct to the best of my knowledge and that I voluntarily consent to the processing and sharing of my information for programme-related purposes.'
            }
        ]
    }
}

export const COMPANY_AGREEMENT_KEYS: CompanyAgreementKey[] = ['code-of-conduct', 'company-consent']

export const COMPANY_AGREEMENT_VERSIONS: Record<string, Record<CompanyAgreementKey, CompanyAgreementDefinition>> = {
    [COMPANY_AGREEMENTS_VERSION]: COMPANY_AGREEMENTS
}

// Wording for a saved submission's version; `isExactVersion` is false when that version is unknown.
export const getCompanyAgreement = (key: CompanyAgreementKey, version?: string) => {
    const versioned = version ? COMPANY_AGREEMENT_VERSIONS[version]?.[key] : undefined
    return { definition: versioned || COMPANY_AGREEMENTS[key], isExactVersion: !!versioned }
}
