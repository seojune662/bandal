import { runtime } from '../_shared/paddle-billing/runtime.ts'
const handle = runtime(key => Deno.env.get(key), 'live')
Deno.serve(request => handle(request, 'api'))
