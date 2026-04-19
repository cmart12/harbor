const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('intentAPI', {
  create: (input: { description: string }) =>
    ipcRenderer.invoke('intent:create', input),
  list: () => ipcRenderer.invoke('intent:list'),
  update: (id: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke('intent:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('intent:delete', id),
  transcribe: (audioData: number[]) => ipcRenderer.invoke('voice:transcribe', audioData),
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  listModels: () => ipcRenderer.invoke('models:list'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  onWindowShown: (callback: () => void) => {
    ipcRenderer.on('window:shown', callback);
  },
  onIntentProcessed: (callback: (id: string) => void) => {
    ipcRenderer.on('intent:processed', (_event: any, id: string) => callback(id));
  },
});
