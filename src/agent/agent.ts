import {seniorEngineerSystemPrompt} from './prompts.js';
import type {ModelClient} from '../model/types.js';
import type {RepoMap} from '../workspace/types.js';

export type Agent = {
  ask(input: string): Promise<string>;
};

export type AgentOptions = {
  model: ModelClient;
  repoMap: RepoMap;
};

function formatRepoMap(repoMap: RepoMap) {
  return JSON.stringify(
    {
      root: repoMap.root,
      languages: repoMap.languages,
      frameworks: repoMap.frameworks,
      packageManagers: repoMap.packageManagers,
      buildTools: repoMap.buildTools,
      scripts: repoMap.scripts,
      keyFiles: repoMap.keyFiles,
      keyDirectories: repoMap.keyDirectories
    },
    null,
    2
  );
}

export function createAgent(options: AgentOptions): Agent {
  return {
    async ask(input: string) {
      return options.model.chat([
        {role: 'system', content: seniorEngineerSystemPrompt},
        {
          role: 'system',
          content: `当前项目 repo map 如下。只能基于这些证据回答；如果需要更多文件，说明你还需要检查什么。\n\n${formatRepoMap(options.repoMap)}`
        },
        {role: 'user', content: input}
      ]);
    }
  };
}
