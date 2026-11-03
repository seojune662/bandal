import { useEffect, useState } from 'react'
import type { MarketplaceRelease } from '../../../../../shared/types/marketplace'
import { describePermission } from '../../../../../shared/plugins/permissions'
import { Button } from '../../../components/ui/button'
import { Textarea } from '../../../components/ui/input'
import { useLocale, useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'

export function MarketplaceReleaseDetails({ id }: { id: string }): JSX.Element {
  const locale = useLocale()
  const t = useT()
  const [release, setRelease] = useState<MarketplaceRelease | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reported, setReported] = useState(false)
  useEffect(() => {
    let active = true
    setError(null)
    setRelease(null)
    void invoke('marketplace:release', { id })
      .then((result) => {
        if (active) setRelease(result)
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      active = false
    }
  }, [id, attempt])
  return (
    <div className="marketplace-release-details">
      {error && (
        <p role="alert">
          {error}{' '}
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('settings.catalog.release.retry')}
          </Button>
        </p>
      )}
      {!release && !error && (
        <p role="status">
          {t('settings.catalog.release.loading')}
        </p>
      )}
      {release && (
        <>
          {release.status === 'withdrawn' && (
            <p role="alert">
              {t('settings.catalog.release.withdrawn')}{' '}
              {release.review_reason}
            </p>
          )}
          <h4>
            {t('settings.catalog.release.notes')} · {release.version}
          </h4>
          <pre className="marketplace-release-notes">
            {release.changelog ||
              t('settings.catalog.release.noNotes')}
          </pre>
          <h4>{t('settings.catalog.release.permissions')}</h4>
          <ul>
            {release.manifest.permissions.map((permission) => (
              <li key={permission}>{describePermission(permission, locale)}</li>
            ))}
          </ul>
          <p>
            {t('settings.catalog.release.trust')}
          </p>
          {reported ? (
            <p role="status">
              {t('settings.catalog.release.reported')}
            </p>
          ) : (
            release.status === 'approved' && (
              <details>
                <summary>{t('settings.catalog.release.report')}</summary>
                <form
                  className="marketplace-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (busy) return
                    const reason = String(
                      new FormData(event.currentTarget).get('reason') ?? '',
                    ).trim()
                    if (!reason) return
                    setBusy(true)
                    setError(null)
                    void invoke('marketplace:report', { releaseId: id, reason })
                      .then(() => setReported(true))
                      .catch((failure: unknown) =>
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : String(failure),
                        ),
                      )
                      .finally(() => setBusy(false))
                  }}
                >
                  <label>
                    {t('settings.catalog.release.reason')}
                    <Textarea
                      name="reason"
                      required
                      maxLength={2000}
                      disabled={busy}
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    className="w-fit"
                    disabled={busy}
                  >
                    {t('settings.catalog.release.submitReport')}
                  </Button>
                </form>
              </details>
            )
          )}
        </>
      )}
    </div>
  )
}
