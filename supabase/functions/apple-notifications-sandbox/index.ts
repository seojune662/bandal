import { runtime } from '../_shared/apple-billing/runtime.ts'
const handle = runtime(key => Deno.env.get(key), 'sandbox')
Deno.serve(request => handle(request, 'webhook'))
