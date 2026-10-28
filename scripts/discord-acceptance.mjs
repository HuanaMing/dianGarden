import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(process.env.GARDEN_PROJECT_ROOT || process.cwd());
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const result = String(args.get('--result') || 'FAIL').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL';
const artifacts = path.resolve(args.get('--artifacts') || path.join(root, 'test-results', 'manual'));
const summary = String(args.get('--summary') || (result === 'PASS' ? '所有選定的本機驗收檢查均通過。' : '至少一項本機驗收檢查失敗，請查看錯誤摘要與截圖。')).slice(0, 1000);
// Load project-local secrets for local acceptance only; never log their values.
const localEnvPath = path.join(root, '.env.local');
try {
  const localEnv = await fs.readFile(localEnvPath, 'utf8');
  for (const line of localEnv.split(/\r?\n/)) {
    const match = line.match(/^\s*DIANGARDEN_DISCORD_WEBHOOK_URL\s*=\s*(.*?)\s*$/);
    if (match && !process.env.DIANGARDEN_DISCORD_WEBHOOK_URL) {
      process.env.DIANGARDEN_DISCORD_WEBHOOK_URL = match[1].replace(/^['\"]|['\"]$/g, '');
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const webhook = process.env.DIANGARDEN_DISCORD_WEBHOOK_URL || '';
const resultsRoot = path.join(root, 'test-results');
const outbox = path.join(resultsRoot, 'discord-outbox');
const runsRoot = path.join(resultsRoot, 'runs');
const retentionMs = 3 * 24 * 60 * 60 * 1000;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const currentJob = path.join(outbox, Date.now() + '-' + stamp);

function safeError(error) {
  return String(error && error.message || error || 'Unknown error')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted URL]')
    .replace(/[\r\n]+/g, ' ').slice(0, 500);
}
async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
async function findScreenshot(jobDir, status) {
  const names = status === 'FAIL'
    ? ['test-results/screenshots/failure-page.png', 'test-results/screenshots/garden-desktop.png', 'test-results/screenshots/garden-mobile.png']
    : ['test-results/screenshots/garden-desktop.png', 'test-results/screenshots/garden-mobile.png', 'test-results/screenshots/garden-mobile-landscape.png'];
  for (const name of names) {
    const candidate = path.join(jobDir, name);
    if (await exists(candidate)) return candidate;
  }
  return null;
}
async function cleanOldRuns() {
  await fs.mkdir(runsRoot, { recursive: true });
  for (const entry of await fs.readdir(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(runsRoot, entry.name);
    const stat = await fs.stat(full);
    if (Date.now() - stat.mtimeMs > retentionMs) await fs.rm(full, { recursive: true, force: true });
  }
  async function pruneOldFiles(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const stat = await fs.stat(full);
      if (entry.isDirectory()) {
        await pruneOldFiles(full);
        const remaining = await fs.readdir(full);
        if (remaining.length === 0) await fs.rmdir(full).catch(() => {});
      } else if (Date.now() - stat.mtimeMs > retentionMs) {
        await fs.rm(full, { force: true });
      }
    }
  }
  for (const entry of await fs.readdir(resultsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !['runs', 'discord-outbox'].includes(entry.name)) {
      await pruneOldFiles(path.join(resultsRoot, entry.name));
    }
  }
}
async function sendJob(jobDir, payload) {
  if (!webhook) throw new Error('DIANGARDEN_DISCORD_WEBHOOK_URL is not configured.');
  let endpoint;
  try { endpoint = new URL(webhook); } catch { throw new Error('The Discord webhook URL is invalid.'); }
  if (!['discord.com', 'discordapp.com'].includes(endpoint.hostname) || !endpoint.pathname.startsWith('/api/webhooks/')) {
    throw new Error('The configured webhook must be a Discord webhook URL.');
  }
  endpoint.searchParams.set('wait', 'true');
  const form = new FormData();
  const screenshot = await findScreenshot(jobDir, payload.result);
  const lines = [
    '**dianGarden 本機驗收：' + payload.result + '**',
    '時間：' + payload.timestamp,
    '耗時：' + (payload.duration || '未提供'),
    '摘要：' + payload.summary,
    screenshot ? '已附上代表性測試截圖。' : '本次沒有可用的瀏覽器截圖（可能在瀏覽器啟動前就失敗）。'
  ];
  form.set('payload_json', JSON.stringify({
    username: 'dianGarden 自動驗收',
    allowed_mentions: { parse: [] },
    content: lines.join('\n').slice(0, 1900)
  }));
  if (screenshot) {
    const bytes = await fs.readFile(screenshot);
    form.set('files[0]', new Blob([bytes], { type: 'image/png' }), path.basename(screenshot));
  }
  const response = await fetch(endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Discord responded with HTTP ' + response.status + '.');
}
async function deliverPending() {
  await fs.mkdir(outbox, { recursive: true });
  if (!webhook) return;
  const entries = (await fs.readdir(outbox, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  for (const entry of entries) {
    const jobDir = path.join(outbox, entry);
    let payload;
    try { payload = JSON.parse(await fs.readFile(path.join(jobDir, 'payload.json'), 'utf8')); } catch { continue; }
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await sendJob(jobDir, payload); lastError = null; break; }
      catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 1500);
      }
    }
    if (lastError) {
      payload.attempts = (payload.attempts || 0) + 3;
      payload.lastError = safeError(lastError);
      payload.lastAttemptAt = new Date().toISOString();
      await fs.writeFile(path.join(jobDir, 'payload.json'), JSON.stringify(payload, null, 2), 'utf8');
      console.error('[PENDING] Discord notification remains queued: ' + safeError(lastError));
      continue;
    }
    await fs.rm(jobDir, { recursive: true, force: true });
    console.log('[SENT] ' + payload.result + ' notification delivered to the configured Discord webhook.');
  }
}

await fs.mkdir(outbox, { recursive: true });
await fs.mkdir(artifacts, { recursive: true });
await cleanOldRuns();
await fs.mkdir(currentJob, { recursive: true });
const screenshot = await findScreenshot(artifacts, result);
if (screenshot) {
  const relative = path.relative(artifacts, screenshot);
  const copyPath = path.join(currentJob, relative);
  await fs.mkdir(path.dirname(copyPath), { recursive: true });
  await fs.copyFile(screenshot, copyPath);
}
let errorSummary = summary;
if (result === 'FAIL') {
  for (const filename of ['browser-test.log', 'local-browser-test.log']) {
    const file = path.join(artifacts, filename);
    if (!(await exists(file))) continue;
    const content = await fs.readFile(file, 'utf8');
    const useful = content.split(/\r?\n/).filter(line => /FAIL|ERROR|Error:|Exception|BLOCKED|timed out|Timeout/i.test(line)).slice(-8).join('\n');
    if (useful) { errorSummary = (summary + '\n' + useful).slice(0, 1000); break; }
  }
}
const payload = {
  result: result,
  timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }),
  duration: args.get('--duration') || '未提供',
  summary: errorSummary,
  attempts: 0,
  createdAt: new Date().toISOString()
};
await fs.writeFile(path.join(currentJob, 'payload.json'), JSON.stringify(payload, null, 2), 'utf8');
await deliverPending();
if (!webhook) {
  console.error('[CONFIG] Set DIANGARDEN_DISCORD_WEBHOOK_URL in the local environment. The notification is queued.');
  process.exitCode = 2;
} else {
  const remaining = (await fs.readdir(outbox, { withFileTypes: true })).some(entry => entry.isDirectory());
  if (remaining) process.exitCode = 2;
}
