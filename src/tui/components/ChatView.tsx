import React from 'react';
import {Box, Text} from 'ink';

export type ChatMessageView = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

function getRoleLabel(role: ChatMessageView['role']) {
  if (role === 'user') return '你';
  if (role === 'assistant') return 'GPS Code';
  return '系统';
}

function getRoleColor(role: ChatMessageView['role']) {
  if (role === 'user') return 'cyan';
  if (role === 'assistant') return 'green';
  return 'yellow';
}

export function ChatView({messages}: {messages: ChatMessageView[]}) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index} marginBottom={1} flexDirection="column">
          <Text color={getRoleColor(message.role)}>{getRoleLabel(message.role)}</Text>
          <Text>{message.content}</Text>
        </Box>
      ))}
    </Box>
  );
}
