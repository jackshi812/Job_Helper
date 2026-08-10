import { useEffect, useMemo, useRef, useState } from 'react'
import {
  generateEmailPossibilities,
  gmailComposeUrl,
  loadOutreachPreferences,
  normalizeCompanyDomain,
  normalizeOutreachCompanyKey,
  renderOutreachTemplate,
  saveOutreachPreferences,
  suggestCompanyDomain,
  suggestNameFromLinkedInUrl,
  type OutreachChannel,
  type OutreachPreferences,
  type OutreachTemplateVariables,
} from '../lib/outreach'
import { lookupCompanyDomain } from '../lib/outreach-domain-lookup'

const INPUT =
  'min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100'
const OUTLINE_BUTTON =
  'min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100'
const PRIMARY_BUTTON =
  'min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:focus-visible:outline-zinc-100'

type CopyTarget = 'linkedin' | 'recipient' | 'subject' | 'body'
type ActionFeedback = 'idle' | 'success' | 'error'

export interface OutreachComposerProps {
  applicationId: string
  initialCompany: string
  initialApplyUrl?: string | null
  initialPosition: string
  userId: string
}

function templateVariables(
  firstName: string,
  greetingName: string,
  company: string,
  position: string,
): OutreachTemplateVariables {
  return {
    firstName: greetingName.trim() || firstName.trim(),
    company,
    position,
  }
}

function CopyFeedback({
  feedback,
  success,
  failure,
}: {
  feedback: ActionFeedback
  success: string
  failure: string
}) {
  if (feedback === 'success') {
    return (
      <p role="status" aria-live="polite" className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
        {success}
      </p>
    )
  }
  if (feedback === 'error') {
    return (
      <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
        {failure}
      </p>
    )
  }
  return null
}

export function OutreachComposer({
  applicationId,
  initialCompany,
  initialApplyUrl = null,
  initialPosition,
  userId,
}: OutreachComposerProps) {
  const [savedPreferences, setSavedPreferences] = useState<OutreachPreferences>(
    () => loadOutreachPreferences(userId),
  )
  const [linkedInTemplate, setLinkedInTemplate] = useState(
    savedPreferences.linkedInTemplate,
  )
  const [emailSubjectTemplate, setEmailSubjectTemplate] = useState(
    savedPreferences.emailSubjectTemplate,
  )
  const [emailBodyTemplate, setEmailBodyTemplate] = useState(
    savedPreferences.emailBodyTemplate,
  )
  const [linkedInTemplateDirty, setLinkedInTemplateDirty] = useState(false)
  const [emailSubjectTemplateDirty, setEmailSubjectTemplateDirty] = useState(false)
  const [emailBodyTemplateDirty, setEmailBodyTemplateDirty] = useState(false)
  const [channel, setChannel] = useState<OutreachChannel>('linkedin')
  const [linkedInUrl, setLinkedInUrl] = useState('')
  const [nameSuggestionUnavailable, setNameSuggestionUnavailable] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [greetingName, setGreetingName] = useState('')
  const [company, setCompany] = useState(initialCompany)
  const [position, setPosition] = useState(initialPosition)
  const initialCompanyKey = normalizeOutreachCompanyKey(initialCompany)
  const initialDomainSuggestion = suggestCompanyDomain(initialCompany, initialApplyUrl)
  const initialRememberedDomain = savedPreferences.companyDomains[initialCompanyKey]
  const [domain, setDomain] = useState(
    initialRememberedDomain ?? initialDomainSuggestion?.domain ?? '',
  )
  const [domainSource, setDomainSource] = useState<
    'apply_url' | 'company_name' | 'lookup' | 'manual' | 'remembered' | 'none'
  >(initialRememberedDomain
    ? 'remembered'
    : initialDomainSuggestion?.source ?? 'none')
  const [domainLookupPending, setDomainLookupPending] = useState(false)
  const domainLookupRevision = useRef(0)
  const domainLookupAbort = useRef<AbortController | null>(null)
  const domainUserEdited = useRef(false)
  const initialVariables = templateVariables('', '', initialCompany, initialPosition)
  const [linkedInMessage, setLinkedInMessage] = useState(
    renderOutreachTemplate(savedPreferences.linkedInTemplate, initialVariables),
  )
  const [emailSubject, setEmailSubject] = useState(
    renderOutreachTemplate(savedPreferences.emailSubjectTemplate, initialVariables),
  )
  const [emailBody, setEmailBody] = useState(
    renderOutreachTemplate(savedPreferences.emailBodyTemplate, initialVariables),
  )
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<Record<CopyTarget, ActionFeedback>>({
    linkedin: 'idle',
    recipient: 'idle',
    subject: 'idle',
    body: 'idle',
  })
  const copyRevision = useRef<Record<CopyTarget, number>>({
    linkedin: 0,
    recipient: 0,
    subject: 0,
    body: 0,
  })
  const [templateFeedback, setTemplateFeedback] = useState<ActionFeedback>('idle')
  const [domainFeedback, setDomainFeedback] = useState<ActionFeedback>('idle')
  const [gmailHandoffRequested, setGmailHandoffRequested] = useState(false)

  useEffect(() => {
    const companyKey = normalizeOutreachCompanyKey(company)
    const latestPreferences = loadOutreachPreferences(userId)
    const remembered = latestPreferences.companyDomains[companyKey] ?? ''
    const applyUrl = companyKey === initialCompanyKey ? initialApplyUrl : null
    const suggestion = suggestCompanyDomain(company, applyUrl)
    const revision = domainLookupRevision.current + 1
    domainLookupRevision.current = revision
    domainLookupAbort.current?.abort()
    domainUserEdited.current = false
    setSavedPreferences(latestPreferences)
    setDomain(remembered || suggestion?.domain || '')
    setDomainSource(remembered ? 'remembered' : suggestion?.source ?? 'none')
    setDomainFeedback('idle')
    setSelectedRecipient(null)
    setCopyFeedback((current) => ({ ...current, recipient: 'idle' }))
    setGmailHandoffRequested(false)

    if (
      !companyKey
      || remembered
      || suggestion?.source === 'apply_url'
    ) {
      setDomainLookupPending(false)
      return undefined
    }

    const controller = new AbortController()
    domainLookupAbort.current = controller
    setDomainLookupPending(true)
    const timeoutId = window.setTimeout(() => controller.abort(), 1_500)
    void lookupCompanyDomain(company, { signal: controller.signal })
      .then((resolvedDomain) => {
        if (
          !resolvedDomain
          || controller.signal.aborted
          || revision !== domainLookupRevision.current
          || domainUserEdited.current
        ) return
        setDomain(resolvedDomain)
        setDomainSource('lookup')
        setSelectedRecipient(null)
        setCopyFeedback((current) => ({ ...current, recipient: 'idle' }))
        setGmailHandoffRequested(false)
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
        if (revision === domainLookupRevision.current) setDomainLookupPending(false)
      })
    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [company, initialApplyUrl, initialCompanyKey, userId])

  const emailPossibilities = useMemo(() => generateEmailPossibilities({
    firstName,
    lastName,
    domain,
  }), [domain, firstName, lastName])
  useEffect(() => {
    if (selectedRecipient && !emailPossibilities.includes(selectedRecipient)) {
      copyRevision.current.recipient += 1
      setSelectedRecipient(null)
      setCopyFeedback((current) => ({ ...current, recipient: 'idle' }))
      setGmailHandoffRequested(false)
    }
  }, [emailPossibilities, selectedRecipient])
  const activeRecipient = selectedRecipient
    && emailPossibilities.includes(selectedRecipient)
    ? selectedRecipient
    : null
  const gmailHref = activeRecipient
    ? gmailComposeUrl({
      recipient: activeRecipient,
      subject: emailSubject,
      body: emailBody,
    })
    : null

  function invalidateCopy(target: CopyTarget) {
    copyRevision.current[target] += 1
    setCopyFeedback((current) => ({ ...current, [target]: 'idle' }))
  }

  function updateSelectedRecipient(value: string | null) {
    invalidateCopy('recipient')
    setSelectedRecipient(value)
    setGmailHandoffRequested(false)
    if (value) {
      domainUserEdited.current = true
      domainLookupRevision.current += 1
      domainLookupAbort.current?.abort()
      setDomainLookupPending(false)
      const companyKey = normalizeOutreachCompanyKey(company)
      const normalizedDomain = normalizeCompanyDomain(domain)
      if (companyKey && normalizedDomain) {
        const latestPreferences = loadOutreachPreferences(userId)
        const next = {
          ...latestPreferences,
          companyDomains: {
            ...latestPreferences.companyDomains,
            [companyKey]: normalizedDomain,
          },
        }
        if (saveOutreachPreferences(userId, next)) setSavedPreferences(next)
      }
    }
  }

  function updateLinkedInMessage(value: string) {
    invalidateCopy('linkedin')
    setLinkedInMessage(value)
  }

  function updateEmailSubject(value: string) {
    invalidateCopy('subject')
    setEmailSubject(value)
    setGmailHandoffRequested(false)
  }

  function updateEmailBody(value: string) {
    invalidateCopy('body')
    setEmailBody(value)
    setGmailHandoffRequested(false)
  }

  function renderAll(next: {
    firstName?: string
    greetingName?: string
    company?: string
    position?: string
  }) {
    const variables = templateVariables(
      next.firstName ?? firstName,
      next.greetingName ?? greetingName,
      next.company ?? company,
      next.position ?? position,
    )
    updateLinkedInMessage(renderOutreachTemplate(linkedInTemplate, variables))
    updateEmailSubject(renderOutreachTemplate(emailSubjectTemplate, variables))
    updateEmailBody(renderOutreachTemplate(emailBodyTemplate, variables))
  }

  function updateLinkedInUrl(value: string) {
    setLinkedInUrl(value)
    const suggestion = suggestNameFromLinkedInUrl(value)
    setNameSuggestionUnavailable(Boolean(value.trim()) && !suggestion)
    if (!suggestion) return
    const nextFirstName = firstName.trim() ? firstName : suggestion.firstName
    const nextLastName = lastName.trim() ? lastName : suggestion.lastName
    const nextGreetingName = greetingName.trim() ? greetingName : suggestion.firstName
    if (!firstName.trim()) setFirstName(nextFirstName)
    if (!lastName.trim()) setLastName(nextLastName)
    if (!greetingName.trim()) setGreetingName(nextGreetingName)
    updateSelectedRecipient(null)
    renderAll({ firstName: nextFirstName, greetingName: nextGreetingName })
  }

  function updateCompany(value: string) {
    domainLookupRevision.current += 1
    domainLookupAbort.current?.abort()
    domainUserEdited.current = false
    setCompany(value)
    setDomainFeedback('idle')
    updateSelectedRecipient(null)
    renderAll({ company: value })
  }

  function rememberDomain() {
    const companyKey = normalizeOutreachCompanyKey(company)
    const normalizedDomain = normalizeCompanyDomain(domain)
    if (!companyKey || !normalizedDomain) {
      setDomainFeedback('error')
      return
    }
    setDomain(normalizedDomain)
    setDomainSource('manual')
    const latestPreferences = loadOutreachPreferences(userId)
    const next = {
      ...latestPreferences,
      companyDomains: {
        ...latestPreferences.companyDomains,
        [companyKey]: normalizedDomain,
      },
    }
    const saved = saveOutreachPreferences(userId, next)
    if (saved) setSavedPreferences(next)
    setDomainFeedback(saved ? 'success' : 'error')
  }

  function saveTemplates() {
    const latestPreferences = loadOutreachPreferences(userId)
    const next: OutreachPreferences = {
      ...latestPreferences,
      linkedInTemplate: linkedInTemplateDirty
        ? linkedInTemplate
        : latestPreferences.linkedInTemplate,
      emailSubjectTemplate: emailSubjectTemplateDirty
        ? emailSubjectTemplate
        : latestPreferences.emailSubjectTemplate,
      emailBodyTemplate: emailBodyTemplateDirty
        ? emailBodyTemplate
        : latestPreferences.emailBodyTemplate,
    }
    const saved = saveOutreachPreferences(userId, next)
    if (saved) {
      setSavedPreferences(next)
      setLinkedInTemplate(next.linkedInTemplate)
      setEmailSubjectTemplate(next.emailSubjectTemplate)
      setEmailBodyTemplate(next.emailBodyTemplate)
      setLinkedInTemplateDirty(false)
      setEmailSubjectTemplateDirty(false)
      setEmailBodyTemplateDirty(false)
    }
    setTemplateFeedback(saved ? 'success' : 'error')
  }

  async function copy(target: CopyTarget, value: string) {
    const revision = copyRevision.current[target] + 1
    copyRevision.current[target] = revision
    setCopyFeedback((current) => ({ ...current, [target]: 'idle' }))
    try {
      await navigator.clipboard.writeText(value)
      if (copyRevision.current[target] !== revision) return
      setCopyFeedback((current) => ({ ...current, [target]: 'success' }))
    } catch {
      if (copyRevision.current[target] !== revision) return
      setCopyFeedback((current) => ({ ...current, [target]: 'error' }))
    }
  }

  return (
    <section
      aria-label={`Outreach draft for ${initialPosition}`}
      data-application-id={applicationId}
      className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold">Manual outreach draft</h4>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Draft locally, then copy the text or request a Gmail web handoff. Nothing is sent automatically.
          </p>
        </div>
        <div role="group" aria-label="Outreach channel" className="flex rounded-md border border-zinc-300 p-1 dark:border-zinc-700">
          {(['linkedin', 'email'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={channel === option}
              onClick={() => setChannel(option)}
              className={`min-h-11 rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100 ${
                channel === option
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : ''
              }`}
            >
              {option === 'linkedin' ? 'LinkedIn' : 'Email'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-8 min-[900px]:grid-cols-2">
        <div className="grid content-start gap-4">
          <label className="grid gap-1 text-xs font-medium">
            LinkedIn profile URL
            <input
              type="url"
              value={linkedInUrl}
              onChange={(event) => updateLinkedInUrl(event.target.value)}
              className={INPUT}
            />
            {nameSuggestionUnavailable ? (
              <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                Couldn’t read a name from this URL. Company and position are already filled from Tracker.
              </span>
            ) : null}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium">
              First name
              <input
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value)
                  updateSelectedRecipient(null)
                  renderAll({ firstName: event.target.value })
                }}
                className={INPUT}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Last name
              <input
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value)
                  updateSelectedRecipient(null)
                }}
                className={INPUT}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Greeting name
              <input
                value={greetingName}
                onChange={(event) => {
                  setGreetingName(event.target.value)
                  renderAll({ greetingName: event.target.value })
                }}
                className={INPUT}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Company
              <input
                value={company}
                onChange={(event) => updateCompany(event.target.value)}
                className={INPUT}
              />
            </label>
          </div>
          <label className="grid gap-1 text-xs font-medium">
            Position
            <input
              value={position}
              onChange={(event) => {
                setPosition(event.target.value)
                renderAll({ position: event.target.value })
              }}
              className={INPUT}
            />
            <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
              Company and position are filled from this Tracker job. Edit only if needed.
            </span>
          </label>

          {channel === 'linkedin' ? (
            <label className="grid gap-1 text-xs font-medium">
              Reusable LinkedIn template
              <textarea
                rows={7}
                value={linkedInTemplate}
                onChange={(event) => {
                  setTemplateFeedback('idle')
                  setLinkedInTemplate(event.target.value)
                  setLinkedInTemplateDirty(true)
                  updateLinkedInMessage(renderOutreachTemplate(
                    event.target.value,
                    templateVariables(firstName, greetingName, company, position),
                  ))
                }}
                className={`${INPUT} resize-y whitespace-pre-wrap`}
              />
            </label>
          ) : (
            <>
              <label className="grid gap-1 text-xs font-medium">
                Company domain
                <input
                  value={domain}
                  onChange={(event) => {
                    domainUserEdited.current = true
                    domainLookupRevision.current += 1
                    domainLookupAbort.current?.abort()
                    setDomainFeedback('idle')
                    setDomain(event.target.value)
                    setDomainSource('manual')
                    setDomainLookupPending(false)
                    updateSelectedRecipient(null)
                  }}
                  onBlur={rememberDomain}
                  placeholder="example.com"
                  className={INPUT}
                />
                <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                  {domainLookupPending
                    ? 'Filled automatically; checking the official company site. You can edit it now.'
                    : domainSource === 'manual'
                      ? 'Your correction will be remembered for this company.'
                      : 'Filled automatically from the job and company. Edit only if needed.'}
                </span>
                <CopyFeedback
                  feedback={domainFeedback}
                  success="Company domain saved."
                  failure="Couldn’t save the company domain. Drafting remains available."
                />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Reusable email subject template
                <textarea
                  rows={3}
                  value={emailSubjectTemplate}
                  onChange={(event) => {
                    setTemplateFeedback('idle')
                    setEmailSubjectTemplate(event.target.value)
                    setEmailSubjectTemplateDirty(true)
                    updateEmailSubject(renderOutreachTemplate(
                      event.target.value,
                      templateVariables(firstName, greetingName, company, position),
                    ))
                  }}
                  className={`${INPUT} resize-y whitespace-pre-wrap`}
                />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Reusable email body template
                <textarea
                  rows={7}
                  value={emailBodyTemplate}
                  onChange={(event) => {
                    setTemplateFeedback('idle')
                    setEmailBodyTemplate(event.target.value)
                    setEmailBodyTemplateDirty(true)
                    updateEmailBody(renderOutreachTemplate(
                      event.target.value,
                      templateVariables(firstName, greetingName, company, position),
                    ))
                  }}
                  className={`${INPUT} resize-y whitespace-pre-wrap`}
                />
              </label>
            </>
          )}

          <div>
            <button type="button" onClick={saveTemplates} className={OUTLINE_BUTTON}>
              Save templates
            </button>
            <CopyFeedback
              feedback={templateFeedback}
              success="Outreach templates saved."
              failure="Couldn’t save outreach templates. Drafting remains available."
            />
          </div>
        </div>

        <div className="grid content-start gap-5">
          {channel === 'linkedin' ? (
            <section>
              <h5 className="text-sm font-semibold">LinkedIn message</h5>
              <label className="sr-only" htmlFor={`linkedin-message-${applicationId}`}>
                LinkedIn message
              </label>
              <textarea
                id={`linkedin-message-${applicationId}`}
                rows={12}
                value={linkedInMessage}
                onChange={(event) => updateLinkedInMessage(event.target.value)}
                className={`mt-3 ${INPUT} resize-y whitespace-pre-wrap`}
              />
              <button
                type="button"
                onClick={() => void copy('linkedin', linkedInMessage)}
                className={`mt-3 ${PRIMARY_BUTTON}`}
              >
                Copy LinkedIn message
              </button>
              <CopyFeedback
                feedback={copyFeedback.linkedin}
                success="LinkedIn message copied."
                failure="Couldn’t copy the LinkedIn message. Select the text and copy it manually."
              />
            </section>
          ) : (
            <>
              <fieldset>
                <legend className="text-sm font-semibold">Email possibilities</legend>
                {emailPossibilities.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {emailPossibilities.map((email) => (
                      <label key={email} className="flex min-h-11 items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                        <input
                          type="radio"
                          name={`outreach-recipient-${applicationId}`}
                          value={email}
                          checked={activeRecipient === email}
                          onChange={() => updateSelectedRecipient(email)}
                        />
                        <span className="break-all">{email}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                    Enter a first name and company domain to see possibilities.
                  </p>
                )}
              </fieldset>

              <section>
                <h5 className="text-sm font-semibold">Selected recipient</h5>
                <p className="mt-2 min-h-11 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm break-all dark:border-zinc-700 dark:bg-zinc-900">
                  {activeRecipient ?? 'Choose an email possibility.'}
                </p>
                <button
                  type="button"
                  disabled={!activeRecipient}
                  onClick={() => activeRecipient && void copy('recipient', activeRecipient)}
                  className={`mt-3 ${OUTLINE_BUTTON}`}
                >
                  Copy recipient
                </button>
                <CopyFeedback
                  feedback={copyFeedback.recipient}
                  success="Recipient copied."
                  failure="Couldn’t copy the recipient. Select it and copy it manually."
                />
              </section>

              <section>
                <label className="grid gap-1 text-sm font-semibold">
                  Email subject
                  <textarea
                    rows={3}
                    value={emailSubject}
                    onChange={(event) => updateEmailSubject(event.target.value)}
                    className={`${INPUT} resize-y whitespace-pre-wrap font-normal`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void copy('subject', emailSubject)}
                  className={`mt-3 ${OUTLINE_BUTTON}`}
                >
                  Copy subject
                </button>
                <CopyFeedback
                  feedback={copyFeedback.subject}
                  success="Subject copied."
                  failure="Couldn’t copy the subject. Select it and copy it manually."
                />
              </section>

              <section>
                <label className="grid gap-1 text-sm font-semibold">
                  Email body
                  <textarea
                    rows={12}
                    value={emailBody}
                    onChange={(event) => updateEmailBody(event.target.value)}
                    className={`${INPUT} resize-y whitespace-pre-wrap font-normal`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void copy('body', emailBody)}
                  className={`mt-3 ${OUTLINE_BUTTON}`}
                >
                  Copy email body
                </button>
                <CopyFeedback
                  feedback={copyFeedback.body}
                  success="Email body copied."
                  failure="Couldn’t copy the email body. Select it and copy it manually."
                />
              </section>

              {gmailHref ? (
                <a
                  href={gmailHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setGmailHandoffRequested(true)}
                  className={PRIMARY_BUTTON}
                >
                  Open in Gmail
                </a>
              ) : (
                <button type="button" disabled className={PRIMARY_BUTTON}>
                  Open in Gmail
                </button>
              )}
              {gmailHandoffRequested ? (
                <p role="status" aria-live="polite" className="text-xs text-emerald-700 dark:text-emerald-400">
                  Gmail handoff requested.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
