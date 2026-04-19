const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('intentAPI', {
  create: (input: { description: string }) =>
    ipcRenderer.invoke('intent:create', input),
  list: () => ipcRenderer.invoke('intent:list'),
  update: (id: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke('intent:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('intent:delete', id),
  dismissRecurrence: (id: string) => ipcRenderer.invoke('intent:dismiss-recurrence', id),
  transcribe: (audioData: number[]) => ipcRenderer.invoke('voice:transcribe', audioData),
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  listModels: () => ipcRenderer.invoke('models:list'),
  launchSession: (intentId: string) => ipcRenderer.invoke('session:launch', intentId),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  onWindowShown: (callback: () => void) => {
    ipcRenderer.on('window:shown', callback);
  },
  onIntentProcessed: (callback: (id: string) => void) => {
    ipcRenderer.on('intent:processed', (_event: any, id: string) => callback(id));
  },
  onRecurrenceResult: (callback: (intentId: string, result: any) => void) => {
    ipcRenderer.on('intent:recurrence', (_event: any, intentId: string, result: any) => callback(intentId, result));
  },
  onRecurrenceApplied: (callback: (intentId: string) => void) => {
    ipcRenderer.on('intent:recurrence-applied', (_event: any, intentId: string) => callback(intentId));
  },
  onRecallHint: (callback: (intentId: string, match: any) => void) => {
    ipcRenderer.on('intent:recall', (_event: any, intentId: string, match: any) => callback(intentId, match));
  },
});
