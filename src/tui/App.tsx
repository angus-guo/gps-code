import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text} from 'ink';
import {createAgent} from '../agent/agent.js';
import {loadConfig} from '../config/store.js';
import {createOpenAICompatibleClient} from '../model/openai-compatible.js';
import type {ToolActivity} from '../tools/types.js';
import {buildRepoMap} from '../workspace/indexer.js';
import type {RepoMap} from '../workspace/types.js';
import {ChatView, type ChatMessageView} from './components/ChatView.js';
import {InputBox} from './components/InputBox.js';

function formatToolActivity(activity: ToolActivity) {
  const statusLabel = {
    started: '工具开始',
    completed: '工具完成',
    failed: '工具失败'
  }[activity.status];

  return `${statusLabel} ${activity.toolName}: ${activity.summary}`;
}

export function App({cwd}: {cwd: string}) {
  const [messages, setMessages] = useState<ChatMessageView[]>([
    {role: 'system', content: '欢迎使用 GPS Code。正在分析当前项目...'}
  ]);
  const [repoMap, setRepoMap] = useState<RepoMap | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    async function boot() {
      try {
        const map = await buildRepoMap(cwd);
        setRepoMap(map);
        setMessages((current) => [
          ...current,
          {
            role: 'system',
            content: `项目分析完成：语言=${map.languages.join(', ') || '未知'}；关键文件=${map.keyFiles.join(', ') || '暂无'}`
          }
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {role: 'system', content: `项目分析失败：${error instanceof Error ? error.message : String(error)}`}
        ]);
      } finally {
        setBusy(false);
      }
    }
    void boot();
  }, [cwd]);

  const canChat = useMemo(() => Boolean(repoMap) && !busy, [busy, repoMap]);

  async function handleSubmit(input: string) {
    if (!repoMap) return;
    setBusy(true);
    setMessages((current) => [...current, {role: 'user', content: input}]);
    try {
      const config = await loadConfig();
      if (!config) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: '还没有配置模型。请先退出并运行 gps-code config:set --base-url <url> --api-key <key> --model <model>。'
          }
        ]);
        return;
      }
      const agent = createAgent({
        model: createOpenAICompatibleClient(config),
        repoMap,
        onToolActivity(activity) {
          setMessages((current) => [
            ...current,
            {role: 'system', content: formatToolActivity(activity)}
          ]);
        }
      });
      const answer = await agent.ask(input);
      setMessages((current) => [...current, {role: 'assistant', content: answer}]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {role: 'assistant', content: `请求失败：${error instanceof Error ? error.message : String(error)}`}
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="green">GPS Code</Text>
      <ChatView messages={messages} />
      <InputBox disabled={!canChat || busy} onSubmit={handleSubmit} />
    </Box>
  );
}
