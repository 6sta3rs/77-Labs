import { mkdir as ensureQaDirectory } from 'node:fs/promises';
await ensureQaDirectory(new URL('../../.tmp/qa/', import.meta.url), { recursive: true });
// Explicit disposable-QA phases. Parent controls both backend restarts.
// Never calls MCP tools, synthesis, watermark, bindings or model installation.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const origin = 'http://127.0.0.1:4312';
const qa = new URL('../../.tmp/candidate-session/data/', import.meta.url);
const reportPath = new URL('../../.tmp/qa/integrations-runtime.json', import.meta.url);
const phase = process.argv[2];
assert(['inspect', 'enable', 'handshake', 'disable', 'final'].includes(phase), 'Select inspect|enable|handshake|disable|final. Restarts are external and explicit.');
let report;
try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; report = { scope: 'Parent-owned disposable QA only', origin, phases: [], limits: ['No tools/call, synthesis, watermark, license acceptance or model/package download', 'Backend restarts controlled externally by parent', 'Metadata and handshake do not accept or verify individual MCP tool execution'] }; }
const record = { phase, at: new Date().toISOString(), checks: [] };
function check(name, passed, evidence) { record.checks.push({ name, passed: Boolean(passed), ...(evidence === undefined ? {} : { evidence }) }); assert(passed, name); }
async function response(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('X-VoiceStudio-CSRF', '1'); headers.set('Origin', 'http://tauri.localhost'); headers.set('Sec-Fetch-Site', 'same-origin');
  if (path === '/next/activity') headers.set('x-voicestudio-next', 'seventy-seven-qa-owned');
  return fetch(origin + path, { ...options, headers, signal: options.signal || AbortSignal.timeout(30000) });
}
async function json(path, options) { const result = await response(path, options); assert(result.ok, `${path}: HTTP ${result.status}`); return result.json(); }
async function settingsFile() { try { return JSON.parse(await readFile(new URL('integration-settings.json', qa), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function environmentHash() { try { return createHash('sha256').update(await readFile(new URL('environment', qa))).digest('hex'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function idleActivity() {
  const deadline = Date.now() + 10000;
  const transitions = [];
  let state;
  do {
    state = await json('/next/activity');
    if (transitions.at(-1)?.reason !== state.reason) transitions.push(state);
    if (!state.busy || ['probe-error', 'interrupted-request', 'longform-proof-error'].includes(state.reason)) break;
    // Wait for observed ASGI completion, never clear or override busy debt.
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  record.activity_transitions = transitions;
  return state;
}
try {
  const healthResponse = await response('/health');
  check('Owned QA backend marker', healthResponse.ok && healthResponse.headers.get('x-voicestudio-next') === 'seventy-seven-qa-owned');
  record.health = await healthResponse.json();
  if (phase === 'inspect' || phase === 'final') {
    const [state, capabilities, discovery, models, activity] = await Promise.all([
      json('/next/integrations/settings'), json('/v1/audio/capabilities'), json('/.well-known/voicestudio-speech'), json('/v1/models'), json('/next/activity')]);
    record.state = state; record.capabilities = capabilities; record.discovery = discovery;
    record.models = models.data.map(model => ({ id: model.id, ...model.voicestudio })); record.activity = activity;
    check('Actual API metadata protocol and model list', capabilities.protocol === 'voicestudio.speech.v1' && Array.isArray(models.data) && models.data.length > 0);
    check('Discovery advertises the actual speech protocol', discovery.protocol === capabilities.protocol);
    check('MCP is configured OFF', !state.settings.mcp_enabled && !state.effective.mcp_enabled);
    check('MCP is not mounted and no session task runs', !state.effective.mounted && !state.effective.session_task_active);
    const absent = await response('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'qa-off-route-check', version: '1' } } }) });
    record.off_route_status = absent.status; await absent.body?.cancel();
    check('OFF route does not accept initialize', absent.status === 404);
    record.advertised_mcp_while_disabled = JSON.stringify(capabilities.endpoints).includes('/mcp') || JSON.stringify(discovery.endpoints).includes('/mcp');
    record.configuration_file = await settingsFile();
    if (phase === 'final') {
      check('Persisted QA MCP file is OFF after final controlled restart', record.configuration_file?.mcp_enabled === false && !state.restart_required);
      record.activity_after = await idleActivity();
      check('Activity probe is authoritative and idle after the lock compatibility fix', !record.activity_after.busy && record.activity_after.reason === null);
    }
  } else if (phase === 'enable' || phase === 'disable') {
    const before = await json('/next/integrations/settings');
    const enabled = phase === 'enable';
    const previousHash = await environmentHash();
    const result = await json('/next/integrations/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcp_enabled: enabled, mcp_output_mode: 'files' }) });
    record.before = before; record.after = result;
    record.configuration_file = await settingsFile();
    check('PUT persists only the intended QA integration file', record.configuration_file?.schema_version === 1 && record.configuration_file.mcp_enabled === enabled && record.configuration_file.mcp_output_mode === 'files');
    check('Private environment remains byte-identical', await environmentHash() === previousHash);
    check('Running process keeps its previous MCP flag until restart', result.effective.mcp_enabled === before.effective.mcp_enabled);
    check('Requested change requires explicit restart', result.settings.mcp_enabled === enabled && result.restart_required);
  } else {
    const state = await json('/next/integrations/settings'); record.state = state;
    check('MCP ON is mounted after controlled restart', state.settings.mcp_enabled && state.effective.mcp_enabled && state.effective.mounted && state.effective.session_task_active && !state.restart_required);
    const source = await readFile(new URL('../../src/lib/platform/integrations.ts', import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = {}; new Function('exports', code)(module);
    const calls = []; record.calls = calls;
    const transport = async (path, options) => {
      assert.equal(path, '/mcp');
      const rpc = options.body ? JSON.parse(options.body).method : null;
      assert(['initialize', 'notifications/initialized', 'tools/list', null].includes(rpc), 'Forbidden tool invocation');
      assert(options.method === 'POST' || options.method === 'DELETE');
      const result = await response(path, options);
      calls.push({ method: options.method, rpc, status: result.status, contentType: result.headers.get('content-type'), sessionHeaderPresent: Boolean(result.headers.get('mcp-session-id')), protocolHeaderPresent: Boolean(options.headers?.['MCP-Protocol-Version']) });
      return result;
    };
    record.connection = await module.testMcpConnection(transport);
    record.calls = calls;
    check('Actual product client negotiates MCP and receives tool names', Boolean(record.connection.protocol) && record.connection.tools.length > 0);
    check('Only initialize, initialized, tools/list and optional session cleanup ran', calls.some(call => call.rpc === 'tools/list') && !calls.some(call => call.rpc === 'tools/call'));
    check('Negotiated protocol header reaches tools/list', calls.find(call => call.rpc === 'tools/list')?.protocolHeaderPresent);
    if (calls.some(call => call.sessionHeaderPresent)) check('Owned MCP session is explicitly deleted', calls.some(call => call.method === 'DELETE' && call.status >= 200 && call.status < 300));
    record.activity_after = await idleActivity();
    check('Metadata handshake leaves Activity idle', !record.activity_after.busy);
  }
  record.passed = true;
} catch (error) {
  record.passed = false; record.error = error.message;
  process.exitCode = 1;
} finally {
  report.phases.push(record); report.completed_with_mcp_off = phase === 'final' && record.passed;
  report.mcp_protocol_passed = report.phases.some(item => item.connection?.tools?.length > 0 && item.calls?.some(call => call.rpc === 'tools/list' && call.status === 200) && item.calls?.some(call => call.method === 'DELETE' && call.status === 200));
  report.acceptance_passed = report.completed_with_mcp_off && report.mcp_protocol_passed;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}
