// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function calcCPUPercent(stats: any): number {
  const cpuDelta: number = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;

  const sysDelta: number = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

  const cpuCount: number = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;

  if (sysDelta <= 0) return 0;
  return (cpuDelta / sysDelta) * cpuCount * 100;
}
