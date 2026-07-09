import {Command} from 'commander';
import {render} from 'ink';
import React from 'react';
import {modelConfigSchema, providerPresets} from '../config/schema.js';
import {loadConfig, saveConfig} from '../config/store.js';
import {App} from '../tui/App.js';

export function createProgram() {
  const program = new Command();

  program
    .name('gps-code')
    .description('Chinese-first TUI code agent for understanding local codebases.')
    .version('0.1.0');

  program
    .command('config:set')
    .description('Save OpenAI-compatible model configuration.')
    .requiredOption('--base-url <url>', 'OpenAI-compatible base URL')
    .requiredOption('--api-key <key>', 'API key')
    .requiredOption('--model <model>', 'Model name')
    .option('--temperature <number>', 'Sampling temperature', '0.2')
    .option('--max-tokens <number>', 'Maximum output tokens', '4096')
    .action(async (options) => {
      const config = modelConfigSchema.parse({
        baseURL: options.baseUrl,
        apiKey: options.apiKey,
        model: options.model,
        temperature: Number(options.temperature),
        maxTokens: Number(options.maxTokens)
      });
      await saveConfig(config);
      console.log('GPS Code model config saved.');
    });

  program
    .command('config:presets')
    .description('List built-in provider presets.')
    .action(() => {
      for (const preset of providerPresets) {
        console.log(`${preset.name}\t${preset.label}\t${preset.baseURL}\t${preset.defaultModel}`);
      }
    });

  program
    .command('config:show')
    .description('Show current model configuration without revealing the full API key.')
    .action(async () => {
      const config = await loadConfig();
      if (!config) {
        console.log('No GPS Code config found. Run gps-code config:set first.');
        return;
      }
      console.log(JSON.stringify({...config, apiKey: '***'}, null, 2));
    });

  program.action(() => {
    render(React.createElement(App, {cwd: process.cwd()}));
  });

  return program;
}
