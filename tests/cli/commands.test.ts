import {describe, expect, it} from 'vitest';
import {createProgram} from '../../src/cli/commands.js';

describe('createProgram', () => {
  it('registers the GPS Code config commands', () => {
    const program = createProgram();

    expect(program.name()).toBe('gps-code');
    expect(program.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(['config:set', 'config:presets', 'config:show'])
    );
  });
});
