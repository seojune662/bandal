import { createClient } from '@supabase/supabase-js'
import { createAccountDeletionService } from '../_shared/account-delete/service.ts'
import { createAppleAuthorizationProvider } from '../_shared/account-delete/apple.ts'
const config = { teamId: Deno.env.get('APPLE_AUTH_TEAM_ID') ?? '', keyId: Deno.env.get('APPLE_AUTH_KEY_ID') ?? '', privateKey: Deno.env.get('APPLE_AUTH_PRIVATE_KEY') ?? '', encryptionKey: Deno.env.get('APPLE_AUTH_TOKEN_ENCRYPTION_KEY') ?? '' }
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
Deno.serve(createAccountDeletionService(db, createAppleAuthorizationProvider(config), config.encryptionKey))
