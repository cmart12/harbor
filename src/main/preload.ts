const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('intentAPI', {
  create: (input: { description: string; client?: string; due_at?: string }) =>
    ipcRenderer.invoke('intent:create', input),
  list: () => ipcRenderer.invoke('intent:list'),
  update: (id: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke('intent:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('intent:delete', id),
  parse: (rawText: string) => ipcRenderer.invoke('intent:parse', rawText),
  transcribe: (audioData: number[]) => ipcRenderer.invoke('voice:transcribe', audioData),
  hideWindow: () => ipcRenderer.send('window:hide'),
  onWindowShown: (callback: () => void) => {
    ipcRenderer.on('window:shown', callback);
  },
});
