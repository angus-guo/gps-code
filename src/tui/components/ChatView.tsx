import React from 'react';
import {Box, Text} from 'ink';

export type ChatMessageView = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'default' | 'tool' | 'command' | 'command-result';
};

function getRoleLabel(message: ChatMessageView) {
  if (message.kind === 'command') return '命令';
  if (message.kind === 'command-result') return '命令结果';
  if (message.kind === 'tool') return '工具';
  const {role} = message;
  if (role === 'user') return '你';
  if (role === 'assistant') return 'GPS Code';
  return '系统';
}

function getRoleColor(message: ChatMessageView) {
  if (message.kind === 'command') return 'magenta';
  if (message.kind === 'command-result') return 'blue';
  if (message.kind === 'tool') return 'yellow';
  const {role} = message;
  if (role === 'user') return 'cyan';
  if (role === 'assistant') return 'green';
  return 'yellow';
}

export function ChatView({messages}: {messages: ChatMessageView[]}) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index} marginBottom={1} flexDirection="column">
          <Text color={getRoleColor(message)}>{getRoleLabel(message)}</Text>
          <Text>{message.content}</Text>
        </Box>
      ))}
    </Box>
  );
}
