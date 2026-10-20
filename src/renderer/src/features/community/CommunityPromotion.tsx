import { useEffect, useState } from 'react'
import type { CommunityCampaign } from '../../../../shared/types/community'
import { openCommunity } from '../../app/communityNavigation'
import { useAuthStore } from '../../stores/authStore'
import { communityRequest } from './api'
import { CampaignDetails, campaignAcceptsEntries } from './CampaignNotice'
import './community.css'

const dismissed = new Set<string>()
const noticeKey = (id: string): string => `bandal:community:campaign-dismissed:${id}`
function isDismissed(id: string): boolean {
  if (dismissed.has(id)) return true
  try { return localStorage.getItem(noticeKey(id)) === '1' } catch { return false }
}

export function CommunityPromotion(): JSX.Element | null {
  const auth = useAuthStore(state => state.auth)
  const [campaign, setCampaign] = useState<CommunityCampaign | null>(null)
  useEffect(() => {
    if (auth.phase !== 'signed-in') { setCampaign(null); return }
    let active = true
    let sequence = 0
    const load = (): void => {
      const current = ++sequence
      void communityRequest('context', {}).then(context => {
        if (!active || sequence !== current) return
        const candidate = context.configured && context.signedIn ? context.campaign : null
        setCampaign(candidate && campaignAcceptsEntries(candidate) && !isDismissed(candidate.id) ? candidate : null)
      }).catch(() => { /* Community itself offers connection errors and retry. */ })
    }
    load()
    const interval = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', load) }
  }, [auth.phase, auth.profile?.id])
  if (!campaign) return null
  const close = (): void => {
    dismissed.add(campaign.id)
    try { localStorage.setItem(noticeKey(campaign.id), '1') } catch { /* Keep the in-session dismissal. */ }
    setCampaign(null)
  }
  return <CampaignDetails campaign={campaign} onClose={close} onCompose={() => { close(); openCommunity({ compose: true, campaignId: campaign.id }) }} />
}
