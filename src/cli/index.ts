import {createProgram} from './commands.js';
import {formatError} from '../shared/errors.js';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}
