// The interface talks to the engine through the /backend proxy in a browser. Every call is answered here; nothing leaves the test.
const KNOWN = {
  '/health': { status: 'ok' },
};

/** Answers every /backend request with a canned JSON body; returns the list of paths that were asked for. */
export async function mockRuntime(page) {
  const asked = [];
  await page.route('**/backend/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/backend/, '');
    asked.push(`${route.request().method()} ${path}`);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(KNOWN[path] ?? {}) });
  });
  return asked;
}
