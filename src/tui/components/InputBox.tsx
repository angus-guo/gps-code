import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

export function InputBox({
  disabled,
  prompt = '输入问题，回车发送：',
  onSubmit
}: {
  disabled?: boolean;
  prompt?: string;
  onSubmit(input: string): void;
}) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      setValue('');
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (input) {
      setValue((current) => `${current}${input}`);
    }
  });

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text color="gray">{disabled ? '等待模型回复...' : prompt}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
