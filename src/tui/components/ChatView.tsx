import React from 'react';
import {Box, Text} from 'ink';

export type ChatMessageView = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export function ChatView({messages}: {messages: ChatMessageView[]}) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index} marginBottom={1} flexDirection="column">
          <Text color={message.role === 'user' ? 'cyan' : message.role === 'assistant' ? 'green' : 'yellow'}>
            {message.role === 'user' ? '你' : message.role === 'assistant' ? 'GPS Code' : '系统'}
          </Text>
          <Text>{message.content}</Text>
        </Box>
      ))}
    </Box>
  );
}
