#!/usr/bin/env node

const BASE = 'http://localhost:3000';
const MAX_WAIT = 30_000;
const POLL_INTERVAL = 1_000;

async function waitForServer() {
  const start = Date.now();
  process.stdout.write('[warm-up] Waiting for dev server...');
  while (Date.now() - start < MAX_WAIT) {
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(2_000) });
      process.stdout.write(' ready\n');
      return true;
    } catch {
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
  }
  console.log('\n[warm-up] Dev server did not start within 30s, skipping warm-up');
  return false;
}

async function fetchWithTiming(route, timeoutMs = 30_000) {
  const url = `${BASE}${route}`;
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const status = res.ok ? 'OK' : `${res.status}`;
    console.log(`  ${status} ${route} (${elapsed}s)`);
    return { route, ok: res.ok, elapsed: Date.now() - start };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const reason = err?.name === 'AbortError' ? 'timeout' : 'error';
    console.log(`  FAIL ${route} (${elapsed}s — ${reason})`);
    return { route, ok: false, elapsed: Date.now() - start };
  }
}

async function warmUp() {
  const ready = await waitForServer();
  if (!ready) return;

  const totalStart = Date.now();

  // Stage 1 — Connector health (fastest, triggers REST token acquisition)
  console.log('[warm-up] Stage 1: Connector health (REST token)...');
  await fetchWithTiming('/api/arcsight/connectors/health', 10_000);

  // Stage 2 — Core data (triggers Phoenix token, populates tree cache)
  console.log('[warm-up] Stage 2: Core data (Phoenix token + tree cache)...');
  await Promise.all([
    fetchWithTiming('/api/arcsight/channels/list', 60_000),
    fetchWithTiming('/api/arcsight/channels/tree?root=FORTRESS', 60_000),
    fetchWithTiming('/api/arcsight/connectors/health/detailed', 30_000),
  ]);

  // Stage 3 — Secondary data
  console.log('[warm-up] Stage 3: Secondary data...');
  await Promise.all([
    fetchWithTiming('/api/arcsight/reports', 30_000),
    fetchWithTiming('/api/arcsight/connectors/devices', 60_000),
  ]);

  const stage3Elapsed = Date.now() - totalStart;

  // Stage 4 (optional) — Channel scan, only if we have time budget
  if (stage3Elapsed < 60_000) {
    console.log('[warm-up] Stage 4: Channel scan (optional)...');
    await fetchWithTiming('/api/arcsight/channels/scan?fresh=true', 180_000);
  } else {
    console.log(`[warm-up] Skipping channel scan (${(stage3Elapsed / 1000).toFixed(0)}s elapsed, >60s budget)`);
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log(`[warm-up] Done in ${totalElapsed}s`);
}

warmUp();
