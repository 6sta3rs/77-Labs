// Navigation acceptance now covers the shared dashboard/settings shell.
// Run in an isolated browser profile; no synthesis or AI calls.
await import(`./dashboard-shell-check.js?run=${Date.now()}`);
