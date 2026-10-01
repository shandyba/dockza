import { describe, it, expect } from 'vitest';
import { composeInfo, parseDependsOn } from '@utils/compose';

describe('parseDependsOn', () => {
  it('reads the service names out of the label', () => {
    expect(parseDependsOn('db:service_healthy:true,cache:service_started:false')).toEqual(['db', 'cache']);
  });

  it('is empty for an empty or missing label', () => {
    expect(parseDependsOn('')).toEqual([]);
    expect(parseDependsOn(undefined)).toEqual([]);
  });

  it('drops blanks and repeats', () => {
    expect(parseDependsOn('db:service_started:true,,db:service_healthy:true')).toEqual(['db']);
  });
});

describe('composeInfo', () => {
  const labels = {
    'com.docker.compose.project': 'db-pr02',
    'com.docker.compose.service': 'api',
    'com.docker.compose.project.config_files': '/srv/db-pr02/compose.yaml,/srv/db-pr02/compose.override.yaml',
    'com.docker.compose.project.working_dir': '/srv/db-pr02',
    'com.docker.compose.depends_on': 'db:service_healthy:true',
    'com.docker.compose.oneoff': 'False',
  };

  it('reads the project, service, files, working dir and depends_on', () => {
    expect(composeInfo(labels)).toEqual({
      project: 'db-pr02',
      service: 'api',
      configFiles: ['/srv/db-pr02/compose.yaml', '/srv/db-pr02/compose.override.yaml'],
      workingDir: '/srv/db-pr02',
      dependsOn: ['db'],
      oneoff: false,
    });
  });

  it('marks a `docker compose run` container as one-off', () => {
    expect(composeInfo({ ...labels, 'com.docker.compose.oneoff': 'True' })?.oneoff).toBe(true);
  });

  it('is undefined for a container compose did not create', () => {
    expect(composeInfo({})).toBeUndefined();
    expect(composeInfo({ 'com.docker.compose.service': 'x' })).toBeUndefined();
  });

  it('tolerates missing optional labels', () => {
    expect(composeInfo({ 'com.docker.compose.project': 'p' })).toEqual({
      project: 'p',
      service: '',
      configFiles: [],
      dependsOn: [],
      oneoff: false,
    });
  });
});
