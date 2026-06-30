export type SupportedLanguage = 'javascript-typescript' | 'python' | 'java' | 'c-cpp';

export type RepoScript = {
  name: string;
  command: string;
  source: string;
};

export type RepoMap = {
  root: string;
  languages: SupportedLanguage[];
  frameworks: string[];
  packageManagers: string[];
  buildTools: string[];
  scripts: RepoScript[];
  keyFiles: string[];
  keyDirectories: string[];
};

export type LanguageDetectorResult = Partial<Omit<RepoMap, 'root'>>;
