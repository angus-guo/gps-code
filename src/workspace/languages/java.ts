import type {LanguageDetectorResult} from '../types.js';

export function detectJava(files: Set<string>): LanguageDetectorResult {
  const keyFiles = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
    .filter((file) => files.has(file));
  const hasJavaLayout = [...files].some((file) => file.startsWith('src/main/java/'));

  if (keyFiles.length === 0 && !hasJavaLayout) {
    return {};
  }

  return {
    languages: ['java'],
    buildTools: [
      files.has('pom.xml') ? 'maven' : null,
      files.has('build.gradle') || files.has('build.gradle.kts') ? 'gradle' : null
    ].filter((value): value is string => Boolean(value)),
    keyFiles,
    keyDirectories: hasJavaLayout ? ['src/main/java'] : []
  };
}
