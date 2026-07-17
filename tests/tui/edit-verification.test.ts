import {describe, expect, it} from 'vitest';
import {suggestValidationCommand} from '../../src/tui/edit-verification.js';
import type {RepoMap} from '../../src/workspace/types.js';

function repoMap(overrides: Partial<RepoMap>): RepoMap {
  return {
    root: '/repo',
    languages: [],
    frameworks: [],
    packageManagers: [],
    buildTools: [],
    scripts: [],
    keyFiles: [],
    keyDirectories: [],
    ...overrides
  };
}

describe('suggestValidationCommand', () => {
  it('prefers test over typecheck and build package scripts', () => {
    expect(suggestValidationCommand(repoMap({
      packageManagers: ['pnpm'],
      scripts: [
        {name: 'build', command: 'tsup', source: 'package.json'},
        {name: 'test', command: 'vitest run', source: 'package.json'}
      ]
    }))).toEqual({
      command: {command: 'pnpm', args: ['test']},
      reason: '检测到 package.json 中的 test 脚本'
    });
  });

  it('uses the existing package manager confirmation command for fallback scripts', () => {
    expect(suggestValidationCommand(repoMap({
      packageManagers: ['npm'],
      scripts: [{name: 'typecheck', command: 'tsc --noEmit', source: 'package.json'}]
    }))?.command).toEqual({command: 'npm', args: ['run', 'typecheck']});
  });

  it('suggests conventional Java test commands', () => {
    expect(suggestValidationCommand(repoMap({buildTools: ['maven']}))?.command)
      .toEqual({command: 'mvn', args: ['test']});
    expect(suggestValidationCommand(repoMap({buildTools: ['gradle']}))?.command)
      .toEqual({command: 'gradle', args: ['test']});
  });

  it('returns no command without reliable repository evidence', () => {
    expect(suggestValidationCommand(repoMap({languages: ['python']}))).toBeNull();
    expect(suggestValidationCommand(repoMap({buildTools: ['cmake']}))).toBeNull();
  });
});
