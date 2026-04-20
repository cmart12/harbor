import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export interface AppConfig {
  workspace: string | null;
  theme: 'light' | 'dark';
  model: string | null;
  sessions: Record<string, string>; // intentId → copilot CLI sessionId
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  workspace: null,
  theme: 'light',
  model: null,
  sessions: {},
};

let config: AppConfig = { ...DEFAULT_CONFIG };

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      config = { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (err) {
    console.error('[config] Failed to load config:', err);
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

export function saveConfig(): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[config] Failed to save config:', err);
  }
}

export function getConfig(): AppConfig {
  return config;
}

export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return config[key];
}

export function setConfigValue<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
  config[key] = value;
  saveConfig();
}

export function getSessionId(intentId: string): string | null {
  return config.sessions[intentId] ?? null;
}

export function setSessionId(intentId: string, sessionId: string): void {
  config.sessions[intentId] = sessionId;
  saveConfig();
}

export function removeSession(intentId: string): void {
  delete config.sessions[intentId];
  saveConfig();
}
