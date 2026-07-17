import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {prepareEditProposal} from '../../src/edits/proposal.js';
import {MAX_EDIT_FILES, MAX_EDIT_TEXT_BYTES} from '../../src/edits/types.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-edits-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('prepareEditProposal', () => {
  it('prepares an exact update without writing the file', async () => {
    const root = await makeRoot();
    const path = join(root, 'app.ts');
    await writeFile(path, 'const answer = 41;\n', 'utf8');

    const proposal = await prepareEditProposal(root, {
      summary: '修正答案',
      files: [{
        path: 'app.ts',
        reason: '修正错误常量',
        action: 'update',
        operations: [{oldText: '41', newText: '42'}]
      }]
    });

    expect(proposal.files[0]).toMatchObject({
      path: 'app.ts',
      action: 'update',
      originalContent: 'const answer = 41;\n',
      proposedContent: 'const answer = 42;\n'
    });
    expect(proposal.files[0].expectedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(proposal.files[0].proposedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path, 'utf8')).toBe('const answer = 41;\n');
  });

  it('prepares a create proposal without creating the file', async () => {
    const root = await makeRoot();

    const proposal = await prepareEditProposal(root, {
      summary: '增加配置',
      files: [{
        path: 'config.ts',
        reason: '提供默认配置',
        action: 'create',
        operations: [{oldText: '', newText: 'export const enabled = true;\n'}]
      }]
    });

    expect(proposal.files[0].expectedHash).toBeNull();
    expect(proposal.files[0].proposedContent).toContain('enabled');
    await expect(readFile(join(root, 'config.ts'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('rejects paths outside the workspace', async () => {
    const root = await makeRoot();

    await expect(prepareEditProposal(root, {
      summary: '越界修改',
      files: [{
        path: '../outside.ts',
        reason: '不允许',
        action: 'create',
        operations: [{oldText: '', newText: 'unsafe'}]
      }]
    })).rejects.toThrow(/outside workspace/i);
  });

  it('rejects symbolic-link targets and symbolic-link parents', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await mkdir(join(root, 'real-dir'));
    await writeFile(join(outside, 'outside.ts'), 'outside\n', 'utf8');
    await symlink(join(outside, 'outside.ts'), join(root, 'linked.ts'));
    await symlink(outside, join(root, 'linked-dir'));
    await symlink(join(root, 'real-dir'), join(root, 'internal-link'));

    await expect(prepareEditProposal(root, {
      summary: '修改链接',
      files: [{
        path: 'linked.ts',
        reason: '不允许',
        action: 'update',
        operations: [{oldText: 'outside', newText: 'inside'}]
      }]
    })).rejects.toThrow(/symbolic links/i);

    await expect(prepareEditProposal(root, {
      summary: '通过链接创建',
      files: [{
        path: 'linked-dir/new.ts',
        reason: '不允许',
        action: 'create',
        operations: [{oldText: '', newText: 'unsafe'}]
      }]
    })).rejects.toThrow(/outside workspace|symbolic links/i);

    await expect(prepareEditProposal(root, {
      summary: '通过内部链接创建',
      files: [{
        path: 'internal-link/new.ts',
        reason: '不允许',
        action: 'create',
        operations: [{oldText: '', newText: 'unsafe'}]
      }]
    })).rejects.toThrow(/symbolic links/i);
  });

  it('requires update text to match exactly once', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'repeated.ts'), 'same\nsame\n', 'utf8');

    await expect(prepareEditProposal(root, {
      summary: '模糊替换',
      files: [{
        path: 'repeated.ts',
        reason: '匹配不唯一',
        action: 'update',
        operations: [{oldText: 'same', newText: 'changed'}]
      }]
    })).rejects.toThrow(/exactly once/i);

    await expect(prepareEditProposal(root, {
      summary: '缺失替换',
      files: [{
        path: 'repeated.ts',
        reason: '找不到目标',
        action: 'update',
        operations: [{oldText: 'missing', newText: 'changed'}]
      }]
    })).rejects.toThrow(/not found/i);
  });

  it('rejects duplicate paths, no-op edits, and existing create targets', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'app.ts'), 'value\n', 'utf8');
    const file = {
      path: 'app.ts',
      reason: '测试边界',
      action: 'update' as const,
      operations: [{oldText: 'value', newText: 'changed'}]
    };

    await expect(prepareEditProposal(root, {
      summary: '重复路径',
      files: [file, file]
    })).rejects.toThrow(/duplicate/i);

    await expect(prepareEditProposal(root, {
      summary: '无变化',
      files: [{...file, operations: [{oldText: 'value', newText: 'value'}]}]
    })).rejects.toThrow(/does not change/i);

    await expect(prepareEditProposal(root, {
      summary: '重复创建',
      files: [{...file, action: 'create', operations: [{oldText: '', newText: 'new'}]}]
    })).rejects.toThrow(/already exists/i);
  });

  it('rejects binary and invalid UTF-8 files', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'binary.bin'), Buffer.from([0x47, 0x50, 0x00, 0x53]));
    await writeFile(join(root, 'invalid.txt'), Buffer.from([0xc3, 0x28]));

    for (const path of ['binary.bin', 'invalid.txt']) {
      await expect(prepareEditProposal(root, {
        summary: '文本修改',
        files: [{
          path,
          reason: '文件必须是文本',
          action: 'update',
          operations: [{oldText: 'GPS', newText: 'gps'}]
        }]
      })).rejects.toThrow(/binary|UTF-8/i);
    }
  });

  it('enforces proposal file and operation bounds', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'src'));
    const files = Array.from({length: MAX_EDIT_FILES + 1}, (_, index) => ({
      path: `src/file-${index}.ts`,
      reason: '超出文件限制',
      action: 'create' as const,
      operations: [{oldText: '', newText: `${index}`}]
    }));

    await expect(prepareEditProposal(root, {
      summary: '过多文件',
      files
    })).rejects.toThrow();

    await writeFile(join(root, 'many.ts'), Array.from({length: 21}, (_, index) => `v${index}`).join('\n'));
    await expect(prepareEditProposal(root, {
      summary: '过多操作',
      files: [{
        path: 'many.ts',
        reason: '超出操作限制',
        action: 'update',
        operations: Array.from({length: 21}, (_, index) => ({
          oldText: `v${index}`,
          newText: `x${index}`
        }))
      }]
    })).rejects.toThrow(/too many operations|Array must contain at most/i);
  });

  it('rejects proposals whose combined text exceeds the byte limit', async () => {
    const root = await makeRoot();

    await expect(prepareEditProposal(root, {
      summary: '过大提案',
      files: [{
        path: 'large.ts',
        reason: '超出文本限制',
        action: 'create',
        operations: [{oldText: '', newText: 'x'.repeat(MAX_EDIT_TEXT_BYTES + 1)}]
      }]
    })).rejects.toThrow(/text is too large/i);
  });
});
