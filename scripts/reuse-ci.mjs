#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

export function matchingRun(runs, sha) {
  return runs.filter((run) => run.head_sha === sha && ['push', 'workflow_dispatch'].includes(run.event))
    .sort((a, b) => b.run_number - a.run_number)[0]
}

async function main() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo || !process.env.GITHUB_OUTPUT) throw new Error('Run this from the release verification job')
  for (let attempt = 0; attempt < 90; attempt++) {
    // API errors fail closed; they must not be mistaken for a passed check.
    const response = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`], { encoding: 'utf8' }))
    const run = matchingRun(response.workflow_runs, sha)
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`CI ${run.html_url} finished with ${run.conclusion}`)
      console.log(`Reusing successful CI for ${sha}: ${run.html_url}`)
      appendFileSync(process.env.GITHUB_OUTPUT, 'reused=true\n')
      return
    }
    if (!run && attempt >= 5) {
      console.log('No CI run for this commit; release will perform the affected checks once.')
      appendFileSync(process.env.GITHUB_OUTPUT, 'reused=false\n')
      return
    }
    console.log(`Waiting for CI on ${sha} (${run?.status ?? 'not started'})`)
    await setTimeout(10_000)
  }
  throw new Error('CI did not finish within 15 minutes; retry after resolving its status')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
