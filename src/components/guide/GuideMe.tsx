import { Button, Modal } from 'antd'
import { CompassOutlined, FormOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import '@/styles/guide-me.css'
import { usePageGuide } from '@/components/guide/PageGuideContext'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type GuideMeProps = {
    mode: 'agentic' | 'workspace'
    pageName: string
    role?: string
    /** Hide the built-in launcher when the trigger lives elsewhere, such as the mobile account panel. */
    hideTrigger?: boolean
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

const roleDetails: Record<string, { label: string; insight: string }> = {
    incubatee: { get label() { return tr('SME') }, insight: 'Use your dashboard to keep interventions, documents and growth-plan actions moving.' },
    consultant: { get label() { return tr('Consultant') }, insight: 'Use your allocated workspaces to deliver support and follow up on active interventions.' },
    projectadmin: { get label() { return tr('Project administrator') }, insight: 'Use programme views to coordinate delivery, participants and completion evidence.' },
    operations: { get label() { return tr('Operations') }, insight: 'Use operational views to monitor delivery, assignments and risks across the programme.' },
    admin: { get label() { return tr('Administrator') }, insight: 'Use platform controls to manage workspace health, users and programme oversight.' },
    systemadmin: { get label() { return tr('System administrator') }, insight: 'Use platform controls to manage workspace health, users and programme oversight.' },
}

const roleDetail = (role?: string) => roleDetails[String(role || '').toLowerCase()] || { label: tr('Workspace member'), insight: 'Use the navigation to find the tools and records available to you.' }

const firstVisible = (selectors: string) => (): Element | undefined => Array
    .from(document.querySelectorAll<HTMLElement>(selectors))
    .find((element) => element.offsetParent !== null)

const guideElement = (selectors: string) => firstVisible(selectors) as unknown as () => Element

const openThenContinue = (selector: string) => (
    _element: Element | undefined,
    _step: DriveStep,
    { driver: guide }: { driver: ReturnType<typeof driver> },
) => {
    const target = firstVisible(selector)()
    target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    window.setTimeout(() => guide.moveNext(), 180)
}

const launchTour = (steps: DriveStep[]) => {
    const guide = driver({
        steps,
        animate: true,
        smoothScroll: true,
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.55,
        stagePadding: 8,
        stageRadius: 14,
        popoverClass: 'smart-incubation-guide-popover',
        nextBtnText: 'Next',
        doneBtnText: 'Finish',
    })
    guide.drive()
}

const orientedSteps = (mode: GuideMeProps['mode'], pageName: string): DriveStep[] => {
    const steps: DriveStep[] = [
        { element: '#guide-app-topbar', popover: { title: tr('Welcome to Smart Incubation'), description: tr('This top bar keeps your workspace controls, guide and account tools within reach.'), side: 'bottom', align: 'center' } },
        { element: '#guide-mode-switch', popover: { title: tr('Choose your working mode'), description: tr('Agentic is for guided, conversational work. Workspace gives you the full set of tools and records.'), side: 'bottom', align: 'center' } },
    ]
    if (mode === 'workspace') {
        steps.push(
            { element: '#guide-scope-selector', skipMissingElement: true, popover: { title: tr('Set your scope'), description: tr('Choose the programme or company you want to work in. Next opens the available options.'), side: 'bottom', onNextClick: openThenContinue('#guide-scope-selector') } },
            { element: guideElement('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'), waitForElement: 1200, skipMissingElement: true, popover: { title: tr('Available scope options'), description: tr('Select the programme or company that should shape the data you see.'), side: 'bottom' } },
            { element: '#guide-workspace-navigation', skipMissingElement: true, popover: { title: tr('Navigate the workspace'), description: tr('Open the section you need. Your role controls which workspace areas are available.'), side: 'right' } },
        )
    }
    steps.push({ element: '#guide-page-content', popover: { title: pageName, description: tr('This is your active workspace. The next guide option focuses on the actions available on this page.'), side: 'top', align: 'center' } })
    return steps
}

const navigationSteps = (role?: string): DriveStep[] => {
    const { label, insight } = roleDetail(role)
    return [
        { element: '#guide-workspace-navigation', waitForElement: 800, skipMissingElement: true, popover: { title: `${label} workspace`, description: insight, side: 'right' } },
        { element: guideElement('#guide-workspace-navigation .app-sidebar-menu'), waitForElement: 800, skipMissingElement: true, popover: { title: tr('Your available sections'), description: tr('This menu only shows tools that match your role and current workspace scope.'), side: 'right' } },
    ]
}

const pageActionSteps = (pageName: string): DriveStep[] => {
    const steps: DriveStep[] = [
        { element: guideElement('[data-guide-page-heading], h1, .page-header, .ant-page-header'), skipMissingElement: true, popover: { title: `Working in ${pageName}`, description: tr('Start with the page summary and any status indicators so you know what needs attention.'), side: 'bottom' } },
        { element: guideElement('[data-guide-primary], .ant-btn-primary:not([disabled])'), skipMissingElement: true, popover: { title: tr('Primary action'), description: tr('Use the main action here to add, save, submit, or progress the current workflow.'), side: 'bottom' } },
        { element: guideElement('table, .ant-table, [role="table"], .ant-list'), skipMissingElement: true, popover: { title: tr('Review the current records'), description: tr('Use the available row actions to inspect details, update a record, or follow up.'), side: 'top' } },
    ]
    if (firstVisible('[data-guide-modal-trigger]')()) {
        steps.push(
            { element: guideElement('[data-guide-modal-trigger]'), popover: { title: tr('Open the detail window'), description: tr('Next opens this dialog and waits for it before continuing the guide.'), side: 'bottom', onNextClick: openThenContinue('[data-guide-modal-trigger]') } },
            { element: guideElement('.ant-modal-wrap:not(.ant-modal-hidden) .ant-modal-content'), waitForElement: 8000, popover: { title: tr('Review the details'), description: tr('The guide only advances after the dialog is available, so its controls remain in context.'), side: 'left' } },
        )
    }
    return steps
}

const formSteps = (): DriveStep[] => [
    { element: guideElement('#guide-page-content form, #guide-page-content .ant-form'), waitForElement: 800, skipMissingElement: true, popover: { title: tr('Complete the form'), description: tr('Work from top to bottom. Required fields are marked, and related information is kept together.'), side: 'right' } },
    { element: guideElement('#guide-page-content .ant-form-item, #guide-page-content input, #guide-page-content textarea'), waitForElement: 800, skipMissingElement: true, popover: { title: tr('Add the required details'), description: tr('Use the field labels and helper text. Dropdown options stay in focus after you open one.'), side: 'right' } },
    { element: guideElement('#guide-page-content form .ant-btn-primary, #guide-page-content [data-guide-submit]'), skipMissingElement: true, popover: { title: tr('Save or submit'), description: tr('Review the values, then use the primary button to save your progress or submit the form.'), side: 'top' } },
]

export const GuideMe = ({ mode, pageName, role, hideTrigger = false, open: controlledOpen, onOpenChange }: GuideMeProps) => {
    const { t } = useLanguage()
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    const open = controlledOpen ?? uncontrolledOpen
    const setOpen = (value: boolean) => {
        setUncontrolledOpen(value)
        onOpenChange?.(value)
    }
    const pageGuide = usePageGuide()
    const hasForm = useMemo(() => Boolean(firstVisible('#guide-page-content form, #guide-page-content .ant-form')()), [open])
    const hasPageQuickTour = Boolean(pageGuide?.guides.some((guide) => guide.kind === 'page'))
    const start = (steps: DriveStep[]) => { setOpen(false); window.setTimeout(() => launchTour(steps), 180) }

    return <>
        {!hideTrigger && <Button id="guide-me-launcher" className="guide-me-launcher" icon={<CompassOutlined />} onClick={() => setOpen(true)}>{t('Guide me')}</Button>}
        <Modal open={open} footer={null} width={500} centered onCancel={() => setOpen(false)} className="guide-me-modal" title={null}>
            <div className="guide-me-options guide-me-general-options">
                <button type="button" onClick={() => start(orientedSteps(mode, pageName))}><span className="guide-me-option-icon is-violet"><PlayCircleOutlined /></span><span><strong>{t('Get oriented')}</strong></span></button>
                {!hasPageQuickTour && <button type="button" onClick={() => start(pageActionSteps(pageName))}><span className="guide-me-option-icon is-blue"><CompassOutlined /></span><span><strong>{t('Show me this page')}</strong></span></button>}
                {mode === 'workspace' && <button type="button" onClick={() => start(navigationSteps(role))}><span className="guide-me-option-icon is-green"><FormOutlined /></span><span><strong>{t('Explore my workspace')}</strong></span></button>}
            </div>
            {pageGuide?.guides?.length ? <div className="guide-me-options guide-me-page-options">
                {pageGuide?.guides
                    .slice()
                    .sort((left, right) => left.order - right.order)
                    .map((guide) => <button key={guide.id} type="button" onClick={() => start(guide.steps)}><span className={`guide-me-option-icon ${guide.kind === 'task' ? 'is-violet' : 'is-blue'}`}><PlayCircleOutlined /></span><span><strong>{guide.title}</strong>{guide.description && <small>{guide.description}</small>}</span></button>)}
            </div> : null}
            <div className="guide-me-options guide-me-page-options">
                {hasForm && <button type="button" onClick={() => start(formSteps())}><span className="guide-me-option-icon is-green"><FormOutlined /></span><span><strong>{t('Complete this form')}</strong></span></button>}
            </div>
        </Modal>
    </>
}
