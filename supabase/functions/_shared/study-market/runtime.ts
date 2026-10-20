import { createClient } from '@supabase/supabase-js'
import { createStudyMarketService, type MarketConfig } from './service.ts'

export function runtime(env:(key:string)=>string|undefined) {
  const environment=env('STUDY_MARKET_ENV')==='live'?'live':'test'
  const prefix=`TOSS_${environment.toUpperCase()}_`
  const webOrigin=env('STUDY_MARKET_WEB_ORIGIN')??'https://bandal.io'
  const webUrl=new URL(webOrigin)
  if(webUrl.protocol!=='https:' || webUrl.origin!==webOrigin)throw new Error('Invalid marketplace web origin')
  const config:MarketConfig={
    supabaseUrl:env('SUPABASE_URL')??'',webOrigin,environment,enabled:env('STUDY_MARKET_ENABLED')==='true',retired:true,
    clientKey:env(`${prefix}CLIENT_KEY`)??'',secretKey:env(`${prefix}SECRET_KEY`)??'',
    payoutSecretKey:env(`${prefix}PAYOUT_SECRET_KEY`)??'',securityKey:env(`${prefix}SECURITY_KEY`)??'',cronSecret:env('STUDY_MARKET_CRON_SECRET')??''
  }
  const db=createClient(config.supabaseUrl,env('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false}})
  return createStudyMarketService(db,config)
}
