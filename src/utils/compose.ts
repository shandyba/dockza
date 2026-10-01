import type { ComposeInfo } from '@models/docker';

export const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
export const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
export const COMPOSE_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
export const COMPOSE_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
export const COMPOSE_DEPENDS_ON_LABEL = 'com.docker.compose.depends_on';
export const COMPOSE_ONEOFF_LABEL = 'com.docker.compose.oneoff';
export const COMPOSE_VOLUME_LABEL = 'com.docker.compose.volume';
export const COMPOSE_NETWORK_LABEL = 'com.docker.compose.network';

/**
 * The services a `com.docker.compose.depends_on` label names: `"db:service_healthy:true,cache:…"`
 * → `['db', 'cache']`. Often `""`.
 */
export function parseDependsOn(label: string | undefined): string[] {
  if (!label) return [];
  const services = label
    .split(',')
    .map((entry) => entry.split(':')[0].trim())
    .filter((s) => s !== '');
  return [...new Set(services)];
}

/** What compose's labels say about a container, or `undefined` when compose didn't create it. */
export function composeInfo(labels: Record<string, string>): ComposeInfo | undefined {
  const project = labels[COMPOSE_PROJECT_LABEL];
  if (!project) return undefined;
  const workingDir = labels[COMPOSE_WORKING_DIR_LABEL];
  return {
    project,
    service: labels[COMPOSE_SERVICE_LABEL] ?? '',
    configFiles: (labels[COMPOSE_CONFIG_FILES_LABEL] ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f !== ''),
    ...(workingDir ? { workingDir } : {}),
    dependsOn: parseDependsOn(labels[COMPOSE_DEPENDS_ON_LABEL]),
    oneoff: labels[COMPOSE_ONEOFF_LABEL] === 'True',
  };
}
