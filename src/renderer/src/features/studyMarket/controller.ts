export const OPEN_STUDY_MARKET_SELL_EVENT = 'bandal:study-market-sell'

export interface StudyMarketSellIntent {
  courseId: string
  relPath?: string
}

let pendingIntent: StudyMarketSellIntent | null = null

export function takeStudyMarketSellIntent(): StudyMarketSellIntent | null {
  const intent = pendingIntent
  pendingIntent = null
  return intent
}
