import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import { pruneTranscript } from './compact'
import type { Outcome, Settings } from './compact'
import { jevAsker } from './jev'
import type { Provider } from './jev'
import { charsOf } from './prune'

type Mode = 'shadow' | 'active'

// A cut that saves less than this is not worth replacing the native summary.
const MIN_REDUCTION = 0.1

const SECURITY_TOOL = '/usr/bin/security'

let mode: Mode = 'shadow'
let provider: Provider = 'openrouter'
let hasWarnedMissingKey = false
let settings: Settings = {
  keepThreshold: 0.5,
  aggressiveThreshold: 0.75,
  preserveRecentMessages: 6,
  targetTokens: 150_000,
  sufficientReduction: 0.4,
  previewChars: 300,
  keepHeadChars: 300,
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

function summaryOf(outcome: Outcome): string {
  const saved = outcome.tokensBefore === 0 ? 0 : 1 - outcome.tokensAfter / outcome.tokensBefore
  const cut = outcome.decisions.filter(i => i.reason === 'cut' || i.reason === 'superseded').length
  const jev = outcome.jevRequests > 0 ? ` · Jev $${outcome.jevCostUsd.toFixed(4)}` : ''

  return `${formatTokens(outcome.tokensBefore)} → ${formatTokens(outcome.tokensAfter)} (−${Math.round(saved * 100)}%) · ${cut} results cut · ${outcome.stage}${jev}`
}

// The key comes from the environment, not a plugin option: a sensitive option
// has no row in /config, and settings.json is versioned by the config snapshots.
// The desktop app starts sessions without the shell profile that exports it, so
// on macOS the Keychain item the profile reads from is asked directly as well.
async function apiKeyOf($: EngineInterface): Promise<string | null> {
  const key = provider === 'openrouter' ? await $.env.get('OPENROUTER_API_KEY') : await $.env.get('TYPESAFE_API_KEY')
  if (key !== undefined && key.length > 0) {
    return key
  }

  return keychainKeyOf($)
}

async function keychainKeyOf($: EngineInterface): Promise<string | null> {
  if (!(await $.fs.exists(SECURITY_TOOL))) {
    return null
  }
  try {
    const result = await $.process.run([SECURITY_TOOL, 'find-generic-password', '-s', `${provider}-api-key`, '-w'], {
      timeoutMs: 5_000,
    })
    const key = result.stdout.trim()

    return result.exitCode === 0 && key.length > 0 ? key : null
  } catch {
    return null
  }
}

// The transcript leaves the machine when Jev is asked; a project can opt out.
async function isEnabledHere($: EngineInterface): Promise<boolean> {
  const path = `${await $.session.cwd()}/.claude/jev-compact.json`
  if (!(await $.fs.exists(path))) {
    return true
  }
  try {
    const config = JSON.parse(await $.fs.read(path)) as { enabled?: unknown }

    return config.enabled !== false
  } catch {
    return true
  }
}

async function run($: EngineInterface, messages: readonly SessionMessage[], allowJev: boolean): Promise<Outcome> {
  const usage = await $.session.usage()
  const tokensBefore = usage.context.tokens ?? Math.round(charsOf(messages) / 3.5)
  const key = allowJev ? await apiKeyOf($) : null
  if (allowJev && key === null && !hasWarnedMissingKey) {
    hasWarnedMissingKey = true
    const variable = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY'
    $.ui.toast(`jev-compact: ${variable} is not set, using local rules only`, { timeoutMs: 10_000 })
  }
  const ask = key === null ? null : jevAsker((url, init) => $.http.fetch(url, init), provider, key)

  return pruneTranscript(messages, tokensBefore, settings, ask)
}

async function writeReport($: EngineInterface, kind: string, outcome: Outcome): Promise<string | null> {
  const home = await $.env.get('HOME')
  if (home === undefined) {
    return null
  }
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  const path = `${home}/.claude/jev-compact/runs/${stamp}-${kind}.json`
  const { messages: _messages, ...report } = outcome
  await $.fs.write(path, JSON.stringify({ kind, mode, provider, settings, ...report }, null, 2))

  return path
}

function verdictOf(outcome: Outcome): string {
  if (outcome.isOnTarget) {
    return 'reached'
  }
  if (outcome.isSufficient) {
    return `missed, but the cut saves at least ${Math.round(settings.sufficientReduction * 100)}% and would replace the native summary`
  }

  return 'missed, the native summary would run over the cut transcript'
}

function previewText(outcome: Outcome, reportPath: string | null): string {
  const largestCuts = outcome.decisions
    .filter(i => i.reason === 'cut' || i.reason === 'superseded')
    .sort((a, b) => b.resultChars - a.resultChars)
    .slice(0, 8)
    .map(i => `- ${i.tool} ${i.input.slice(0, 80)} (${i.resultChars} chars, ${i.reason}${i.probability === null ? '' : `, keep ${i.probability.toFixed(2)}`})`)
  const lines = [`jev-compact preview: ${summaryOf(outcome)}`, `Target ${formatTokens(settings.targetTokens)}: ${verdictOf(outcome)}`]
  if (outcome.jevError !== null) {
    lines.push(`Jev failed: ${outcome.jevError}`)
  }
  if (largestCuts.length > 0) {
    lines.push('Largest cuts:', ...largestCuts)
  }
  if (reportPath !== null) {
    lines.push(`Full report: ${reportPath}`)
  }

  return lines.join('\n')
}

export const register: Register = (on, options) => {
  mode = options.mode === 'active' ? 'active' : 'shadow'
  provider = options.provider === 'typesafe' ? 'typesafe' : 'openrouter'
  settings = {
    keepThreshold: Number(options.keepThreshold ?? 0.5),
    aggressiveThreshold: Number(options.aggressiveThreshold ?? 0.75),
    preserveRecentMessages: Number(options.preserveRecentMessages ?? 6),
    targetTokens: Number(options.targetTokens ?? 150_000),
    sufficientReduction: Number(options.sufficientReduction ?? 0.4),
    previewChars: Number(options.previewChars ?? 300),
    keepHeadChars: Number(options.keepHeadChars ?? 300),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jev-preview',
      description: 'Show what jev-compact would cut from this conversation, without changing it',
    })

    return next(e)
  })

  on('command.run', { command: 'jev-preview' }, async $ => {
    const enabled = await isEnabledHere($)
    const messages = await $.session.messages()
    const outcome = await run($, messages, enabled)
    const reportPath = await writeReport($, 'preview', outcome)
    const note = enabled ? '' : '\nJev is disabled for this project; local rules only.'

    return { text: previewText(outcome, reportPath) + note }
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') {
      return next(e)
    }
    let outcome: Outcome
    try {
      outcome = await run($, e.messages, await isEnabledHere($))
    } catch (error) {
      $.ui.toast(`jev-compact failed, native compaction runs: ${error instanceof Error ? error.message : String(error)}`)

      return next(e)
    }
    await writeReport($, e.trigger, outcome)
    if (outcome.jevError !== null) {
      $.ui.toast(`jev-compact: Jev failed (${outcome.jevError}), local rules only`, { timeoutMs: 10_000 })
    }

    if (mode === 'shadow') {
      $.ui.toast(`jev-compact (shadow) would cut ${summaryOf(outcome)}; native compaction runs`, { timeoutMs: 15_000 })

      return next(e)
    }

    const reduction = outcome.tokensBefore === 0 ? 0 : 1 - outcome.tokensAfter / outcome.tokensBefore
    if (outcome.isSufficient && reduction >= MIN_REDUCTION) {
      $.ui.toast(`jev-compact: ${summaryOf(outcome)}`, { timeoutMs: 15_000 })

      return { messages: outcome.messages, tokensBefore: outcome.tokensBefore, tokensAfter: outcome.tokensAfter }
    }

    // The native summary still runs, but over the cut transcript: far fewer
    // tokens to read than the original.
    $.ui.toast(`jev-compact: ${summaryOf(outcome)}; not enough, summarizing the cut transcript`, { timeoutMs: 15_000 })

    return next({ ...e, messages: outcome.messages })
  })
}
