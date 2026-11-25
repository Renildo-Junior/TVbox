'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvbox', {
  biblioteca: () => ipcRenderer.invoke('biblioteca'),
  tv: () => ipcRenderer.invoke('tv'),
  abrirTv: (id) => ipcRenderer.invoke('abrir-tv', id),
  androidCompleto: () => ipcRenderer.invoke('android-completo'),
  abrirApp: (id) => ipcRenderer.invoke('abrir-app', id),
  abrirJogo: (sistema, arquivo) => ipcRenderer.invoke('abrir-jogo', sistema, arquivo),
  energia: (acao) => ipcRenderer.invoke('energia', acao),
  salvarControle: (chave, mapa) => ipcRenderer.invoke('salvar-controle', chave, mapa),
  aoVoltar: (fn) => ipcRenderer.on('voltou', () => fn()),
  aoSair: (fn) => ipcRenderer.on('saiu', () => fn()),
});
