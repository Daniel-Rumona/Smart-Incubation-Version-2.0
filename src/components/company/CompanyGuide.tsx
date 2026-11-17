import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Drawer, Input, Space, Typography } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'

/**
 * The client company's helper: plain answers to "how do I…" and a button that takes them there. It works from the
 * portal's own pages only and reads no records, so it can never show another company's data. (The workspace AI
 * assistant stays off for client companies until it is limited to their own company.)
 */

type Topic = { key: string; question: string; answer: string; to: string; go: string; words: string[] }

export const CompanyGuide = () => {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [asked, setAsked] = useState<Topic | null>(null)
    const [draft, setDraft] = useState('')
    const [unmatched, setUnmatched] = useState(false)

    const TOPICS: Topic[] = [
        { key: 'add', question: t('How do I add someone to my team?'), answer: t('Open Team and press "Add a person". Enter their name and email. If you are the one being trained, press "Add me".'), to: '/company/team', go: t('Open Team'), words: ['add', 'person', 'staff', 'employee', 'team', 'me'] },
        { key: 'book', question: t('How do I book someone on a class?'), answer: t('Open Team. Next to the person, press "Book on a class" and choose the class. Your training provider sends them a sign-in link before it starts.'), to: '/company/team', go: t('Open Team'), words: ['book', 'class', 'course', 'training', 'enrol'] },
        { key: 'edit', question: t('How do I change or remove someone?'), answer: t('Open Team. Each person has "Edit" and "Remove". Removing them also withdraws a booking the provider has not acted on yet.'), to: '/company/team', go: t('Open Team'), words: ['edit', 'change', 'remove', 'delete', 'wrong'] },
        { key: 'certificates', question: t('Where are my team\'s certificates?'), answer: t('Open Certificates. Each certificate can be downloaded, and anyone can check it with its QR code.'), to: '/company/certificates', go: t('Open Certificates'), words: ['certificate', 'download', 'pass', 'result'] },
        { key: 'profile', question: t('Where do I update my company details?'), answer: t('Open Company profile. Company details, documents and business figures are all there.'), to: '/company/profile', go: t('Open profile'), words: ['detail', 'profile', 'document', 'business', 'revenue', 'figures', 'address'] },
        { key: 'materials', question: t('Where are the course materials?'), answer: t('Open Course materials from your home page. It lists everything your training provider shares with your company.'), to: '/company/documents', go: t('Open course materials'), words: ['material', 'manual', 'slides', 'reading'] },
    ]

    const send = (event: FormEvent) => {
        event.preventDefault()
        const lower = draft.toLowerCase()
        const best = TOPICS.map((topic) => ({ topic, hits: topic.words.filter((word) => lower.includes(word)).length })).sort((a, b) => b.hits - a.hits)[0]
        setDraft('')
        if (best.hits) { setAsked(best.topic); setUnmatched(false) } else { setAsked(null); setUnmatched(true) }
    }

    return (
        <>
            <Button type="primary" shape="round" className="cp-guide-button" onClick={() => setOpen(true)} aria-label={t('Help')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 6, verticalAlign: '-3px' }}>
                    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
                </svg>
                {t('Help')}
            </Button>
            <Drawer open={open} onClose={() => setOpen(false)} title={t('How can I help?')} width={400}>
                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                    {TOPICS.map((topic) => (
                        <Button key={topic.key} block size="large" className="cp-guide-question" type={asked?.key === topic.key ? 'primary' : 'default'} onClick={() => { setAsked(topic); setUnmatched(false) }}>{topic.question}</Button>
                    ))}
                    {asked && (
                        <div className="cp-guide-answer">
                            <Typography.Paragraph style={{ marginBottom: 12 }}>{asked.answer}</Typography.Paragraph>
                            <Button type="primary" size="large" onClick={() => { setOpen(false); navigate(asked.to) }}>{asked.go} <RightOutlined /></Button>
                        </div>
                    )}
                    {unmatched && <Typography.Text type="secondary">{t('Pick one of the questions above, or ask your training provider.')}</Typography.Text>}
                    <form onSubmit={send} style={{ display: 'flex', gap: 8 }}>
                        <Input size="large" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('Ask how to do something…')} aria-label={t('Ask how to do something')} />
                        <Button size="large" htmlType="submit">{t('Ask')}</Button>
                    </form>
                </Space>
            </Drawer>
        </>
    )
}

export default CompanyGuide
