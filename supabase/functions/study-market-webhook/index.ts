import { runtime } from '../_shared/study-market/runtime.ts'
const handle=runtime(key=>Deno.env.get(key))
Deno.serve(request=>handle(request,'webhook'))
