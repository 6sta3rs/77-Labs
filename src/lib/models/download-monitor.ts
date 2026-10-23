import { get, writable } from 'svelte/store';
import { activeDownload, modelManagement, type ModelDownload } from './model-management';
import { nextEta, type DownloadEta } from './download-eta';

/** Shared view of model downloads: speed/ETA per repo for the Models page and the header indicator. */
export const downloadState = writable<{ jobs: ModelDownload[]; eta: Record<string, DownloadEta> }>({ jobs: [], eta: {} });

const POLL_MS = 2000;
let timer: ReturnType<typeof setTimeout> | undefined, lastReport = 0, failures = 0;

/** Feed the latest job list. Starts the background poll when something is active (the Models page may unmount mid-download). */
export function reportDownloads(jobs: ModelDownload[], now = Date.now()) {
  lastReport = now;
  const previous = get(downloadState).eta, eta: Record<string, DownloadEta> = {};
  for (const job of jobs) if (activeDownload(job) && job.state === 'downloading') eta[job.repo_id] = nextEta(previous[job.repo_id]?.samples ?? [], job.downloaded_bytes, job.total_bytes, now);
  downloadState.set({ jobs: jobs.filter(activeDownload), eta });
  if (jobs.some(activeDownload) && !timer) schedule();
}

function schedule() {
  timer = setTimeout(async () => {
    timer = undefined;
    // Skip the request when the Models page just reported; poll only while a job is active.
    if (Date.now() - lastReport >= POLL_MS * 0.6) {
      try { reportDownloads((await modelManagement.status(AbortSignal.timeout(5000))).jobs); failures = 0; }
      catch { if (++failures >= 3) { failures = 0; downloadState.set({ jobs: [], eta: {} }); return; } }
    }
    if (!timer && (get(downloadState).jobs.length || failures)) schedule();
  }, POLL_MS);
}

/** One-off check (engine became ready): picks up downloads that were already running. */
export const probeDownloads = () => modelManagement.status(AbortSignal.timeout(5000)).then(status => reportDownloads(status.jobs)).catch(() => {});
