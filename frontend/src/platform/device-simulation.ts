export type SystemInfo = { cpu: number; cpu_model: string; cpu_physical_cores: number; cpu_logical_cores: number; cpu_frequency_ghz: number; ram: number; total_ram: number; gpu_name: string; gpu_utilization: number | null; vram: number; total_vram: number };

// Correlated example workloads, repeated locally. No measurements or inference.
const samples = [
  [8, 2, 6.4, .7, 'Spoczynek'],
  [14, 4, 6.7, .9, 'Spoczynek'],
  [39, 26, 8.2, 2.4, 'Wczytywanie modelu'],
  [58, 54, 9.6, 4.5, 'Wczytywanie modelu'],
  [32, 87, 10.8, 6.2, 'Generowanie mowy'],
  [46, 96, 11.4, 7.1, 'Generowanie mowy'],
  [35, 91, 11.1, 6.8, 'Generowanie mowy'],
  [62, 43, 10.2, 4.6, 'Przygotowywanie nagrania'],
  [24, 17, 8.3, 2.1, 'Przygotowywanie nagrania'],
  [11, 3, 6.8, .8, 'Spoczynek'],
] as const;

export function simulatedDevice(tick: number): { stats: SystemInfo; phase: string } {
  const [cpu, gpu, ram, vram, phase] = samples[((tick % samples.length) + samples.length) % samples.length];
  return { phase, stats: { cpu, cpu_model: 'Przykładowy procesor', cpu_physical_cores: 10, cpu_logical_cores: 16, cpu_frequency_ghz: 2.4, ram, total_ram: 16, gpu_name: 'Przykładowa karta graficzna', gpu_utilization: gpu, vram, total_vram: 8 } };
}
