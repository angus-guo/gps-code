import type {CommandRequest} from '../commands/types.js';
import type {RepoMap} from '../workspace/types.js';

export type ValidationSuggestion = {
  command: CommandRequest;
  reason: string;
};

function packageScriptCommand(packageManager: string, script: string): CommandRequest {
  if (script === 'test') {
    return {command: packageManager, args: ['test']};
  }
  return {command: packageManager, args: ['run', script]};
}

export function suggestValidationCommand(repoMap: RepoMap): ValidationSuggestion | null {
  const packageManager = ['pnpm', 'yarn', 'npm', 'bun']
    .find((candidate) => repoMap.packageManagers.includes(candidate));
  if (packageManager) {
    const script = ['test', 'typecheck', 'build']
      .find((candidate) => repoMap.scripts.some(({name}) => name === candidate));
    if (script) {
      return {
        command: packageScriptCommand(packageManager, script),
        reason: `检测到 package.json 中的 ${script} 脚本`
      };
    }
  }

  if (repoMap.buildTools.includes('maven')) {
    return {
      command: {command: 'mvn', args: ['test']},
      reason: '检测到 Maven 项目'
    };
  }
  if (repoMap.buildTools.includes('gradle')) {
    const command = repoMap.keyFiles.includes('gradlew') ? './gradlew' : 'gradle';
    return {
      command: {command, args: ['test']},
      reason: '检测到 Gradle 项目'
    };
  }

  return null;
}

export function formatValidationSuggestion(suggestion: ValidationSuggestion) {
  return `编辑已应用。${suggestion.reason}，建议运行以下命令验证：`;
}
