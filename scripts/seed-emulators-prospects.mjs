// Prospects in the local emulators (used by seed-emulators.mjs; never on live): leads at every stage of both
// pipelines, with their history, follow-ups (some overdue), closed ones with reasons, and an event sign-up link.
//   Incubation: Demo Incubator (DEMO), /operations/participants/prospects, as projectadmin@demo-incubator.test
//   Training:   the training company (TNS), /training/prospects, as its facilitator
// Fixed ids, so re-running restores the same records.

const DAY = 24 * 3600 * 1000
const iso = (offsetDays, hour = 9) => {
    const date = new Date(Date.now() + offsetDays * DAY)
    date.setUTCHours(hour - 2, 0, 0, 0)
    return date.toISOString()
}
const dateOnly = (offsetDays) => iso(offsetDays).slice(0, 10)

const phoneKey = (value) => {
    const digits = String(value || '').replace(/\D/g, '')
    if (!digits) return ''
    return digits.startsWith('0') ? `+27${digits.slice(1)}` : `+${digits}`
}
const keysOf = ({ phone, email, registrationNumber }) => ({
    phone: phoneKey(phone), email: String(email || '').toLowerCase(), registration: String(registrationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
})

const ORDER = {
    incubation: ['new', 'contacted', 'invited', 'applied', 'joined'],
    training: ['new', 'contacted', 'proposal', 'booked', 'client'],
}

/**
 * One prospect and its history: `path` is the statuses it went through (days ago for each), the last one being where
 * it is now. A closed prospect ends in not_interested or lost with a reason.
 */
const prospect = (put, base, item) => {
    const { id, path, reason, followUp, ...fields } = item
    const steps = path.map(([status, daysAgo]) => ({ status, at: iso(-daysAgo, 10) }))
    const last = steps[steps.length - 1]
    const converted = last.status === (base.module === 'training' ? 'client' : 'joined')
    put(`smeProspects/${id}`, {
        companyCode: base.companyCode, module: base.module, kind: 'business', businessName: '', contactName: '', phone: '', email: '', registrationNumber: '',
        sector: '', province: 'Gauteng', ownership: [], source: 'event', sourceDetail: '', notes: '',
        programId: null, programName: null, interest: null,
        ownerUid: base.owner.uid, ownerName: base.owner.name,
        ...fields,
        keys: keysOf(fields),
        status: last.status, statusChangedAt: last.at,
        nextFollowUpAt: followUp === undefined ? null : dateOnly(followUp),
        closedReason: reason || null,
        ...(converted ? { convertedAt: last.at } : {}),
        consent: { given: true, source: fields.source === 'event' ? 'form' : fields.source === 'import' ? 'register' : 'verbal', contactAllowed: Boolean(fields.email), at: steps[0].at, recordedBy: base.owner.uid },
        createdAt: steps[0].at, createdBy: base.owner.uid, updatedAt: last.at, updatedBy: base.owner.uid, seededBy: 'emulators',
    })
    steps.forEach((step, index) => {
        put(`smeProspectEvents/${id}-${index}`, {
            companyCode: base.companyCode, prospectId: id, module: base.module, from: index ? steps[index - 1].status : null, to: step.status, at: step.at,
            by: base.owner.uid, byName: base.owner.name, ...(index === steps.length - 1 && reason ? { note: reason } : {}),
        })
    })
}

export const seedProspects = async ({ db, incubatorCode = 'DEMO', trainingCode = 'TNS', keletsoUid = 'tns-keletso' }) => {
    const batch = db.batch()
    let records = 0
    const put = (path, data) => { batch.set(db.doc(path), data); records += 1 }

    // ---- Incubation: Demo Incubator --------------------------------------------------------------------------------
    const demo = { companyCode: incubatorCode, module: 'incubation', owner: { uid: 'demo-operations', name: 'Olwethu Operations' } }
    const admin = { uid: 'demo-projectadmin', name: 'Demo Project Admin' }
    const accelerator = { programId: 'demo-prog-accelerator', programName: 'Demo Growth Accelerator 2026' }
    const digital = { programId: 'demo-prog-digital', programName: 'Digital Readiness Programme 2026' }
    const expo = 'Soweto Township Business Expo'
    ;[
        { id: 'demo-pr-01', businessName: 'Ikhaya Bakery', contactName: 'Nomvula Zulu', phone: '082 410 0001', email: 'nomvula@ikhaya-bakery.test', sector: 'Food production', ownership: ['black', 'women'], source: 'event', sourceDetail: expo, ...accelerator, path: [['new', 40]], followUp: -3, notes: 'Wants help with costing and a bigger oven.' },
        { id: 'demo-pr-02', businessName: 'Kasi Fix Mechanics', contactName: 'Tumi Mokoena', phone: '083 410 0002', sector: 'Automotive', ownership: ['black', 'youth'], source: 'event', sourceDetail: expo, path: [['new', 38], ['contacted', 30]], followUp: 0 },
        { id: 'demo-pr-03', businessName: 'GreenLeaf Hydroponics', contactName: 'Lebo Dube', phone: '084 410 0003', email: 'lebo@greenleaf.test', sector: 'Agriculture', province: 'Limpopo', ownership: ['black', 'women', 'youth'], source: 'referral', sourceDetail: 'Referred by Masakhane Poultry', ...accelerator, path: [['new', 60], ['contacted', 52], ['invited', 45]], followUp: 4 },
        { id: 'demo-pr-04', businessName: 'Vaal Print Studio', contactName: 'Pieter Botha', phone: '082 410 0004', email: 'pieter@vaalprint.test', registrationNumber: '2018/552311/07', sector: 'Printing', source: 'import', sourceDetail: 'SEDA workshop register (Feb)', ...digital, path: [['new', 90], ['contacted', 80], ['invited', 70], ['applied', 62]] },
        { id: 'demo-pr-05', businessName: 'Thandeka Cleaning Services', contactName: 'Thandeka Ngcobo', phone: '071 410 0005', email: 'thandeka@cleaning.test', sector: 'Cleaning', ownership: ['black', 'women'], source: 'training_class', sourceDetail: 'Business basics workshop, March', ...accelerator, path: [['new', 120], ['contacted', 110], ['invited', 100], ['applied', 95], ['joined', 80]] },
        { id: 'demo-pr-06', businessName: 'Mzansi Tech Repairs', contactName: 'Sibusiso Khumalo', phone: '072 410 0006', email: 'sbu@mzansitech.test', sector: 'ICT', ownership: ['black', 'youth'], source: 'website', ...digital, path: [['new', 75], ['contacted', 70], ['invited', 60], ['applied', 50], ['joined', 35]] },
        { id: 'demo-pr-07', businessName: 'Lekker Braai Spices', contactName: 'Anele Mthembu', phone: '073 410 0007', sector: 'Food production', source: 'event', sourceDetail: expo, path: [['new', 50], ['contacted', 44], ['not_interested', 30]], reason: 'Not the right time' },
        { id: 'demo-pr-08', businessName: 'Soweto Shoe Makers', contactName: 'Jabu Sithole', phone: '074 410 0008', sector: 'Manufacturing', source: 'walk_in', path: [['new', 100], ['contacted', 95], ['invited', 85], ['lost', 40]], reason: 'No response' },
        { id: 'demo-pr-09', businessName: 'Radebe Catering', contactName: 'Zanele Radebe', phone: '076 410 0009', email: 'zanele.r@radebecatering.test', sector: 'Hospitality', ownership: ['black', 'women'], source: 'event', sourceDetail: expo, path: [['new', 12]], followUp: 2, notes: 'Started trading last year; asked about the next intake.' },
        { id: 'demo-pr-10', businessName: 'Rainbow Crèche', contactName: 'Martha Molefe', phone: '079 410 0010', email: 'martha@rainbowcreche.test', sector: 'Education', ownership: ['black', 'women'], source: 'referral', sourceDetail: 'Ward councillor', path: [['new', 8]], followUp: -1 },
        { id: 'demo-pr-11', businessName: 'Ubuntu Builders', contactName: 'Kagiso Phiri', phone: '081 410 0011', sector: 'Construction', source: 'import', sourceDetail: 'SEDA workshop register (Feb)', path: [['new', 90], ['contacted', 70]], followUp: -10 },
    ].forEach((item, index) => prospect(put, { ...demo, owner: index % 3 === 2 ? admin : demo.owner }, item))

    put('prospectSignupLinks/demo-expo-link', {
        companyCode: incubatorCode, module: 'incubation', label: expo, active: true, source: 'event', signups: 4, ...accelerator,
        ownerUid: demo.owner.uid, ownerName: demo.owner.name, createdAt: iso(-41), createdBy: admin.uid, seededBy: 'emulators',
    })

    // ---- Training: the training company -------------------------------------------------------------------------------
    const tns = { companyCode: trainingCode, module: 'training', owner: { uid: keletsoUid, name: 'Keletso' } }
    const summit = 'Mining Sustainability Summit, Kathu'
    ;[
        { id: 'tns-pr-01', businessName: 'Sishen Haulage (Pty) Ltd', contactName: 'Johan Kruger', phone: '053 410 2001', email: 'johan@sishenhaulage.test', sector: 'Mining logistics', province: 'Northern Cape', source: 'event', sourceDetail: summit, interest: 'ESG Awareness Training', path: [['new', 20]], followUp: -2 },
        { id: 'tns-pr-02', businessName: 'Karoo Solar Farms', contactName: 'Aisha Patel', phone: '053 410 2002', email: 'aisha@karoosolar.test', sector: 'Energy', province: 'Northern Cape', source: 'event', sourceDetail: summit, interest: 'ESG report', path: [['new', 20], ['contacted', 15], ['proposal', 9]], followUp: 3, notes: 'Sent a quote for a GRI-referenced report.' },
        { id: 'tns-pr-03', businessName: 'Kalahari Water Board', contactName: 'Mpho Seleka', phone: '053 410 2003', email: 'mpho@kalahariwater.test', sector: 'Utilities', province: 'Northern Cape', source: 'referral', sourceDetail: 'Kgalagadi Mining', interest: 'ESG Awareness Training', bookedClassId: 'tns-class-online', bookedClassLabel: 'ESG Awareness Training (hybrid class)', path: [['new', 45], ['contacted', 40], ['proposal', 30], ['booked', 12]] },
        { id: 'tns-pr-04', businessName: 'Anatolia Logistics', contactName: 'Mehmet Arslan', email: 'mehmet@anatolia-logistics.test', sector: 'Logistics', province: 'Istanbul', source: 'website', sourceDetail: 'Website enquiry form', interest: 'Carbon footprint', path: [['new', 60], ['contacted', 55], ['proposal', 48], ['client', 30]] },
        { id: 'tns-pr-05', kind: 'person', contactName: 'Refilwe Moagi', phone: '072 410 2005', email: 'refilwe@mail.test', source: 'training_class', sourceDetail: 'ESG Awareness Training (open class)', interest: 'ESG Refresher', path: [['new', 25], ['contacted', 20]], followUp: 0 },
        { id: 'tns-pr-06', businessName: 'Postmasburg Cement', contactName: 'Hendrik Smit', phone: '053 410 2006', sector: 'Manufacturing', province: 'Northern Cape', source: 'event', sourceDetail: summit, interest: 'In-house training for staff', path: [['new', 20], ['contacted', 14], ['lost', 5]], reason: 'Chose another provider' },
    ].forEach((item) => prospect(put, tns, item))

    // Income from a client that came in as a prospect, for the 'which events bring paying clients' view.
    put('clientRevenue/tns-income-prospect-01', { companyCode: trainingCode, date: dateOnly(-25), organisation: 'Anatolia Logistics', service: 'esg_reporting', classId: null, reportId: null, description: 'Carbon footprint 2025', amount: 38000, status: 'paid', paidOn: dateOnly(-10), createdAt: iso(-25), createdBy: keletsoUid, updatedAt: iso(-25), updatedBy: keletsoUid, seededBy: 'emulators' })

    put('prospectSignupLinks/tns-summit-link', {
        companyCode: trainingCode, module: 'training', label: summit, active: true, source: 'event', signups: 3,
        ownerUid: tns.owner.uid, ownerName: tns.owner.name, createdAt: iso(-21), createdBy: keletsoUid, seededBy: 'emulators',
    })

    await batch.commit()
    return { records, links: { incubation: '/p/demo-expo-link', training: '/p/tns-summit-link' } }
}
