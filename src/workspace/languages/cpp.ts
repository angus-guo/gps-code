import type {LanguageDetectorResult} from '../types.js';

export function detectCpp(files: Set<string>): LanguageDetectorResult {
  const keyFiles = ['CMakeLists.txt', 'Makefile', 'compile_commands.json']
    .filter((file) => files.has(file));
  const hasCppSource = [...files].some((file) => /\.(c|cc|cpp|cxx|h|hpp)$/.test(file));

  if (keyFiles.length === 0 && !hasCppSource) {
    return {};
  }

  return {
    languages: ['c-cpp'],
    buildTools: [
      files.has('CMakeLists.txt') ? 'cmake' : null,
      files.has('Makefile') ? 'make' : null
    ].filter((value): value is string => Boolean(value)),
    keyFiles
  };
}
