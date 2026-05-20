import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config as dotenvConfig } from 'dotenv';

const HOME_ENV = path.join(os.homedir(), '.nova', '.env');
const PROJECT_ENV = path.join(__dirname, '..', '..', '.env');

dotenvConfig({ path: PROJECT_ENV });
dotenvConfig({ path: HOME_ENV });
dotenvConfig(); 

export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'deepseek' | string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GrowthConfig {
  actionsToChild: number;
  actionsToAdolescent: number;
  actionsToAdult: number;
  actionsToMature: number;
}

export interface NovaConfig {
  llm: {
    fast: LLMProviderConfig;
    reflective: LLMProviderConfig;
    deep: LLMProviderConfig;
  };
  growth: GrowthConfig;
  respiratory: {
    tokenCapacity: number;
    refillRate: number;
  };
  memory: {
    shortTermCapacity: number;
    filterIntervalMs: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    verbose: boolean;
  };
}

const DEFAULT_CONFIG: NovaConfig = {
  llm: {
    fast: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-v4-flash',
      maxTokens: 4096,
      temperature: 0.3
    },
    reflective: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-v4-flash',
      maxTokens: 8192,
      temperature: 0.7
    },
    deep: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: 'deepseek-v4-pro',
      maxTokens: 16384,
      temperature: 0.9
    }
  },
  growth: {
    actionsToChild: 5,
    actionsToAdolescent: 20,
    actionsToAdult: 50,
    actionsToMature: 100
  },
  respiratory: {
    tokenCapacity: 10000,
    refillRate: 100
  },
  memory: {
    shortTermCapacity: 100,
    filterIntervalMs: 30000
  },
  logging: {
    level: 'info',
    verbose: false
  }
};

let loadedConfig: NovaConfig | null = null;

export function loadConfig(configPath?: string): NovaConfig {
  if (loadedConfig) return loadedConfig;

  const merged: NovaConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  const paths = [
    configPath,
    path.join(process.cwd(), 'nova.config.json'),
    path.join(process.cwd(), 'nova.config.jsonc'),
    path.join(process.cwd(), '.novarc'),
    path.join(os.homedir(), '.nova', 'config.json')
  ];

  for (const p of paths) {
    if (!p) continue;
    try {
      const content = fs.readFileSync(p, 'utf-8');
      const fileConfig = JSON.parse(content);
      deepMerge(merged, fileConfig);
      break;
    } catch {}
  }

  try {
    const opencodeAuth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hermes', 'auth.json'), 'utf-8'));
    const dsKey = opencodeAuth?.credential_pool?.deepseek?.[0]?.access_token;
    if (dsKey && !merged.llm.fast.apiKey) {
      merged.llm.fast.apiKey = dsKey;
      merged.llm.reflective.apiKey = dsKey;
      merged.llm.deep.apiKey = dsKey;
      console.log('  ✓ Auto-loaded DeepSeek key from OpenCode');
    }
  } catch {}

  // OpenCode proxy 优先（省钱）
  const opencodeKey = process.env.OPENCODE_GO_API_KEY || process.env.OPENCODE_API_KEY;
  if (opencodeKey) {
    merged.llm.fast.apiKey = opencodeKey;
    merged.llm.reflective.apiKey = opencodeKey;
    merged.llm.deep.apiKey = opencodeKey;
    merged.llm.fast.baseUrl = 'https://opencode.ai/zen/go';
    merged.llm.reflective.baseUrl = 'https://opencode.ai/zen/go';
    merged.llm.deep.baseUrl = 'https://opencode.ai/zen/go';
    console.log('  ✓ Using OpenCode proxy');
  } else if (process.env.DEEPSEEK_API_KEY) {
    merged.llm.fast.apiKey = process.env.DEEPSEEK_API_KEY;
    merged.llm.reflective.apiKey = process.env.DEEPSEEK_API_KEY;
    merged.llm.deep.apiKey = process.env.DEEPSEEK_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    merged.llm.fast.apiKey = process.env.OPENAI_API_KEY;
    merged.llm.reflective.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    merged.llm.deep.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.NOVA_FAST_MODEL) merged.llm.fast.model = process.env.NOVA_FAST_MODEL;
  if (process.env.NOVA_REFLECTIVE_MODEL) merged.llm.reflective.model = process.env.NOVA_REFLECTIVE_MODEL;
  if (process.env.NOVA_DEEP_MODEL) merged.llm.deep.model = process.env.NOVA_DEEP_MODEL;

  loadedConfig = merged;
  return merged;
}

function deepMerge(target: any, source: any): void {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}
