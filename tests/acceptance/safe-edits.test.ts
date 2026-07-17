import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {applyEditProposal, createEditApplier} from '../../src/edits/apply.js';
import {undoEditProposal} from '../../src/edits/undo.js';
import {getProposedFileEdits, proposeFileEditsTool} from '../../src/tools/propose-file-edits.js';
import {
  getEditConfirmationDecision,
  getUndoConfirmationDecision
} from '../../src/tui/edit-confirmation.js';
import {buildRepoMap} from '../../src/workspace/indexer.js';
import type {SupportedLanguage} from '../../src/workspace/types.js';

const fixturesRoot = fileURLToPath(new URL('../fixtures/safe-edits', import.meta.url));
let tempDirs: string[] = [];

type LanguageCase = {
  language: string;
  expectedLanguage: SupportedLanguage;
  fixture: string;
  path: string;
  oldText: string;
  newText: string;
};

const languageCases: LanguageCase[] = [
  {
    language: 'JavaScript/TypeScript',
    expectedLanguage: 'javascript-typescript',
    fixture: 'typescript',
    path: 'src/math.ts',
    oldText: 'return left + right;',
    newText: 'return Number(left) + Number(right);'
  },
  {
    language: 'Python',
    expectedLanguage: 'python',
    fixture: 'python',
    path: 'calculator.py',
    oldText: 'return left + right',
    newText: 'return int(left) + int(right)'
  },
  {
    language: 'Java',
    expectedLanguage: 'java',
    fixture: 'java',
    path: 'src/main/java/Calculator.java',
    oldText: 'return left + right;',
    newText: 'return Math.addExact(left, right);'
  },
  {
    language: 'C/C++',
    expectedLanguage: 'c-cpp',
    fixture: 'cpp',
    path: 'src/calculator.cpp',
    oldText: 'return left + right;',
    newText: 'return static_cast<int>(left + right);'
  }
];

async function copyFixture(name: string) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'gps-code-acceptance-'));
  tempDirs.push(tempRoot);
  const workspace = join(tempRoot, 'workspace');
  await cp(join(fixturesRoot, name), workspace, {recursive: true});
  return workspace;
}

async function propose(root: string, testCase: LanguageCase) {
  const result = await proposeFileEditsTool.execute({
    summary: `${testCase.language} focused edit`,
    files: [{
      path: testCase.path,
      reason: 'Exercise a focused language edit',
      action: 'update',
      operations: [{oldText: testCase.oldText, newText: testCase.newText}]
    }]
  }, {root});
  const proposed = getProposedFileEdits(result.metadata);
  if (!proposed) {
    throw new Error('Expected a valid proposed edit.');
  }
  return proposed;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, {recursive: true, force: true})));
  tempDirs = [];
});

describe('M5 cross-language safe edit acceptance', () => {
  it.each(languageCases)('$language supports preview, confirm, apply, and undo', async (testCase) => {
    const root = await copyFixture(testCase.fixture);
    const targetPath = join(root, testCase.path);
    const originalContent = await readFile(targetPath, 'utf8');
    const repoMap = await buildRepoMap(root);
    const proposed = await propose(root, testCase);

    expect(repoMap.languages).toContain(testCase.expectedLanguage);
    expect(await readFile(targetPath, 'utf8')).toBe(originalContent);
    expect(proposed.preview.files[0].patch.split('\n').some(
      (line) => line.startsWith('+') && line.includes(testCase.newText)
    )).toBe(true);
    expect(getEditConfirmationDecision('确认')).toBe('confirm');

    await applyEditProposal(root, proposed.proposal);
    expect(await readFile(targetPath, 'utf8')).toContain(testCase.newText);
    expect(getUndoConfirmationDecision('撤销')).toBe('confirm');

    await undoEditProposal(root, proposed.proposal);
    expect(await readFile(targetPath, 'utf8')).toBe(originalContent);
  });

  it('keeps a Python fixture unchanged when the user rejects the proposal', async () => {
    const testCase = languageCases[1];
    const root = await copyFixture(testCase.fixture);
    const targetPath = join(root, testCase.path);
    const originalContent = await readFile(targetPath, 'utf8');
    await propose(root, testCase);

    expect(getEditConfirmationDecision('取消')).toBe('reject');
    expect(await readFile(targetPath, 'utf8')).toBe(originalContent);
  });

  it('rejects a stale Java proposal before applying it', async () => {
    const testCase = languageCases[2];
    const root = await copyFixture(testCase.fixture);
    const targetPath = join(root, testCase.path);
    const proposed = await propose(root, testCase);
    const userContent = `${await readFile(targetPath, 'utf8')}\n// user change\n`;
    await writeFile(targetPath, userContent, 'utf8');

    await expect(applyEditProposal(root, proposed.proposal)).rejects.toThrow(/stale/i);
    expect(await readFile(targetPath, 'utf8')).toBe(userContent);
  });

  it('rolls back an earlier TypeScript write when a later apply fails', async () => {
    const root = await copyFixture('typescript');
    const mathPath = join(root, 'src/math.ts');
    const formatPath = join(root, 'src/format.ts');
    const mathOriginal = await readFile(mathPath, 'utf8');
    const formatOriginal = await readFile(formatPath, 'utf8');
    const result = await proposeFileEditsTool.execute({
      summary: 'Two-file TypeScript edit',
      files: [
        {
          path: 'src/math.ts',
          reason: 'Update addition',
          action: 'update',
          operations: [{oldText: 'return left + right;', newText: 'return Number(left) + Number(right);'}]
        },
        {
          path: 'src/format.ts',
          reason: 'Update label',
          action: 'update',
          operations: [{oldText: 'Result:', newText: 'Calculation:'}]
        }
      ]
    }, {root});
    const proposed = getProposedFileEdits(result.metadata);
    expect(proposed).not.toBeNull();

    let renameCalls = 0;
    const {rename: realRename} = await import('node:fs/promises');
    const applyWithFailure = createEditApplier({
      async rename(oldPath, newPath) {
        renameCalls += 1;
        if (renameCalls === 2) {
          throw new Error('injected acceptance failure');
        }
        await realRename(oldPath, newPath);
      }
    });

    await expect(applyWithFailure(root, proposed!.proposal)).rejects.toThrow(/acceptance failure/i);
    expect(await readFile(mathPath, 'utf8')).toBe(mathOriginal);
    expect(await readFile(formatPath, 'utf8')).toBe(formatOriginal);
  });

  it('refuses to undo a C/C++ file changed after GPS Code applied it', async () => {
    const testCase = languageCases[3];
    const root = await copyFixture(testCase.fixture);
    const targetPath = join(root, testCase.path);
    const proposed = await propose(root, testCase);
    await applyEditProposal(root, proposed.proposal);
    const userContent = `${await readFile(targetPath, 'utf8')}\n// user follow-up\n`;
    await writeFile(targetPath, userContent, 'utf8');

    await expect(undoEditProposal(root, proposed.proposal))
      .rejects.toThrow(/changed after GPS Code applied/i);
    expect(await readFile(targetPath, 'utf8')).toBe(userContent);
  });
});
