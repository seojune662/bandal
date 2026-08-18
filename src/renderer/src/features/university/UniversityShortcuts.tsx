/**
 * [M8] 학교 바로가기 — the compact section at the top of the left rail.
 *
 * Primary services are always visible; `secondary: true` entries (legacy
 * systems, 증명발급, 식단) hide behind 더보기 so the rail never grows past a
 * glance. Clicking opens a Bandal browser tab, except for the shortcuts the
 * embedded browser structurally cannot run — those go to the system browser
 * and say so in their tooltip.
 */

import { useMemo, useState } from 'react'
import type { ResolvedService } from '../../../../shared/universities'
import { Icon } from '../../app/icons'
import { useUiStore } from '../../stores/uiStore'
import { useUniversityStore } from '../../stores/universityStore'
import { openShortcut } from './openService'
import { externalReasonMessage } from './serviceCopy'
import {
  persistUniversitySectionCollapsed,
  persistUniversitySectionShowAll,
  readUniversitySectionCollapsed,
  readUniversitySectionShowAll
} from './universityCollapse'
import { ExternalIcon, ServiceKindIcon } from './universityIcons'
import './university.css'

function ShortcutRow({ service }: { service: ResolvedService }): JSX.Element {
  const title = service.opensExternally
    ? `${service.label} — ${externalReasonMessage(service.externalReason)}`
    : (service.note ?? service.label)

  return (
    <li>
      <button
        type="button"
        className="university-shortcut"
        data-external={service.opensExternally || undefined}
        title={title}
        onClick={() =>
          openShortcut({
            url: service.url,
            opensExternally: service.opensExternally
          })
        }
      >
        <ServiceKindIcon kind={service.kind} className="university-shortcut__icon" />
        <span className="university-shortcut__label">{service.label}</span>
        {service.opensExternally && (
          <ExternalIcon className="university-shortcut__external" />
        )}
      </button>
    </li>
  )
}

export function UniversityShortcuts(): JSX.Element | null {
  const loaded = useUniversityStore((state) => state.loaded)
  const university = useUniversityStore((state) => state.university)
  const services = useUniversityStore((state) => state.services)
  const openSettings = useUiStore((state) => state.openSettings)
  const [collapsed, setCollapsed] = useState(readUniversitySectionCollapsed)
  const [showAll, setShowAll] = useState(readUniversitySectionShowAll)

  const { primary, secondary } = useMemo(() => {
    return {
      primary: services.filter((service) => service.secondary !== true),
      secondary: services.filter((service) => service.secondary === true)
    }
  }, [services])

  if (!loaded) return null

  if (university === null) {
    return (
      <section className="university-section" aria-label="학교 바로가기">
        <button
          type="button"
          className="university-section__pick"
          onClick={openSettings}
        >
          학교 고르기
        </button>
      </section>
    )
  }

  const visible = showAll ? [...primary, ...secondary] : primary

  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      const next = !current
      persistUniversitySectionCollapsed(next)
      return next
    })
  }

  const toggleShowAll = (): void => {
    setShowAll((current) => {
      const next = !current
      persistUniversitySectionShowAll(next)
      return next
    })
  }

  return (
    <section className="university-section" aria-label="학교 바로가기">
      <button
        type="button"
        className="university-section__heading"
        aria-label={`CAMPUS ${university.nameKo} ${collapsed ? '펼치기' : '접기'}`}
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        <Icon name="chevronRight" className="university-section__chevron" />
        <span className="university-section__heading-copy">
          <span className="eyebrow">CAMPUS</span>
          <span className="university-section__name">{university.nameKo}</span>
        </span>
      </button>

      {!collapsed && (
        <>
          {visible.length === 0 ? (
            <ServiceKindIcon
              kind="homepage"
              className="university-section__empty-icon"
            />
          ) : (
            <ul className="university-shortcuts">
              {visible.map((service) => (
                <ShortcutRow key={service.id} service={service} />
              ))}
            </ul>
          )}

          {secondary.length > 0 && (
            <button
              type="button"
              className="university-section__more"
              aria-expanded={showAll}
              onClick={toggleShowAll}
            >
              {showAll ? '접기' : `더보기 ${secondary.length}`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
