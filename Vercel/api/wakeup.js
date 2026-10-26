// api/wakeup.js
// EasyRead Wakeup — keeps Supabase awake and pokes hardcoded services.
// Triggered by GitHub Action. Auth: x-wake-key header.
//
// Vercel Hobby note: function timeout is 10s. Any target whose timeoutMs
// exceeds 8000 is auto-skipped on Vercel to avoid mid-flight kills.
//
// Supabase keep-alive: uses a WRITE (upsert), not a read. Supabase counts
// database writes as activity; reads are not reliably counted.

import { supabase } from '../utils/supabase.js';

// ============================================
// HARDCODED SERVICES TO POKE ON WAKE
// Add / remove / edit here — this is the ONLY place that changes.
// Keep timeoutMs <= 8000 for anything called from Vercel.
// ============================================
const WAKE_TARGETS = [
  // Example: ask an internal endpoint to run cleanup.
  // {
  //   name: 'cleanup',
  //   url: 'https://easytoread.vercel.app/api/articles?action=cleanup',
  //   method: 'POST',
  //   headers: { 'x-admin-key': process.env.ADMIN_API_KEY },
  //   timeoutMs: 8000,
  // },
];

// ============================================
// AUTH
// ============================================
const WAKE_KEY = process.env.EASYREAD_WAKE_KEY;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

if (!WAKE_KEY && IS_PROD) {
  console.error(
    '❌ EASYREAD_WAKE_KEY missing in production — all requests will 401'
  );
}

// Production: strict (key must be set, no fallback).
// Development: fallback to 'EASYREAD-WAKEUP' for convenience.
const EFFECTIVE_KEY = IS_PROD
  ? WAKE_KEY
  : WAKE_KEY || 'EASYREAD-WAKEUP';

// ============================================
// HANDLER
// ============================================
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // If prod key is missing, refuse all requests rather than accepting fallback.
  if (!EFFECTIVE_KEY) {
    return res
      .status(500)
      .json({ success: false, error: 'Server misconfigured: missing wake key' });
  }

  const provided = String(req.headers['x-wake-key'] || '');
  if (!provided || provided !== EFFECTIVE_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const startedAt = Date.now();

  // 1. Touch Supabase (WRITE) so the project stays active.
  const supabaseResult = await pingSupabase();

  // 2. Fire all targets in parallel, each bounded by its own timeout.
  const targetResults = await Promise.all(
    WAKE_TARGETS.map((t) => runTarget(t))
  );

  const allOk =
    supabaseResult.ok && targetResults.every((t) => t.ok || t.skipped);

  return res.status(allOk ? 200 : 207).json({
    success: allOk,
    triggered_at: new Date(startedAt).toISOString(),
    duration_ms: Date.now() - startedAt,
    supabase: supabaseResult,
    targets: targetResults,
  });
}

// ============================================
// PING SUPABASE (WRITE, NOT READ)
// An upsert to system_config counts as database activity.
// A SELECT may not reliably reset the inactivity timer.
// ============================================
async function pingSupabase() {
  const t0 = Date.now();
  try {
    const { error } = await supabase
      .from('system_config')
      .upsert(
        {
          key: 'wakeup_heartbeat',
          value: { ts: new Date().toISOString(), source: 'vercel-wakeup' },
        },
        { onConflict: 'key' }
      );

    if (error) throw error;
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message, ms: Date.now() - t0 };
  }
}

// ============================================
// CALL A TARGET
// Bounded by timeoutMs. Never throws.
// ============================================
async function runTarget(target) {
  const t0 = Date.now();
  const budget = target.timeoutMs || 8000;

  // On Vercel, skip targets whose timeout could exceed the function budget.
  if (process.env.VERCEL && budget > 8000) {
    return {
      name: target.name,
      ok: false,
      skipped: true,
      reason: 'timeoutMs > 8000 on Vercel Hobby (10s function budget)',
    };
  }

  try {
    const response = await fetch(target.url, {
      method: target.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(target.headers || {}),
      },
      signal: AbortSignal.timeout(budget),
    });

    // Parse JSON if possible, else ignore — we only care about status.
    await response.json().catch(() => ({}));

    return {
      name: target.name,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      name: target.name,
      ok: false,
      error: err.message,
      ms: Date.now() - t0,
    };
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
};