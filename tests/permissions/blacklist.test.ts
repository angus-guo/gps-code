import {describe, expect, it} from 'vitest';
import {classifyCommand} from '../../src/permissions/policy.js';

describe('destructive system commands', () => {
  it('blocks disk and power commands', () => {
    for (const command of ['dd', 'mkfs', 'format', 'fdisk', 'shutdown', 'reboot', 'poweroff']) {
      expect(classifyCommand({command}).classification).toBe('block');
    }
  });

  it('is case-insensitive', () => {
    expect(classifyCommand({command: 'SHUTDOWN'}).classification).toBe('block');
  });
});

describe('recursive permission changes', () => {
  it('blocks recursive chmod on system paths', () => {
    for (const target of ['/', '/etc', '/usr/bin', 'C:\\', '/windows/system32']) {
      const result = classifyCommand({command: 'chmod', args: ['-R', '777', target]});
      expect(result.classification).toBe('block');
      expect(result.reason).toContain('工作区之外');
    }
  });

  it('blocks recursive chmod that escapes the workspace', () => {
    expect(classifyCommand({command: 'chmod', args: ['-R', '755', '../..']}).classification)
      .toBe('block');
  });

  it('strong-confirms recursive chmod inside the workspace', () => {
    const result = classifyCommand({command: 'chmod', args: ['-R', '755', './scripts']});
    expect(result.classification).toBe('strong-confirm');
  });

  it('allows non-recursive chmod', () => {
    expect(classifyCommand({command: 'chmod', args: ['755', 'run.sh']}).classification)
      .toBe('allow');
  });

  it('applies the same rules to chown', () => {
    expect(classifyCommand({command: 'chown', args: ['-R', 'me', '/etc']}).classification)
      .toBe('block');
    expect(classifyCommand({command: 'chown', args: ['-R', 'me', 'src']}).classification)
      .toBe('strong-confirm');
  });
});

describe('global package installs', () => {
  it('strong-confirms global installs across package managers', () => {
    const cases = [
      {command: 'npm', args: ['install', '-g', 'typescript']},
      {command: 'npm', args: ['install', '--global', 'typescript']},
      {command: 'pnpm', args: ['add', '-g', 'tsx']},
      {command: 'yarn', args: ['global', 'add', 'tsx']},
      {command: 'bun', args: ['add', '-g', 'tsx']},
      {command: 'pip', args: ['install', '--user', 'requests']}
    ];
    for (const request of cases) {
      const result = classifyCommand(request);
      expect(result.classification, JSON.stringify(request)).toBe('strong-confirm');
      expect(result.reason).toContain('全局');
    }
  });

  it('leaves local installs alone', () => {
    expect(classifyCommand({command: 'pnpm', args: ['install']}).classification).toBe('allow');
    expect(classifyCommand({command: 'npm', args: ['install', 'lodash']}).classification)
      .toBe('allow');
    // Regression: --force on a local install must not read as a force-push.
    expect(classifyCommand({command: 'pnpm', args: ['install', '--force']}).classification)
      .toBe('allow');
  });
});

describe('database migrations', () => {
  it('strong-confirms forward migrations', () => {
    const cases = [
      {command: 'prisma', args: ['migrate', 'deploy']},
      {command: 'npx', args: ['prisma', 'migrate', 'dev']},
      {command: 'alembic', args: ['upgrade', 'head']},
      {command: 'rails', args: ['db:migrate']},
      {command: 'rake', args: ['db:migrate']},
      {command: 'django-admin', args: ['migrate']},
      {command: 'flyway', args: ['migrate']},
      {command: 'knex', args: ['migrate:latest']}
    ];
    for (const request of cases) {
      const result = classifyCommand(request);
      expect(result.classification, JSON.stringify(request)).toBe('strong-confirm');
    }
  });

  it('blocks destructive migrations', () => {
    const cases = [
      {command: 'prisma', args: ['migrate', 'reset']},
      {command: 'rails', args: ['db:drop']},
      {command: 'alembic', args: ['downgrade', 'base']},
      {command: 'knex', args: ['migrate:rollback']},
      {command: 'flyway', args: ['clean']}
    ];
    for (const request of cases) {
      const result = classifyCommand(request);
      expect(result.classification, JSON.stringify(request)).toBe('block');
      expect(result.reason).toContain('数据');
    }
  });

  it('does not treat unrelated commands as migrations', () => {
    expect(classifyCommand({command: 'pnpm', args: ['run', 'deploy']}).classification)
      .toBe('allow');
    // `git reset HEAD~1` must not be caught by the destructive migration token.
    expect(classifyCommand({command: 'git', args: ['reset', 'HEAD~1']}).classification)
      .toBe('allow');
  });
});

describe('allowlist and denylist', () => {
  const options = {
    allowlist: ['rm notes.txt', 'chmod -R 755 ./scripts', 'pnpm *'],
    denylist: ['curl *', 'pnpm publish']
  };

  it('downgrades a matching confirm to allow', () => {
    expect(classifyCommand({command: 'rm', args: ['notes.txt']}, options).classification)
      .toBe('allow');
  });

  it('downgrades a matching strong-confirm to allow', () => {
    expect(
      classifyCommand({command: 'chmod', args: ['-R', '755', './scripts']}, options).classification
    ).toBe('allow');
  });

  it('supports a trailing wildcard', () => {
    expect(classifyCommand({command: 'pnpm', args: ['add', '-g', 'x']}, options).classification)
      .toBe('allow');
  });

  it('refuses denylisted commands that would otherwise be allowed', () => {
    const result = classifyCommand({command: 'curl', args: ['https://example.com']}, options);
    expect(result.classification).toBe('block');
    expect(result.reason).toContain('denylist');
  });

  it('checks the denylist before the allowlist', () => {
    // `pnpm publish` matches the `pnpm *` allowlist entry and the denylist;
    // the denylist has to win.
    const result = classifyCommand({command: 'pnpm', args: ['publish']}, options);
    expect(result.classification).toBe('block');
  });

  it('cannot allowlist past a built-in block', () => {
    const permissive = {allowlist: ['rm -rf /', 'git push --force', 'shutdown']};
    expect(classifyCommand({command: 'rm', args: ['-rf', '/']}, permissive).classification)
      .toBe('block');
    expect(classifyCommand({command: 'git', args: ['push', '--force']}, permissive).classification)
      .toBe('block');
    expect(classifyCommand({command: 'shutdown'}, permissive).classification).toBe('block');
  });

  it('ignores empty patterns', () => {
    const result = classifyCommand({command: 'ls'}, {denylist: ['', '   ']});
    expect(result.classification).toBe('allow');
  });
});
