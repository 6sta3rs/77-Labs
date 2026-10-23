// The interface talks to the engine through the /backend proxy in a browser (and to the AI adapter through /ai).
// Every call is answered here with a canned body of the real shape; nothing leaves the test.
const KNOWN = {
  '/health': { status: 'ok' },
  // A body without a boolean `active` makes the app refuse to route operations ("Nie odczytano wybranego połączenia silnika").
  '/next/remote/state': { active: false },
  '/sysinfo': {
    cpu: 12, cpu_model: 'Test CPU', cpu_physical_cores: 6, cpu_logical_cores: 12, cpu_frequency_ghz: 3.2,
    ram: 8, total_ram: 32, gpu_name: 'Test GPU', gpu_utilization: 10, vram: 2, total_vram: 12,
  },
  '/history': [],
  '/model/loaded': { models: [] },
  '/engines': { tts: { backends: [], active: '' }, asr: { backends: [], active: '' }, llm: { backends: [], active: '' } },
  '/models': { models: [] },
  '/next/models/jobs': { jobs: [] },
  '/api/settings/llm-providers': { providers: [], active: null },
  '/api/settings/llm-skills': { skills: [] },
  '/api/settings/asr-openai-compat': { base_url: '', model: '' },
  '/next/settings/credentials': { fields: [] },
  '/next/settings/added-llm-providers': { ids: [] },
};
const AI = {
  '/ai/status': { installed: true, connected: false, authMode: 'none', models: [], message: 'Codex is not signed in' },
  '/ai/settings': { enabled: true, model: '', intensity: 'natural', reactions: true },
};

/** Answers every /backend and /ai request. `overrides` replaces bodies by path; returns the requests seen: `{ asked, writes }`. */
export async function mockRuntime(page, overrides = {}) {
  const seen = { asked: [], writes: [] };
  const bodies = { ...KNOWN, ...AI, ...overrides };
  await page.route(/\/(backend|ai)\//, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/backend/, '');
    seen.asked.push(`${request.method()} ${path}`);
    if (request.method() !== 'GET') {
      const body = request.postData() ? JSON.parse(request.postData()) : {};
      seen.writes.push({ method: request.method(), path, body });
      // A stored list echoes what was written (the engine confirms the list it stored).
      const reply = path.endsWith('added-llm-providers') ? body : bodies[path] ?? {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[path] ?? {}) });
  });
  return seen;
}
